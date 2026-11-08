const express = require('express');
const Book = require('../models/Book');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { requireLogin, requireLibrarian } = require('../middleware/auth');
const { calculateFine } = require('../utils/fine');

const router = express.Router();
router.use(requireLogin, requireLibrarian);

// GET /api/reports   -> numbers for the librarian dashboard
router.get('/', async (req, res) => {
  const [books, totalMembers, pendingApprovals, active, all] = await Promise.all([
    Book.find(),
    User.countDocuments({ role: { $in: ['student', 'faculty'] }, status: { $ne: 'unverified' } }),
    User.countDocuments({ status: 'pending' }),
    Transaction.find({ returnDate: null }).populate('student', 'role'),
    Transaction.find(),
  ]);

  const today = new Date().setHours(0, 0, 0, 0);
  const overdue = active.filter(t => new Date(t.dueDate) < today);

  // Fine already saved on returned books, plus fine building up on overdue books.
  const finesCollected = all.filter(t => t.returnDate && t.finePaid).reduce((s, t) => s + t.fine, 0);
  const finesPending =
    all.filter(t => t.returnDate && !t.finePaid).reduce((s, t) => s + t.fine, 0) +
    overdue.reduce((s, t) => s + calculateFine(t.dueDate, undefined, t.student && t.student.role), 0);

  // Most borrowed books (top 5): count borrowings per book, then look up the titles.
  const counts = await Transaction.aggregate([
    { $group: { _id: '$book', times: { $sum: 1 } } },
    { $sort: { times: -1 } },
    { $limit: 5 },
  ]);
  const popularBooks = await Book.find({ _id: { $in: counts.map(c => c._id) } });
  const popular = counts
    .map(c => {
      const book = popularBooks.find(b => String(b._id) === String(c._id));
      return book ? { title: book.title, author: book.author, times: c.times } : null;
    })
    .filter(Boolean);

  res.json({
    totalTitles: books.length,
    totalMembers,
    pendingApprovals,
    totalCopies: books.reduce((sum, b) => sum + b.totalCopies, 0),
    availableCopies: books.reduce((sum, b) => sum + b.availableCopies, 0),
    issuedNow: active.length,
    overdueNow: overdue.length,
    totalBorrowings: all.length,
    finesCollected,
    finesPending,
    popular,
  });
});

module.exports = router;
