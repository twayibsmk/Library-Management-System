// Fills the database with a librarian, some students, a faculty member and some books.
// Run once with:  npm run seed
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Book = require('./models/Book');
const Transaction = require('./models/Transaction');
const Reservation = require('./models/Reservation');

async function seed(mongoUri = process.env.MONGO_URI) {
  await mongoose.connect(mongoUri);

  // Start fresh
  await Promise.all([User.deleteMany(), Book.deleteMany(), Transaction.deleteMany(), Reservation.deleteMany()]);

  const hash = await bcrypt.hash('password123', 10);
  await User.create([
    { name: 'Head Librarian', email: 'librarian@library.com', password: hash, role: 'librarian' },
    { name: 'Suhaas S', email: 'suhaas@student.com', password: hash, role: 'student', memberId: 'USN-001' },
    { name: 'Twayib K', email: 'twayib@student.com', password: hash, role: 'student', memberId: 'USN-002' },
    { name: 'Siddharth K', email: 'siddharth@student.com', password: hash, role: 'student', memberId: 'USN-003' },
    { name: 'Dr. Anita Rao', email: 'faculty@library.com', password: hash, role: 'faculty', memberId: 'STAFF-001' },
  ]);

  const books = [
    ['Introduction to Algorithms', 'T. Cormen', '9780262046305', 'Computer Science', 4],
    ['Database System Concepts', 'A. Silberschatz', '9780078022159', 'Computer Science', 3],
    ['Operating System Concepts', 'A. Silberschatz', '9781119800361', 'Computer Science', 3],
    ['Eloquent JavaScript', 'M. Haverbeke', '9781593279509', 'Web Development', 2],
    ['Clean Code', 'R. Martin', '9780132350884', 'Software Engineering', 5],
    ['Engineering Mathematics', 'B. S. Grewal', '9788174091952', 'Mathematics', 6],
    ['Wings of Fire', 'A. P. J. Abdul Kalam', '9788173711466', 'Biography', 3],
  ];
  await Book.create(books.map(([title, author, isbn, category, copies]) => (
    { title, author, isbn, category, totalCopies: copies, availableCopies: copies }
  )));

  console.log('Sample data added.');
  console.log('Librarian login: librarian@library.com / password123');
  console.log('Student login:   suhaas@student.com / password123');
  console.log('Faculty login:   faculty@library.com / password123');
  await mongoose.disconnect();
}

if (require.main === module) {
  seed().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = seed;
