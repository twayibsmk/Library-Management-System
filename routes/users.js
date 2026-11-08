const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Reservation = require('../models/Reservation');
const { requireLogin, requireLibrarian } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin, requireLibrarian); // librarian only

const HIDDEN = '-password -verifyCodeHash -verifyExpires -verifyAttempts -verifySentAt';

// GET /api/users   -> all non-librarian members (students + faculty)
router.get('/', async (req, res) => {
  const members = await User.find({ role: { $in: ['student', 'faculty'] } }).select(HIDDEN).sort({ name: 1 });
  res.json(members);
});

// POST /api/users   body: { name, email, password, role, memberId }  -> add a member (librarian action)
// The librarian has checked the person in real life, so this account is active at once.
router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const memberId = String(req.body.memberId || '').trim().toUpperCase();
  if (!name || !email || password.length < 8) {
    return res.status(400).json({ message: 'Name, email and a password of 8+ characters are required.' });
  }
  const chosenRole = String(req.body.role || 'student').toLowerCase();
  if (!['student', 'faculty'].includes(chosenRole)) {
    return res.status(400).json({ message: 'Role must be student or faculty.' });
  }
  if (await User.findOne({ email })) {
    return res.status(400).json({ message: 'This email is already registered.' });
  }
  if (memberId && await User.findOne({ memberId })) {
    return res.status(400).json({ message: 'This ID is already registered.' });
  }
  const member = await User.create({
    name, email, role: chosenRole, status: 'active',
    password: await bcrypt.hash(password, 10),
    ...(memberId ? { memberId } : {}),
  });
  res.status(201).json({ id: member._id, name: member.name, email: member.email, role: member.role });
});

// POST /api/users/:id/approve   -> let a verified faculty member in
router.post('/:id/approve', async (req, res) => {
  const member = await User.findOne({ _id: req.params.id, role: { $in: ['student', 'faculty'] } });
  if (!member) return res.status(404).json({ message: 'Member not found.' });
  if (member.status === 'unverified') return res.status(400).json({ message: 'This person has not verified their email yet.' });
  member.status = 'active';
  await member.save();
  res.json({ message: `${member.name} can now log in.` });
});

// DELETE /api/users/:id   -> remove a member (only if nothing is borrowed and no fine is unpaid)
router.delete('/:id', async (req, res) => {
  const loans = await Transaction.find({ student: req.params.id });
  if (loans.some(t => !t.returnDate)) {
    return res.status(400).json({ message: 'This member still has books issued.' });
  }
  if (loans.some(t => t.fine > 0 && !t.finePaid)) {
    return res.status(400).json({ message: 'This member has an unpaid fine. Mark it paid first.' });
  }
  const gone = await User.deleteOne({ _id: req.params.id, role: { $in: ['student', 'faculty'] } });
  if (!gone.deletedCount) return res.status(404).json({ message: 'Member not found.' });
  await Reservation.updateMany({ student: req.params.id, status: 'active' }, { status: 'cancelled' });
  res.json({ message: 'Member removed.' });
});

module.exports = router;
