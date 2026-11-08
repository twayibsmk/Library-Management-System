# Library Management System

Mini project by Suhaas S, Twayib K and Siddharth K.
Built with Node.js, Express and MongoDB. The web pages are plain HTML, CSS and JavaScript, so there is nothing to build.

## What it does

**Librarian:** log in, add / edit / delete books, manage students, issue books, accept returns, see overdue books, track and collect fines, view reports, see reservations.

**Student:** log in, search books, check availability, see issued books, due dates and reminders, view fines, reserve books that are out.

Rules (change them in `.env`): a loan lasts 14 days, and the fine is Rs 2 per day after the due date.

## Run it (5 steps)

1. Install **Node.js (LTS)** from nodejs.org.
2. Get a database. Pick one:
   - **MongoDB Atlas (free, easiest to share as a team):** create a free cluster at mongodb.com/atlas, add a database user, allow your IP, and copy the connection string.
   - **Local MongoDB:** install MongoDB Community Server. Then the connection string is `mongodb://127.0.0.1:27017/library`.
3. In this folder, copy `.env.example` to a new file named `.env` and put your connection string in `MONGO_URI`. Change `JWT_SECRET` to any long random text.
4. Install and add the sample data:
   ```
   npm install
   npm run seed
   ```
5. Start it, then open http://localhost:5000
   ```
   npm start
   ```

**Demo logins** (password for all: `password123`)

| Role | Email |
| --- | --- |
| Librarian | librarian@library.com |
| Student | suhaas@student.com |
| Student | twayib@student.com |
| Student | siddharth@student.com |
| Faculty | faculty@library.com |

`npm run seed` wipes the database and re-adds this sample data. Do not run it after you have added your own data.

## Registration, email verification and borrowing

- **Register:** a student or faculty member enters name, email, USN / staff ID and password. We email a 6-digit code (valid 10 minutes, 5 tries). Only after typing it can they log in, so nobody can sign up with an email they do not own. Set `ALLOWED_EMAIL_DOMAINS` in `.env` to accept college emails only.
- **Faculty** must also be **approved by the librarian** (Members tab > Approve), because anyone could choose "faculty" on the form.
- **Email setup:** put the `SMTP_...` lines from `.env.example` in `.env` (a Gmail app password works). Without them the code is printed in the terminal, which is fine on your own laptop. On Vercel (production) registration is refused until SMTP is set, so verification can never be skipped.
- **Borrowing is free** for students and faculty. Press **Borrow** on the Search Books screen. Rules: at most 3 books (students) or 5 (faculty), none while a book is overdue or a fine is unpaid, and copies are kept for members who reserved first. Returns are accepted by the librarian.
- **Students and faculty are told apart by the `role` saved on the account.** It is chosen at registration (faculty must be approved by the librarian) and cannot be changed by the user. The differences are set in one place, `utils/fine.js` and `utils/borrowing.js`:

| | Student | Faculty |
| --- | --- | --- |
| Borrowing | free | free |
| Books at a time | 3 | 5 |
| Loan period | 14 days | 14 days |
| Late fine | Rs 2 per day | none |
| Overdue book blocks new borrowing | yes | yes |

  Change them in `.env`: `MAX_BOOKS_STUDENT`, `MAX_BOOKS_FACULTY`, `FINE_PER_DAY`, `FINE_PER_DAY_FACULTY` (0 by default).
- Members added by the librarian are active at once (the librarian has checked them in person).

## Check that everything works

```
npm test
```

This runs about 100 checks of the whole system (registration with email code, login, roles, borrowing, limits, fines, reservations). It resets the database in `MONGO_URI`, so point it at a test database, for example `mongodb://127.0.0.1:27017/library_test`.

## How the code is organised

```
server.js            starts the app and connects the routes
seed.js              adds sample data
test.js              end-to-end checks
models/              what we store in MongoDB
  User.js  Book.js  Transaction.js  Reservation.js
routes/              the REST API, one file per topic
  auth.js  books.js  users.js  transactions.js  reservations.js  reports.js
middleware/auth.js   checks login and librarian-only access
utils/fine.js        due date and fine calculation
public/              the web pages (index.html, style.css, app.js)
```

Start reading at `utils/fine.js` (short, and it is the heart of the project), then `routes/transactions.js`.

## The API

| Method and path | Who | What it does |
| --- | --- | --- |
| POST /api/auth/login | everyone | Log in, get a token |
| GET /api/books?search=&category= | logged in | Search books |
| POST / PUT / DELETE /api/books | librarian | Add, update, delete books |
| GET / POST / DELETE /api/users | librarian | Manage students |
| POST /api/transactions/issue | librarian | Issue a book (due in 14 days) |
| POST /api/transactions/return | librarian | Accept a return, save the fine |
| GET /api/transactions | logged in | Librarian: all. Student: own |
| GET /api/transactions/overdue | librarian | Overdue books with fines |
| POST /api/transactions/:id/pay | librarian | Mark a fine as paid |
| GET / POST / DELETE /api/reservations | logged in | Reserve books (students) |
| GET /api/reports | librarian | Dashboard numbers |

Every request after login sends the header `Authorization: Bearer <token>`.

## Ideas for later (from the base paper)

The API is split into small parts so these can be added without rewriting: QR codes or RFID for fast book lookup, email reminders (for example with `node-cron` and `nodemailer`), a React frontend, a mobile app. Reminders already show inside the student's "My Books" page for books due in 2 days or less.

## Deploy on Vercel

1. Push the folder to GitHub and import it in Vercel.
2. In Project Settings > Environment Variables add `MONGO_URI` (your MongoDB Atlas string) and `JWT_SECRET`.
3. In MongoDB Atlas > Network Access, allow `0.0.0.0/0` (Vercel has no fixed IP).
4. Redeploy. Run `npm run seed` once on your own computer (with the same MONGO_URI) to create the demo users.
