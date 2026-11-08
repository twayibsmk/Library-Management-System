const express = require('express');
const BorrowRequest = require('../models/BorrowRequest');
const { requireLogin, requireLibrarian, requireMember } = require('../middleware/auth');
const { borrowBook } = require('../utils/borrowing');

const router = express.Router();
router.use(requireLogin);

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

// ── Student / Faculty routes ──────────────────────────────────────────────────

// POST /api/borrow-requests          body: { bookId }
// Student or faculty submits a borrow request.
router.post('/', requireMember, async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return fail(400, 'bookId is required.');

  // Don't let them queue a second pending request for the same book.
  const existing = await BorrowRequest.findOne({
    student: req.user.id,
    book: bookId,
    status: 'pending',
  });
  if (existing) return fail(400, 'You already have a pending request for this book.');

  const request = await BorrowRequest.create({ student: req.user.id, book: bookId });
  res.status(201).json({ message: 'Your request has been sent to the librarian.', request });
});

// GET /api/borrow-requests/mine      student sees their own pending requests
router.get('/mine', requireMember, async (req, res) => {
  const list = await BorrowRequest.find({ student: req.user.id, status: 'pending' })
    .populate('book', 'title author')
    .sort({ createdAt: -1 });
  res.json(list);
});

// ── Librarian routes ──────────────────────────────────────────────────────────

// GET /api/borrow-requests           librarian sees all pending requests
router.get('/', requireLibrarian, async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  else filter.status = 'pending';          // default: pending only

  const list = await BorrowRequest.find(filter)
    .populate('student', 'name email role memberId')
    .populate('book', 'title author availableCopies totalCopies')
    .sort({ createdAt: 1 });               // oldest first (fair queue)
  res.json(list);
});

// POST /api/borrow-requests/:id/approve
// Librarian approves → creates the transaction, decrements availableCopies.
router.post('/:id/approve', requireLibrarian, async (req, res) => {
  const request = await BorrowRequest.findById(req.params.id)
    .populate('student')
    .populate('book');
  if (!request) return fail(404, 'Request not found.');
  if (request.status !== 'pending') return fail(400, `This request is already ${request.status}.`);

  // Run the same borrowing logic used by the librarian issue flow.
  const { transaction, book } = await borrowBook(request.student, String(request.book._id));

  request.status = 'approved';
  await request.save();

  res.json({
    message: `Approved. "${book.title}" has been issued to ${request.student.name}.`,
    transaction,
  });
});

// POST /api/borrow-requests/:id/reject   body: { reason }  (optional)
router.post('/:id/reject', requireLibrarian, async (req, res) => {
  const request = await BorrowRequest.findById(req.params.id);
  if (!request) return fail(404, 'Request not found.');
  if (request.status !== 'pending') return fail(400, `This request is already ${request.status}.`);

  request.status = 'rejected';
  request.rejectionReason = req.body.reason || '';
  await request.save();

  res.json({ message: 'Request rejected.' });
});

module.exports = router;
