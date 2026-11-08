// A simple end-to-end check of the whole system.
// Run with:  npm test       (needs MONGO_URI in .env, or set it in your terminal)
// WARNING: it resets the database in MONGO_URI (it runs the seed first).
// Use a separate database name, for example mongodb://127.0.0.1:27017/library_test
require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.SMTP_HOST = '';          // no real email in tests: codes are read from the dev outbox
process.env.ALLOWED_EMAIL_DOMAINS = '';

const seed = require('./seed');
const { start } = require('./server');
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
const { outbox } = require('./utils/mailer');

const PORT = 5055;
const BASE = `http://localhost:${PORT}/api`;
let passed = 0, failed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('Set MONGO_URI first (see .env.example).');
  await seed(uri);
  const server = await start(uri, PORT);

  console.log('\nLogin and roles');
  let r = await call('/auth/login', { method: 'POST', body: { email: 'librarian@library.com', password: 'wrong' } });
  check('wrong password is rejected', r.status === 401);
  r = await call('/auth/login', { method: 'POST', body: { email: 'librarian@library.com', password: 'password123' } });
  check('librarian can log in', r.status === 200 && r.data.user.role === 'librarian');
  const lib = r.data.token;
  r = await call('/auth/login', { method: 'POST', body: { email: 'suhaas@student.com', password: 'password123' } });
  check('student can log in', r.status === 200 && r.data.user.role === 'student');
  const stu = r.data.token;
  const suhaasId = r.data.user.id;

  r = await call('/books');
  check('books need a login', r.status === 401);
  r = await call('/users', { token: stu });
  check('student cannot see the student list', r.status === 403);
  r = await call('/books', { method: 'POST', token: stu, body: { title: 'x', author: 'y', isbn: '1', totalCopies: 1 } });
  check('student cannot add books', r.status === 403);

  console.log('\nBooks');
  r = await call('/books', { token: stu });
  check('student can list books', r.status === 200 && r.data.length === 7);
  r = await call('/books?search=clean', { token: stu });
  check('search finds "Clean Code"', r.data.length === 1 && r.data[0].title === 'Clean Code');
  r = await call('/books', { method: 'POST', token: lib, body: { title: 'Test Book', author: 'Me', isbn: '111', category: 'Test', totalCopies: 2 } });
  check('librarian can add a book', r.status === 201 && r.data.availableCopies === 2);
  const testBookId = r.data._id;
  r = await call('/books', { method: 'POST', token: lib, body: { title: 'Dup', author: 'Me', isbn: '111', totalCopies: 1 } });
  check('duplicate ISBN is rejected', r.status === 400);
  r = await call('/books/' + testBookId, { method: 'PUT', token: lib, body: { totalCopies: 3 } });
  check('librarian can update copies', r.status === 200 && r.data.totalCopies === 3 && r.data.availableCopies === 3);

  console.log('\nStudents');
  r = await call('/users', { method: 'POST', token: lib, body: { name: 'New Student', email: 'new@student.com', password: 'secret123' } });
  check('librarian can add a student', r.status === 201);
  const newStudentId = r.data.id;

  console.log('\nIssue and return');
  r = await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: testBookId, studentId: suhaasId } });
  check('book can be issued', r.status === 201);
  const loanId = r.data._id;
  const issueDay = new Date(r.data.issueDate).setHours(0, 0, 0, 0);
  const days = Math.round((new Date(r.data.dueDate) - issueDay) / 86400000);
  check('due date is 14 days later', days === 14);
  r = await call('/books/' + testBookId, { token: lib });
  check('available copies went down to 2', r.data.availableCopies === 2);
  r = await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: testBookId, studentId: suhaasId } });
  check('same student cannot borrow the same book twice', r.status === 400);

  r = await call('/transactions', { token: stu });
  check('student sees own loan', r.data.length === 1 && r.data[0].status === 'issued');
  r = await call('/transactions', { token: lib });
  check('librarian sees all loans', r.data.length === 1);

  // Return on time: no fine
  r = await call('/transactions/return', { method: 'POST', token: lib, body: { transactionId: loanId } });
  check('on-time return has no fine', r.status === 200 && r.data.transaction.fine === 0);
  r = await call('/books/' + testBookId, { token: lib });
  check('available copies went back to 3', r.data.availableCopies === 3);
  r = await call('/transactions/return', { method: 'POST', token: lib, body: { transactionId: loanId } });
  check('cannot return twice', r.status === 400);

  console.log('\nOverdue and fines');
  r = await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: testBookId, studentId: suhaasId } });
  const lateLoanId = r.data._id;
  // Pretend this loan was issued 20 days ago, so it is 6 days late.
  const DAY = 86400000;
  await Transaction.findByIdAndUpdate(lateLoanId, {
    issueDate: new Date(Date.now() - 20 * DAY),
    dueDate: new Date(Date.now() - 6 * DAY),
  });
  r = await call('/transactions?active=true', { token: lib });
  check('a loan due in 14 days is not flagged as due soon', r.data[0].dueSoon === false);
  r = await call('/transactions/overdue', { token: lib });
  check('overdue list has the late loan', r.data.length === 1 && r.data[0].status === 'overdue');
  check('fine so far is 6 days x Rs 2 = Rs 12', r.data[0].fine === 12);
  r = await call('/transactions?active=true', { token: stu });
  check('student sees the overdue fine', r.data[0].fine === 12 && r.data[0].status === 'overdue');
  r = await call('/reports', { token: lib });
  check('report counts copies on shelf correctly', r.data.totalCopies === 29 && r.data.availableCopies === 28);
  check('report counts 1 overdue and Rs 12 pending', r.data.overdueNow === 1 && r.data.finesPending === 12);
  r = await call('/transactions/return', { method: 'POST', token: lib, body: { transactionId: lateLoanId } });
  check('late return saves the Rs 12 fine', r.status === 200 && r.data.transaction.fine === 12);
  r = await call('/transactions/' + lateLoanId + '/pay', { method: 'POST', token: lib });
  check('fine can be marked paid', r.status === 200 && r.data.finePaid === true);
  r = await call('/reports', { token: lib });
  check('report shows Rs 12 collected, none pending', r.data.finesCollected === 12 && r.data.finesPending === 0);
  check('report lists the most borrowed book', r.data.popular.length >= 1 && r.data.popular[0].title === 'Test Book');

  console.log('\nReservations');
  // Eloquent JavaScript has 2 copies. Issue both, then a student reserves it.
  const books = (await call('/books?search=eloquent', { token: lib })).data;
  const eloq = books[0]._id;
  await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: eloq, studentId: newStudentId } });
  const twayib = (await call('/users', { token: lib })).data.find(s => s.email === 'twayib@student.com');
  await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: eloq, studentId: twayib._id } });
  r = await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: eloq, studentId: suhaasId } });
  check('cannot issue when no copies are left', r.status === 400);
  r = await call('/reservations', { method: 'POST', token: stu, body: { bookId: eloq } });
  check('student can reserve an unavailable book', r.status === 201);
  const reservationId = r.data._id;
  r = await call('/reservations', { method: 'POST', token: stu, body: { bookId: eloq } });
  check('cannot reserve the same book twice', r.status === 400);
  r = await call('/reservations', { method: 'POST', token: stu, body: { bookId: testBookId } });
  check('cannot reserve a book that is available', r.status === 400);
  r = await call('/reservations', { token: stu });
  check('student sees own reservation', r.data.length === 1);
  r = await call('/reservations/' + reservationId, { method: 'DELETE', token: stu });
  check('student can cancel a reservation', r.status === 200);

  console.log('\nSafety checks');
  r = await call('/books/' + eloq, { method: 'DELETE', token: lib });
  check('cannot delete a book that is issued', r.status === 400);
  r = await call('/users/' + newStudentId, { method: 'DELETE', token: lib });
  check('cannot remove a student who has books', r.status === 400);
  r = await call('/books/not-an-id', { token: lib });
  check('bad id gives a clean error, not a crash', r.status === 400);


  // ---------------------------------------------------------------
  const DAY2 = 86400000;
  const login = async email => {
    const x = await call('/auth/login', { method: 'POST', body: { email, password: 'password123' } });
    return { token: x.data.token, id: x.data.user && x.data.user.id, status: x.status };
  };
  const lastCode = email => [...outbox].reverse().find(m => m.to === email).text.match(/code is (\d{6})/)[1];
  const reg = (over = {}) => call('/auth/register', { method: 'POST', body: {
    name: 'Reg Person', email: 'reg@college.edu', password: 'longpassword', role: 'student', memberId: 'USN-900', ...over } });

  console.log('\nRegistration is verified by email');
  r = await reg({ password: 'short' });
  check('short password is rejected', r.status === 400);
  r = await reg({ email: 'not-an-email' });
  check('bad email is rejected', r.status === 400);
  r = await reg({ memberId: '' });
  check('USN / staff ID is required', r.status === 400);
  r = await reg({ role: 'librarian' });
  check('nobody can register as a librarian', r.status === 400);
  process.env.ALLOWED_EMAIL_DOMAINS = 'college.edu';
  r = await reg({ email: 'someone@gmail.com' });
  check('only the allowed college email domain can register', r.status === 400);
  process.env.ALLOWED_EMAIL_DOMAINS = '';

  r = await reg();
  check('register returns a message, NOT a login token', r.status === 201 && !r.data.token);
  check('a 6-digit code was emailed', outbox.some(m => m.to === 'reg@college.edu' && /\d{6}/.test(m.text)));
  r = await call('/auth/login', { method: 'POST', body: { email: 'reg@college.edu', password: 'longpassword' } });
  check('cannot log in before verifying the email', r.status === 403 && r.data.needsVerification === true);
  r = await reg({ memberId: 'USN-901' });
  check('asking again straight away is slowed down (429)', r.status === 429);
  r = await call('/auth/verify-email', { method: 'POST', body: { email: 'reg@college.edu', code: '000000' } });
  check('wrong code is rejected', r.status === 400);
  r = await call('/auth/verify-email', { method: 'POST', body: { email: 'reg@college.edu', code: lastCode('reg@college.edu') } });
  check('right code activates the student and logs them in', r.status === 200 && r.data.token && r.data.user.role === 'student');
  r = await reg();
  check('a verified email cannot be registered again', r.status === 400);
  r = await reg({ email: 'other@college.edu', memberId: 'usn-900' });
  check('the same USN cannot be used twice', r.status === 400);

  // never-finished registration can be restarted (nobody can block someone else's email)
  await reg({ email: 'late@college.edu', memberId: 'USN-910' });
  await User.updateOne({ email: 'late@college.edu' }, { verifySentAt: new Date(Date.now() - 120000) });
  r = await reg({ email: 'late@college.edu', memberId: 'USN-910', name: 'Late Person' });
  check('an unfinished registration can be restarted', r.status === 201);
  r = await call('/auth/verify-email', { method: 'POST', body: { email: 'late@college.edu', code: lastCode('late@college.edu') } });
  check('the newest code works', r.status === 200);

  await reg({ email: 'expire@college.edu', memberId: 'USN-911' });
  await User.updateOne({ email: 'expire@college.edu' }, { verifyExpires: new Date(Date.now() - 1000) });
  r = await call('/auth/verify-email', { method: 'POST', body: { email: 'expire@college.edu', code: lastCode('expire@college.edu') } });
  check('an expired code is rejected', r.status === 400);

  await reg({ email: 'guess@college.edu', memberId: 'USN-912' });
  for (let k = 0; k < 5; k++) await call('/auth/verify-email', { method: 'POST', body: { email: 'guess@college.edu', code: '111111' } });
  r = await call('/auth/verify-email', { method: 'POST', body: { email: 'guess@college.edu', code: lastCode('guess@college.edu') } });
  check('after 5 wrong tries even the right code is refused', r.status === 400);

  await reg({ email: 'prof@college.edu', memberId: 'STAFF-900', role: 'faculty', name: 'Prof Test' });
  r = await call('/auth/verify-email', { method: 'POST', body: { email: 'prof@college.edu', code: lastCode('prof@college.edu') } });
  check('faculty email verified but NOT logged in yet', r.status === 200 && !r.data.token && r.data.approved === false);
  r = await call('/auth/login', { method: 'POST', body: { email: 'prof@college.edu', password: 'longpassword' } });
  check('faculty cannot log in before the librarian approves', r.status === 403);
  r = await call('/reports', { token: lib });
  check('dashboard counts 1 faculty waiting', r.data.pendingApprovals === 1);
  const profId = (await call('/users', { token: lib })).data.find(m => m.email === 'prof@college.edu')._id;
  r = await call('/users/' + profId + '/approve', { method: 'POST', token: stu });
  check('a student cannot approve anyone', r.status === 403);
  r = await call('/users/' + profId + '/approve', { method: 'POST', token: lib });
  check('librarian approves the faculty account', r.status === 200);
  r = await call('/auth/login', { method: 'POST', body: { email: 'prof@college.edu', password: 'longpassword' } });
  check('approved faculty can log in', r.status === 200 && r.data.user.role === 'faculty');

  // a removed member's old login token must stop working at once
  r = await call('/users', { method: 'POST', token: lib, body: { name: 'Temp', email: 'temp@x.com', password: 'password123', memberId: 'TMP-1' } });
  const tmp = await login('temp@x.com');
  check('librarian-added members are active straight away', tmp.status === 200);
  await call('/users/' + r.data.id, { method: 'DELETE', token: lib });
  r = await call('/books', { token: tmp.token });
  check('a removed member\'s token stops working', r.status === 401);

  console.log('\nStudents and faculty borrow by themselves (free)');
  const fac = await login('faculty@library.com');
  const sid = await login('siddharth@student.com');
  const mk = async (title, copies) => (await call('/books', { method: 'POST', token: lib, body: { title, author: 'T', isbn: 'ISBN-' + title, category: 'Test', totalCopies: copies } })).data._id;
  const [A, B, C, D] = [await mk('Lim A', 5), await mk('Lim B', 5), await mk('Lim C', 5), await mk('Lim D', 5)];

  r = await call('/books?search=Lim A', { token: stu });
  check('books list tells a member they can borrow', r.data[0].canBorrow === true && r.data[0].borrowedByMe === false);
  r = await call('/transactions/borrow', { method: 'POST', token: lib, body: { bookId: A } });
  check('a librarian cannot use the member borrow button', r.status === 403);
  r = await call('/transactions/borrow', { method: 'POST', token: stu, body: { bookId: A } });
  check('a student can borrow a book', r.status === 201);
  const dueDays = Math.round((new Date(r.data.transaction.dueDate) - new Date().setHours(0, 0, 0, 0)) / DAY2);
  check('due date is 14 days away and there is no borrowing charge', dueDays === 14 && !r.data.transaction.fine);
  r = await call('/books/' + A, { token: lib });
  check('available copies went down', r.data.availableCopies === 4);
  r = await call('/transactions/borrow', { method: 'POST', token: stu, body: { bookId: A } });
  check('cannot borrow the same book twice', r.status === 400);
  r = await call('/books?search=Lim A', { token: stu });
  check('the screen now shows "You have this"', r.data[0].borrowedByMe === true);

  r = await call('/transactions/borrow', { method: 'POST', token: fac.token, body: { bookId: A } });
  check('a faculty member can borrow a book', r.status === 201);
  r = await call('/transactions', { token: fac.token });
  check('faculty sees ONLY their own loans', r.data.length === 1 && r.data[0].book.title === 'Lim A');
  r = await call('/reservations', { token: fac.token });
  check('faculty sees only their own reservations', r.status === 200 && r.data.every(x => x.student.email === 'faculty@library.com'));
  r = await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: B, studentId: fac.id } });
  check('the librarian can issue a book to faculty too', r.status === 201);
  r = await call('/transactions/borrow', { method: 'POST', token: stu, body: { bookId: 'nonsense' } });
  check('a bad book id gives a clean error', r.status === 400);

  console.log('\nLimits and dues');
  for (const book of [A, B, C]) await call('/transactions/borrow', { method: 'POST', token: sid.token, body: { bookId: book } });
  r = await call('/transactions/borrow', { method: 'POST', token: sid.token, body: { bookId: D } });
  check('a student cannot hold more than 3 books', r.status === 400 && /at most 3/.test(r.data.message));
  r = await call('/transactions/issue', { method: 'POST', token: lib, body: { bookId: D, studentId: sid.id } });
  check('the librarian cannot bypass the limit either', r.status === 400);
  r = await call('/transactions/borrow', { method: 'POST', token: fac.token, body: { bookId: C } });
  r = await call('/transactions/borrow', { method: 'POST', token: fac.token, body: { bookId: D } });
  check('faculty may hold up to 5 books', r.status === 201);

  // an overdue book blocks new borrowing; so does an unpaid fine
  const facLoan = (await call('/transactions?active=true', { token: fac.token })).data.find(t => t.book.title === 'Lim A');
  await Transaction.findByIdAndUpdate(facLoan._id, { issueDate: new Date(Date.now() - 20 * DAY2), dueDate: new Date(Date.now() - 6 * DAY2) });
  const E = await mk('Lim E', 2);
  r = await call('/transactions/borrow', { method: 'POST', token: fac.token, body: { bookId: E } });
  check('an overdue book blocks borrowing another', r.status === 400 && /overdue/.test(r.data.message));
  r = await call('/transactions?active=true', { token: fac.token });
  check('an overdue faculty loan shows Rs 0 fine (faculty pay no late fee)', r.data.find(t => t._id === facLoan._id).fine === 0);
  r = await call('/transactions/return', { method: 'POST', token: lib, body: { transactionId: facLoan._id } });
  check('faculty returning 6 days late is NOT fined', r.status === 200 && r.data.transaction.fine === 0);
  r = await call('/transactions/borrow', { method: 'POST', token: fac.token, body: { bookId: E } });
  check('faculty can borrow again right after returning (no fine owed)', r.status === 201);
  r = await call('/transactions/rules', { token: fac.token });
  check('rules tell faculty the late fee is 0', r.data.finePerDay === 0 && r.data.fines.student === 2);
  r = await call('/transactions/rules', { token: stu });
  check('rules tell students the late fee is Rs 2', r.data.finePerDay === 2);

  // students DO pay: an unpaid fine blocks borrowing until it is paid
  const sc = await call('/users', { method: 'POST', token: lib, body: { name: 'Fine Student', email: 'fine@x.com', password: 'password123', memberId: 'FINE-1' } });
  const fs2 = await login('fine@x.com');
  r = await call('/transactions/borrow', { method: 'POST', token: fs2.token, body: { bookId: E } });
  await Transaction.findByIdAndUpdate(r.data.transaction._id, { issueDate: new Date(Date.now() - 20 * DAY2), dueDate: new Date(Date.now() - 6 * DAY2) });
  r = await call('/transactions/borrow', { method: 'POST', token: fs2.token, body: { bookId: A } });
  check('an overdue book blocks a student from borrowing another', r.status === 400 && /overdue/.test(r.data.message));
  const stuLoan = (await call('/transactions?active=true', { token: fs2.token })).data[0];
  r = await call('/transactions/return', { method: 'POST', token: lib, body: { transactionId: stuLoan._id } });
  check('a student returning 6 days late is fined Rs 12', r.data.transaction.fine === 12);
  r = await call('/transactions/borrow', { method: 'POST', token: fs2.token, body: { bookId: A } });
  check('an unpaid fine (Rs 12) blocks borrowing', r.status === 400 && /Rs 12/.test(r.data.message));
  r = await call('/users/' + sc.data.id, { method: 'DELETE', token: lib });
  check('a member with an unpaid fine cannot be removed', r.status === 400);
  await call('/transactions/' + stuLoan._id + '/pay', { method: 'POST', token: lib });
  r = await call('/transactions/borrow', { method: 'POST', token: fs2.token, body: { bookId: A } });
  check('after the fine is paid, borrowing works again', r.status === 201);
  r = await call('/users/' + fac.id, { method: 'DELETE', token: lib });
  check('a member who still has books cannot be removed', r.status === 400);

  console.log('\nReservations keep copies for the people who waited');
  const H = await mk('Hold Book', 1);
  const nsi = await login('twayib@student.com');
  r = await call('/transactions/borrow', { method: 'POST', token: stu, body: { bookId: H } });
  check('the last copy can be borrowed', r.status === 201);
  const holdLoan = r.data.transaction._id;
  r = await call('/books?search=Hold Book', { token: nsi.token });
  check('with no copy free, canBorrow is false', r.data[0].canBorrow === false);
  r = await call('/reservations', { method: 'POST', token: nsi.token, body: { bookId: H } });
  check('first member reserves', r.status === 201);
  const twayibRes = r.data._id;
  r = await call('/reservations', { method: 'POST', token: fac.token, body: { bookId: H } });
  check('faculty can reserve too (second in the queue)', r.status === 201);
  await call('/transactions/return', { method: 'POST', token: lib, body: { transactionId: holdLoan } });
  r = await call('/books?search=Hold Book', { token: sid.token });
  check('someone who did not reserve is not offered the copy', r.data[0].canBorrow === false);
  await call('/users', { method: 'POST', token: lib, body: { name: 'Walk In', email: 'walk@x.com', password: 'password123', memberId: 'WALK-1' } });
  const walk = await login('walk@x.com');
  r = await call('/transactions/borrow', { method: 'POST', token: walk.token, body: { bookId: H } });
  check('a walk-in cannot jump the queue', r.status === 400 && /reserved/.test(r.data.message));
  r = await call('/transactions/borrow', { method: 'POST', token: fac.token, body: { bookId: H } });
  check('second in the queue must wait for the first', r.status === 400);
  r = await call('/transactions/borrow', { method: 'POST', token: nsi.token, body: { bookId: H } });
  check('the first in the queue can borrow it', r.status === 201);
  r = await call('/reservations', { token: nsi.token });
  check('and their reservation is marked done', !r.data.some(x => x._id === twayibRes));
  const facRes = (await call('/reservations', { token: lib })).data.find(x => x.student.email === 'faculty@library.com');
  r = await call('/reservations/' + facRes._id, { method: 'DELETE', token: lib });
  check('a librarian can cancel anyone\'s reservation', r.status === 200);

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
