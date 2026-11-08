const express = require('express');
const Book = require('../models/Book');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Reservation = require('../models/Reservation');
const { requireLogin, requireLibrarian, requireMember } = require('../middleware/auth');
const { borrowBook, MAX_BOOKS } = require('../utils/borrowing');
const { LOAN_DAYS, FINE_PER_DAY_BY_ROLE, finePerDayFor, startOfDay, daysLate, calculateFine } = require('../utils/fine');

const router = express.Router();
router.use(requireLogin);

// Adds live fields (status, fine, reminder) to a transaction for the screen.
function describe(t) {
  const obj = t.toObject();
  if (t.returnDate) {
    obj.status = 'returned';
  } else {
    obj.fine = calculateFine(t.dueDate, undefined, t.student && t.student.role);          // fine so far, recalculated every time
    obj.daysLate = daysLate(t.dueDate);
    obj.status = daysLate(t.dueDate) > 0 ? 'overdue' : 'issued';
    const daysLeft = Math.round((startOfDay(t.dueDate) - startOfDay(new Date())) / 86400000);
    obj.dueSoon = daysLeft >= 0 && daysLeft <= 2;  // reminder: due within 2 days
    obj.daysLeft = daysLeft;
  }
  return obj;
}

// GET /api/transactions
// Librarian: all records.  Student or faculty: only their own.  Add ?active=true for books not yet returned.
router.get('/', async (req, res) => {
  const filter = {};
  if (req.user.role !== 'librarian') filter.student = req.user.id;
  if (req.query.active === 'true') filter.returnDate = null;

  const list = await Transaction.find(filter)
    .populate('book', 'title author isbn')
    .populate('student', 'name email role')
    .sort({ issueDate: -1 });
  res.json(list.map(describe));
});

// GET /api/transactions/overdue   (librarian)
router.get('/overdue', requireLibrarian, async (req, res) => {
  const list = await Transaction.find({ returnDate: null, dueDate: { $lt: new Date().setHours(0, 0, 0, 0) } })
    .populate('book', 'title author isbn')
    .populate('student', 'name email role')
    .sort({ dueDate: 1 });
  res.json(list.map(describe));
});

// POST /api/transactions/borrow   body: { bookId }   (student or faculty borrows for themselves)
// Borrowing is free. A fine only applies if the book comes back late.
router.post('/borrow', requireMember, async (req, res) => {
  const member = await User.findById(req.user.id);
  const { transaction, book } = await borrowBook(member, req.body.bookId);
  res.status(201).json({
    message: `You borrowed "${book.title}". Return it by ${transaction.dueDate.toDateString()} at the library desk.`,
    transaction,
  });
});

// POST /api/transactions/issue   body: { bookId, studentId }   (librarian issues to a student or faculty member)
router.post('/issue', requireLibrarian, async (req, res) => {
  const member = await User.findOne({ _id: req.body.studentId, role: { $in: ['student', 'faculty'] } });
  if (!member) return res.status(404).json({ message: 'Member not found.' });
  const { transaction } = await borrowBook(member, req.body.bookId);
  res.status(201).json(transaction);
});

// POST /api/transactions/return   body: { transactionId }   (librarian)
router.post('/return', requireLibrarian, async (req, res) => {
  const transaction = await Transaction.findById(req.body.transactionId);
  if (!transaction) return res.status(404).json({ message: 'Record not found.' });
  if (transaction.returnDate) return res.status(400).json({ message: 'This book was already returned.' });

  const member = await User.findById(transaction.student);
  transaction.returnDate = new Date();
  transaction.fine = calculateFine(transaction.dueDate, transaction.returnDate, member && member.role);
  await transaction.save();

  await Book.findByIdAndUpdate(transaction.book, { $inc: { availableCopies: 1 } });

  res.json({
    message: transaction.fine ? `Returned. Fine to collect: Rs ${transaction.fine}` : 'Returned on time. No fine.',
    transaction,
  });
});

// POST /api/transactions/:id/pay   (librarian) mark a fine as paid
router.post('/:id/pay', requireLibrarian, async (req, res) => {
  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) return res.status(404).json({ message: 'Record not found.' });
  if (!transaction.returnDate) return res.status(400).json({ message: 'Accept the return first.' });
  transaction.finePaid = true;
  await transaction.save();
  res.json(transaction);
});

// GET /api/transactions/rules   -> loan days and fine amount, for the screens
router.get('/rules', (req, res) => res.json({
  loanDays: LOAN_DAYS,
  finePerDay: finePerDayFor(req.user.role),   // what THIS person pays per late day (0 for faculty)
  fines: FINE_PER_DAY_BY_ROLE,                // both, for the librarian's screen
  maxBooks: MAX_BOOKS,
}));

module.exports = router;
