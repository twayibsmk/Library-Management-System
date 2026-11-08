const mongoose = require('mongoose');

// A user is a librarian, a student or a faculty member.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }, // stored hashed, never plain text
  role: { type: String, enum: ['librarian', 'student', 'faculty'], default: 'student' },

  // USN for students, staff ID for faculty. Helps the librarian match the account to a real person.
  memberId: { type: String, trim: true, uppercase: true, unique: true, sparse: true },

  // active     = can log in
  // unverified = registered, but has not typed the code we emailed
  // pending    = email verified, faculty account waits for the librarian to approve
  status: { type: String, enum: ['active', 'unverified', 'pending'], default: 'active' },

  // Email verification (the code is stored hashed, like a password)
  verifyCodeHash: { type: String, default: null },
  verifyExpires: { type: Date, default: null },
  verifyAttempts: { type: Number, default: 0 },
  verifySentAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
