// The borrowing rules, used by BOTH "member borrows" and "librarian issues".
// Keeping them in one place means the two can never disagree.
const Book = require('../models/Book');
const Transaction = require('../models/Transaction');
const Reservation = require('../models/Reservation');
const { LOAN_DAYS, calculateFine, daysLate, addDays } = require('./fine');

const MAX_BOOKS = {
  student: Number(process.env.MAX_BOOKS_STUDENT) || 3,
  faculty: Number(process.env.MAX_BOOKS_FACULTY) || 5,
};

// Stops the request with a clear message (the error handler in server.js sends it).
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

// Can this member take a copy right now?
// Simple rule: if at least one copy is on the shelf, anyone can borrow it.
function copyRule(book) {
  if (book.availableCopies <= 0) return { ok: false, reason: 'No copies are free right now. Reserve it instead.' };
  return { ok: true };
}

// Checks the member's own situation: limit, overdue books, unpaid fines, already has this book.
async function checkMember(member, bookId) {
  const loans = await Transaction.find({ student: member._id });
  const active = loans.filter(t => !t.returnDate);
  const max = MAX_BOOKS[member.role] || MAX_BOOKS.student;

  if (active.some(t => String(t.book) === String(bookId))) fail(400, 'You already have this book.');
  if (active.length >= max) fail(400, `A ${member.role} can borrow at most ${max} books at a time. Return one first.`);
  if (active.some(t => daysLate(t.dueDate) > 0)) fail(400, 'You have an overdue book. Return it before borrowing another.');

  const unpaid = loans.filter(t => t.returnDate && t.fine > 0 && !t.finePaid).reduce((sum, t) => sum + t.fine, 0);
  if (unpaid > 0) fail(400, `Please pay your fine of Rs ${unpaid} at the library before borrowing.`);
}

// Gives one book to one member. `member` is a User document (student or faculty).
async function borrowBook(member, bookId) {
  if (member.role !== 'student' && member.role !== 'faculty') fail(400, 'Only students and faculty can borrow books.');
  if (member.status !== 'active') fail(400, 'This account is not active.');

  const book = await Book.findById(bookId);
  if (!book) fail(404, 'Book not found.');

  await checkMember(member, bookId);
  const rule = copyRule(book);
  if (!rule.ok) fail(400, rule.reason);

  // Take one copy only if one is free. Doing it in one step stops two people
  // from taking the last copy at the same time.
  const taken = await Book.findOneAndUpdate(
    { _id: bookId, availableCopies: { $gt: 0 } },
    { $inc: { availableCopies: -1 } },
    { new: true }
  );
  if (!taken) fail(400, 'Someone just took the last copy. Reserve it instead.');

  let transaction;
  try {
    const today = new Date();
    transaction = await Transaction.create({
      student: member._id, book: bookId, issueDate: today, dueDate: addDays(today, LOAN_DAYS),
    });
  } catch (err) {
    await Book.findByIdAndUpdate(bookId, { $inc: { availableCopies: 1 } }); // give the copy back
    throw err;
  }

  // If this member had reserved the book, that reservation is now done.
  await Reservation.updateMany({ student: member._id, book: bookId, status: 'active' }, { status: 'fulfilled' });
  return { transaction, book: taken };
}

module.exports = { MAX_BOOKS, fail, copyRule, borrowBook, calculateFine };
