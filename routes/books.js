const express = require('express');
const Book = require('../models/Book');
const Transaction = require('../models/Transaction');
const Reservation = require('../models/Reservation');
const BorrowRequest = require('../models/BorrowRequest');
const { copyRule } = require('../utils/borrowing');
const { requireLogin, requireLibrarian } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin); // everyone must be logged in

// Turns plain text into a safe search pattern.
function safePattern(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

// GET /api/books?search=clean&category=Programming
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.search) {
    const pattern = safePattern(req.query.search.trim());
    filter.$or = [{ title: pattern }, { author: pattern }, { isbn: pattern }, { category: pattern }];
  }
  if (req.query.category) filter.category = req.query.category;

  const books = await Book.find(filter).sort({ title: 1 });
  if (req.user.role === 'librarian') return res.json(books);

  // For students and faculty, tell the screen what they can do with each book.
  const ids = books.map(b => b._id);
  const [myLoans, myRequests] = await Promise.all([
    Transaction.find({ student: req.user.id, returnDate: null, book: { $in: ids } }),
    BorrowRequest.find({ student: req.user.id, book: { $in: ids }, status: 'pending' }),
  ]);
  res.json(books.map(b => {
    const rule = copyRule(b);
    const borrowedByMe   = myLoans.some(t => String(t.book) === String(b._id));
    const requestedByMe  = myRequests.some(r => String(r.book) === String(b._id));
    return {
      ...b.toObject(),
      borrowedByMe,
      requestedByMe,
      canBorrow: rule.ok && !borrowedByMe && !requestedByMe,
    };
  }));
});

// GET /api/books/categories
router.get('/categories', async (req, res) => {
  res.json((await Book.distinct('category')).sort());
});

// GET /api/books/:id   (book details)
router.get('/:id', async (req, res) => {
  const book = await Book.findById(req.params.id);
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  res.json(book);
});

// POST /api/books   (librarian) add a book
router.post('/', requireLibrarian, async (req, res) => {
  const { title, author, isbn, category, totalCopies } = req.body;
  const copies = Number(totalCopies);
  if (!title || !author || !isbn || !(copies >= 1)) {
    return res.status(400).json({ message: 'Title, author, ISBN and at least 1 copy are required.' });
  }
  if (await Book.findOne({ isbn })) {
    return res.status(400).json({ message: 'A book with this ISBN already exists.' });
  }
  const book = await Book.create({
    title, author, isbn, category: category || 'General',
    totalCopies: copies, availableCopies: copies,
  });
  res.status(201).json(book);
});

// PUT /api/books/:id   (librarian) update a book
router.put('/:id', requireLibrarian, async (req, res) => {
  const book = await Book.findById(req.params.id);
  if (!book) return res.status(404).json({ message: 'Book not found.' });

  const { title, author, isbn, category, totalCopies } = req.body;
  if (title) book.title = title;
  if (author) book.author = author;
  if (isbn && isbn !== book.isbn) {
    if (await Book.findOne({ isbn, _id: { $ne: book._id } })) {
      return res.status(400).json({ message: 'A book with this ISBN already exists.' });
    }
    book.isbn = isbn;
  }
  if (category) book.category = category;

  if (totalCopies !== undefined) {
    const newTotal = Number(totalCopies);
    const issued = book.totalCopies - book.availableCopies; // copies out right now
    if (!(newTotal >= issued && newTotal >= 1)) {
      return res.status(400).json({ message: `Total copies cannot be less than the ${issued} currently issued.` });
    }
    book.totalCopies = newTotal;
    book.availableCopies = newTotal - issued;
  }
  await book.save();
  res.json(book);
});

// DELETE /api/books/:id   (librarian)
router.delete('/:id', requireLibrarian, async (req, res) => {
  const stillOut = await Transaction.findOne({ book: req.params.id, returnDate: null });
  if (stillOut) {
    return res.status(400).json({ message: 'This book is currently issued. Accept the return first.' });
  }
  await Book.findByIdAndDelete(req.params.id);
  res.json({ message: 'Book deleted.' });
});

module.exports = router;
