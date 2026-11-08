// Sends emails (the verification code). Uses any SMTP account, for example Gmail.
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=you@gmail.com  SMTP_PASS=<app password>
// If SMTP is not set up:
//   - on your own computer the code is printed in the terminal (so you can still try the system)
//   - on a real website (NODE_ENV=production) registration is refused, so nobody skips verification.
const nodemailer = require('nodemailer');

const outbox = []; // last emails, only kept in development (the tests read the code from here)

let transporter;
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendMail(to, subject, text) {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error('Email is not set up on the server yet. Ask the librarian.');
      err.status = 503;
      throw err;
    }
    console.log(`\n[DEV EMAIL - SMTP not set up]\nTo: ${to}\n${subject}\n${text}\n`);
    outbox.push({ to, subject, text });
    return;
  }
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to, subject, text,
  });
}

module.exports = { sendMail, outbox };
