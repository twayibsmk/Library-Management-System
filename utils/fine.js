// Library rules come from the .env file, with safe defaults.
const LOAN_DAYS = Number(process.env.LOAN_DAYS) || 14;
// Late fee per day, by role. Students pay; faculty do not (set FINE_PER_DAY_FACULTY in .env to charge them).
const FINE_PER_DAY = Number(process.env.FINE_PER_DAY) || 2;
const FINE_PER_DAY_BY_ROLE = {
  student: FINE_PER_DAY,
  faculty: process.env.FINE_PER_DAY_FACULTY !== undefined && process.env.FINE_PER_DAY_FACULTY !== '' ? Number(process.env.FINE_PER_DAY_FACULTY) : 0,
};
const finePerDayFor = role => (role in FINE_PER_DAY_BY_ROLE ? FINE_PER_DAY_BY_ROLE[role] : FINE_PER_DAY);
const DAY = 24 * 60 * 60 * 1000;

// Today's date at midnight, so we count whole days.
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// How many days late is this loan? 0 if not late.
function daysLate(dueDate, endDate = new Date()) {
  const late = Math.round((startOfDay(endDate) - startOfDay(dueDate)) / DAY);
  return Math.max(0, late);
}

// Fine = days late x the fine per day for that role (0 for faculty by default).
function calculateFine(dueDate, returnDate, role = 'student') {
  return daysLate(dueDate, returnDate || new Date()) * finePerDayFor(role);
}

function addDays(date, days) {
  return new Date(startOfDay(date).getTime() + days * DAY);
}

module.exports = { LOAN_DAYS, FINE_PER_DAY, FINE_PER_DAY_BY_ROLE, finePerDayFor, startOfDay, daysLate, calculateFine, addDays };
