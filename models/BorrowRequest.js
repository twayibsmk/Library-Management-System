const mongoose = require('mongoose');

// A student or faculty member asks to borrow a book.
// The librarian approves or rejects the request.
// Status: 'pending' | 'approved' | 'rejected'
const borrowRequestSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  book:    { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  status:  { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: { type: String },   // optional note when rejecting
}, { timestamps: true });

// A member may only have one active pending request per book.
borrowRequestSchema.index({ student: 1, book: 1, status: 1 });

module.exports = mongoose.model('BorrowRequest', borrowRequestSchema);
