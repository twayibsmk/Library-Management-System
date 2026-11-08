const mongoose = require('mongoose');

// A student asks the library to hold a book that has no free copies.
const reservationSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  status: { type: String, enum: ['active', 'cancelled', 'fulfilled'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Reservation', reservationSchema);
