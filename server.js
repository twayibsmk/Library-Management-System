require('dotenv').config();
require('express-async-errors'); // lets errors inside async routes reach the error handler below
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// The API
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/books',          require('./routes/books'));
app.use('/api/users',          require('./routes/users'));
app.use('/api/transactions',   require('./routes/transactions'));
app.use('/api/reservations',   require('./routes/reservations'));
app.use('/api/borrow-requests',require('./routes/borrowRequests'));
app.use('/api/reports',        require('./routes/reports'));

// The web pages (the "public" folder)
app.use(express.static(path.join(__dirname, 'public')));

// Any error in a route ends up here, so the server never crashes silently.
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ message: err.message }); // our own clear messages
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id.' });
  if (err.code === 11000) return res.status(400).json({ message: 'That value is already used.' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

async function start(mongoUri = process.env.MONGO_URI, port = process.env.PORT || 5000) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is missing. Copy .env.example to .env first.');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  return new Promise(resolve => {
    const server = app.listen(port, () => {
      console.log(`Library system running at http://localhost:${port}`);
      resolve(server);
    });
  });
}

// Run directly with "npm start"; tests import { start } instead.
if (require.main === module) {
  start().catch(err => {
    console.error('Could not start:', err.message);
    process.exit(1);
  });
}

module.exports = { app, start };
