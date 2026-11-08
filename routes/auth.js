const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireLogin } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();

const CODE_MINUTES = 10;      // how long the emailed code works
const MAX_TRIES = 5;          // wrong guesses allowed per code
const RESEND_SECONDS = 60;    // wait between emails
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanEmail = email => String(email || '').trim().toLowerCase();
const publicUser = u => ({ id: u._id, name: u.name, email: u.email, role: u.role, memberId: u.memberId });
const makeToken = u => jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '8h' });

// Optional: only allow college emails, for example ALLOWED_EMAIL_DOMAINS=rgit.ac.in,rgitech.edu
function emailDomainAllowed(email) {
  const list = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(email.split('@')[1]);
}

// Makes a new 6-digit code, saves it (hashed) and emails it.
async function sendCode(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  user.verifyCodeHash = await bcrypt.hash(code, 8);
  user.verifyExpires = new Date(Date.now() + CODE_MINUTES * 60 * 1000);
  user.verifyAttempts = 0;
  user.verifySentAt = new Date();
  await user.save();
  await sendMail(
    user.email,
    'Your library verification code',
    `Hello ${user.name},\n\nYour Library Management System verification code is ${code}.\n` +
    `It works for ${CODE_MINUTES} minutes. If you did not register, ignore this email.`
  );
}

function waitedEnough(user) {
  return !user.verifySentAt || Date.now() - user.verifySentAt.getTime() >= RESEND_SECONDS * 1000;
}

// POST /api/auth/login   body: { email, password }
router.post('/login', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const user = await User.findOne({ email });

  // Same message for both mistakes, so nobody can guess which emails exist.
  const ok = user && (await bcrypt.compare(req.body.password || '', user.password));
  if (!ok) return res.status(401).json({ message: 'Wrong email or password.' });

  if (user.status === 'unverified') {
    return res.status(403).json({ message: 'Please verify your email first. Enter the code we sent you.', needsVerification: true, email });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ message: 'Your email is verified. A librarian must approve your faculty account before you can log in.' });
  }
  res.json({ token: makeToken(user), user: publicUser(user) });
});

// POST /api/auth/register   body: { name, email, password, role, memberId }
// Public. Creates an UNVERIFIED account and emails a 6-digit code. No login yet.
router.post('/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'student').toLowerCase();
  const memberId = String(req.body.memberId || '').trim().toUpperCase();

  if (!name) return res.status(400).json({ message: 'Name is required.' });
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!emailDomainAllowed(email)) {
    return res.status(400).json({ message: 'Please use your college email address (' + process.env.ALLOWED_EMAIL_DOMAINS + ').' });
  }
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  if (!['student', 'faculty'].includes(role)) return res.status(400).json({ message: 'Role must be student or faculty.' });
  if (!/^[A-Z0-9-]{3,20}$/.test(memberId)) {
    return res.status(400).json({ message: role === 'faculty' ? 'Enter your staff ID.' : 'Enter your USN (letters and numbers only).' });
  }

  let user = await User.findOne({ email });
  if (user && user.status !== 'unverified') {
    return res.status(400).json({ message: 'This email is already registered. Please log in.' });
  }
  const sameId = await User.findOne({ memberId });
  if (sameId && (!user || String(sameId._id) !== String(user._id))) {
    return res.status(400).json({ message: 'This ID is already registered.' });
  }

  if (user) {
    // Someone started registering with this email but never finished. Let them start again.
    if (!waitedEnough(user)) return res.status(429).json({ message: `Please wait ${RESEND_SECONDS} seconds before asking for another code.` });
    user.name = name; user.role = role; user.memberId = memberId;
    user.password = await bcrypt.hash(password, 10);
  } else {
    user = new User({ name, email, role, memberId, status: 'unverified', password: await bcrypt.hash(password, 10) });
  }
  await sendCode(user);
  res.status(201).json({ message: `We sent a 6-digit code to ${email}.`, email });
});

// POST /api/auth/verify-email   body: { email, code }
router.post('/verify-email', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const code = String(req.body.code || '').trim();
  const user = await User.findOne({ email });
  if (!user || user.status !== 'unverified' || !user.verifyCodeHash) {
    return res.status(400).json({ message: 'No pending registration for this email.' });
  }
  if (user.verifyExpires < new Date()) {
    return res.status(400).json({ message: 'This code has expired. Request a new one.' });
  }
  if (user.verifyAttempts >= MAX_TRIES) {
    return res.status(400).json({ message: 'Too many wrong tries. Request a new code.' });
  }
  if (!(await bcrypt.compare(code, user.verifyCodeHash))) {
    user.verifyAttempts += 1;
    await user.save();
    return res.status(400).json({ message: 'That code is not correct.' });
  }

  user.verifyCodeHash = null; user.verifyExpires = null; user.verifyAttempts = 0;
  if (user.role === 'faculty') {
    user.status = 'pending'; // anyone can type "faculty", so the librarian must approve
    await user.save();
    return res.json({ message: 'Email verified. A librarian must approve your faculty account before you can log in.', approved: false });
  }
  user.status = 'active';
  await user.save();
  res.json({ message: 'Email verified. Welcome!', approved: true, token: makeToken(user), user: publicUser(user) });
});

// POST /api/auth/resend-code   body: { email }
router.post('/resend-code', async (req, res) => {
  const user = await User.findOne({ email: cleanEmail(req.body.email) });
  if (user && user.status === 'unverified') {
    if (!waitedEnough(user)) return res.status(429).json({ message: `Please wait ${RESEND_SECONDS} seconds before asking for another code.` });
    await sendCode(user);
  }
  // Same answer whether or not the email exists.
  res.json({ message: 'If this email has a pending registration, a new code has been sent.' });
});

// GET /api/auth/me   -> who am I?
router.get('/me', requireLogin, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password -verifyCodeHash');
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json(user);
});

module.exports = router;
