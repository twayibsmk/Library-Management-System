const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Checks the login token AND that the account still exists and is active.
// Adds req.user = { id, role }. The role comes from the database, not from the token,
// so a removed or changed account stops working immediately.
async function requireLogin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Please log in first.' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Your login has expired. Please log in again.' });
    }

    const user = await User.findById(payload.id).select('role status');
    if (!user) return res.status(401).json({ message: 'This account no longer exists.' });
    if (user.status !== 'active') return res.status(401).json({ message: 'This account is not active.' });

    req.user = { id: String(user._id), role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

// Only lets librarians through (use after requireLogin).
function requireLibrarian(req, res, next) {
  if (req.user.role !== 'librarian') {
    return res.status(403).json({ message: 'Only librarians can do this.' });
  }
  next();
}

// Lets students and faculty through (use after requireLogin).
function requireMember(req, res, next) {
  if (req.user.role !== 'student' && req.user.role !== 'faculty') {
    return res.status(403).json({ message: 'Only students and faculty can do this.' });
  }
  next();
}

module.exports = { requireLogin, requireLibrarian, requireMember };
