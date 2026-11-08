const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  isbn: { type: String, required: true, unique: true, trim: true },
  category: { type: String, default: 'General', trim: true },
  totalCopies: { type: Number, required: true, min: 1 },
  availableCopies: { type: Number, required: true, min: 0 },
}, { timestamps: true });

// Lets MongoDB search title, author, isbn and category quickly.
bookSchema.index({ title: 'text', author: 'text', isbn: 'text', category: 'text' });

module.exports = mongoose.model('Book', bookSchema);
