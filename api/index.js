// Entry point for Vercel (serverless). "npm start" still uses server.js.
const mongoose = require('mongoose');
const { app } = require('../server');

let connecting; // reuse one connection between requests
function connect() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connecting) {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in Vercel Environment Variables.');
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set in Vercel Environment Variables.');
    connecting = mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
      .catch(err => { connecting = null; throw err; });
  }
  return connecting;
}

module.exports = async (req, res) => {
  try {
    await connect();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database connection failed: ' + err.message });
  }
  return app(req, res);
};
