const mongoose = require('mongoose');

// One record = one book borrowed by one student (borrowing history).
const transactionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  issueDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  returnDate: { type: Date, default: null },   // null = still borrowed
  fine: { type: Number, default: 0 },          // saved when the book is returned
  finePaid: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
