const express = require('express');
const Book = require('../models/Book');
const Reservation = require('../models/Reservation');
const Transaction = require('../models/Transaction');
const { requireLogin, requireMember } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

// GET /api/reservations   librarian: all active.  student or faculty: own active.
router.get('/', async (req, res) => {
  const filter = { status: 'active' };
  if (req.user.role !== 'librarian') filter.student = req.user.id;
  const list = await Reservation.find(filter)
    .populate('book', 'title author availableCopies')
    .populate('student', 'name email role')
    .sort({ createdAt: 1 });
  // A reservation whose book or member was deleted is of no use, so hide it.
  res.json(list.filter(r => r.book && r.student));
});

// POST /api/reservations   body: { bookId }   (student or faculty)
router.post('/', requireMember, async (req, res) => {
  const book = await Book.findById(req.body.bookId);
  if (!book) return res.status(404).json({ message: 'Book not found.' });

  const mine = await Transaction.findOne({ student: req.user.id, book: book._id, returnDate: null });
  if (mine) return res.status(400).json({ message: 'You already have this book.' });

  const exists = await Reservation.findOne({ student: req.user.id, book: book._id, status: 'active' });
  if (exists) return res.status(400).json({ message: 'You already reserved this book.' });

  // Reserving makes sense only when no copy is left over after the people already waiting.
  const waiting = await Reservation.countDocuments({ book: book._id, status: 'active' });
  if (book.availableCopies - waiting > 0) {
    return res.status(400).json({ message: 'This book is available now. You can borrow it.' });
  }

  const reservation = await Reservation.create({ student: req.user.id, book: book._id });
  res.status(201).json(reservation);
});

// DELETE /api/reservations/:id   (the member who made it, or a librarian)
router.delete('/:id', async (req, res) => {
  const filter = { _id: req.params.id, status: 'active' };
  if (req.user.role !== 'librarian') filter.student = req.user.id;
  const reservation = await Reservation.findOne(filter);
  if (!reservation) return res.status(404).json({ message: 'Reservation not found.' });
  reservation.status = 'cancelled';
  await reservation.save();
  res.json({ message: 'Reservation cancelled.' });
});

module.exports = router;
