// ---------- Small helpers ----------
const $ = id => document.getElementById(id);
const state = { token: null, user: null, rules: { loanDays: 14, finePerDay: 2, fines: { student: 2, faculty: 0 } }, tab: null };

// Stops text from being treated as HTML (protects against bad input).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const showDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '–';
const money = n => n ? 'Rs ' + n : '–';

let toastTimer;
function toast(message, bad = false) {
  const t = $('toast');
  t.textContent = message;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// Talks to our server. Adds the login token to every request.
async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); }
  if (!res.ok) { const err = new Error(data.message || 'Something went wrong.'); err.data = data; throw err; }
  return data;
}

// Runs an action and shows any error as a message.
async function attempt(fn) {
  try { await fn(); } catch (err) { toast(err.message, true); }
}

// ---------- Auth panels: login / register / verify ----------
function showPanel(name) {
  $('panelLogin').hidden = name !== 'login';
  $('panelRegister').hidden = name !== 'register';
  $('panelVerify').hidden = name !== 'verify';
  $('tabLogin').classList.toggle('active', name === 'login');
  $('tabRegister').classList.toggle('active', name === 'register');
  document.querySelector('.auth-tabs').hidden = name === 'verify';
}
$('tabLogin').addEventListener('click', () => showPanel('login'));
$('tabRegister').addEventListener('click', () => showPanel('register'));
$('rRole').addEventListener('change', () => {
  $('rIdLabel').textContent = $('rRole').value === 'faculty' ? 'Staff ID' : 'USN';
});

let pendingEmail = ''; // the email we are verifying
function askForCode(email, message) {
  pendingEmail = email;
  $('verifyInfo').textContent = message;
  $('vCode').value = '';
  $('verifyError').hidden = true;
  showPanel('verify');
}

function loginDone(data) {
  state.token = data.token;
  state.user = data.user;
  sessionStorage.setItem('lms', JSON.stringify({ token: data.token, user: data.user }));
  startApp();
}

// ---------- Login ----------
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').hidden = true;
  try {
    loginDone(await api('/auth/login', 'POST', { email: $('email').value, password: $('password').value }));
  } catch (err) {
    if (err.data && err.data.needsVerification) return askForCode(err.data.email, err.message);
    $('loginError').textContent = err.message;
    $('loginError').hidden = false;
  }
});

// ---------- Register (step 1: details, step 2: emailed code) ----------
$('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('registerError').hidden = true;
  try {
    const data = await api('/auth/register', 'POST', {
      name: $('rName').value,
      email: $('rEmail').value,
      password: $('rPassword').value,
      role: $('rRole').value,
      memberId: $('rMemberId').value,
    });
    askForCode(data.email, data.message + ' Enter it below.');
  } catch (err) {
    $('registerError').textContent = err.message;
    $('registerError').hidden = false;
  }
});

$('verifyForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('verifyError').hidden = true;
  try {
    const data = await api('/auth/verify-email', 'POST', { email: pendingEmail, code: $('vCode').value });
    if (data.approved) { toast(data.message); loginDone(data); return; }
    showPanel('login');
    $('loginError').textContent = data.message;
    $('loginError').hidden = false;
  } catch (err) {
    $('verifyError').textContent = err.message;
    $('verifyError').hidden = false;
  }
});

$('resendCode').addEventListener('click', () => attempt(async () => {
  const data = await api('/auth/resend-code', 'POST', { email: pendingEmail });
  toast(data.message);
}));

// ---------- Logout ----------
function logout() {
  state.token = null; state.user = null;
  sessionStorage.removeItem('lms');
  $('appScreen').hidden = true;
  $('loginScreen').hidden = false;
  $('password').value = '';
  showPanel('login');
}
$('logout').onclick = logout;

// ---------- Tabs ----------
// faculty gets same tabs as student — cannot add/edit/delete books
const TABS = {
  librarian: [
    ['dashboard', 'Dashboard'], ['books', 'Books'], ['members', 'Members'],
    ['issue', 'Issue & Return'], ['requests', 'Borrow Requests'], ['overdue', 'Overdue'], ['history', 'History & Fines'], ['reservations', 'Reservations'],
  ],
  student:  [['books', 'Search Books'], ['mine', 'My Books & Fines'], ['reservations', 'My Reservations']],
  faculty:  [['books', 'Search Books'], ['mine', 'My Books & Fines'], ['reservations', 'My Reservations']],
};

async function startApp() {
  $('loginScreen').hidden = true;
  $('appScreen').hidden = false;
  $('who').textContent = `${state.user.name} (${state.user.role})`;
  state.rules = await api('/transactions/rules').catch(() => state.rules);
  if (!state.rules.maxBooks) state.rules.maxBooks = { student: 3, faculty: 5 };
  if (!state.rules.fines) state.rules.fines = { student: state.rules.finePerDay, faculty: 0 };
  openTab(TABS[state.user.role][0][0]);
}

function openTab(name) {
  state.tab = name;
  $('tabs').innerHTML = TABS[state.user.role]
    .map(([id, label]) => `<button data-tab="${id}" class="${id === name ? 'active' : ''}">${label}</button>`)
    .join('');
  $('content').innerHTML = '<p class="muted">Loading...</p>';
  attempt(() => screens[name]());
}

$('tabs').addEventListener('click', e => {
  if (e.target.dataset.tab) openTab(e.target.dataset.tab);
});

// ---------- Reusable table pieces ----------
function statusPill(t) {
  if (t.status === 'overdue') return '<span class="pill bad">Overdue</span>';
  if (t.status === 'returned') return '<span class="pill off">Returned</span>';
  if (t.dueSoon) return '<span class="pill warn">Due soon</span>';
  return '<span class="pill ok">Issued</span>';
}
function table(headers, rows, emptyText) {
  if (!rows.length) return `<p class="empty">${emptyText}</p>`;
  return `<div class="scroll"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------- The screens ----------
const screens = {};

// Librarian: numbers at a glance
screens.dashboard = async () => {
  const r = await api('/reports');
  $('content').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${r.totalTitles}</b><span>Titles</span></div>
      <div class="stat"><b>${r.availableCopies} / ${r.totalCopies}</b><span>Copies on shelf</span></div>
      <div class="stat"><b>${r.totalMembers}</b><span>Members</span></div>
      ${r.pendingApprovals ? `<div class="stat"><b>${r.pendingApprovals}</b><span>Faculty to approve</span></div>` : ''}
      <div class="stat"><b>${r.issuedNow}</b><span>Issued now</span></div>
      <div class="stat"><b>${r.overdueNow}</b><span>Overdue</span></div>
      <div class="stat"><b>Rs ${r.finesPending}</b><span>Fines pending</span></div>
      <div class="stat"><b>Rs ${r.finesCollected}</b><span>Fines collected</span></div>
      <div class="stat"><b>${r.totalBorrowings}</b><span>Total borrowings</span></div>
    </div>
    <div class="card"><h2>Most borrowed books</h2>
      ${table(['Book', 'Author', 'Times borrowed'],
        r.popular.map(p => `<tr><td>${esc(p.title)}</td><td>${esc(p.author)}</td><td>${p.times}</td></tr>`),
        'No borrowing yet.')}
    </div>`;
};

// Both roles: search books. Librarian can also add, edit and delete.
// Students and faculty CANNOT add/edit/delete books — enforced both by API (403) and UI (form hidden).
screens.books = async () => {
  const isLib = state.user.role === 'librarian';
  const categories = await api('/books/categories');
  $('content').innerHTML = `
    ${isLib ? `
    <form id="bookForm" class="card">
      <h2 id="bookFormTitle">Add a book</h2>
      <input type="hidden" id="bookId">
      <div class="row">
        <label>Title <input id="bTitle" required></label>
        <label>Author <input id="bAuthor" required></label>
        <label>ISBN <input id="bIsbn" required></label>
        <label>Category <input id="bCategory" placeholder="e.g. Computer Science"></label>
        <label>Copies <input id="bCopies" type="number" min="1" value="1" required></label>
        <button class="btn" type="submit" id="bookSave">Add book</button>
        <button class="btn ghost" type="button" id="bookCancel" hidden>Cancel</button>
      </div>
    </form>` : ''}
    ${isLib ? '' : `<p class="muted small">Borrowing is free. Up to ${state.rules.maxBooks[state.user.role]} books at a time, for ${state.rules.loanDays} days. ${state.rules.finePerDay ? `A late fee of Rs ${state.rules.finePerDay} per day applies only if you return a book after the due date.` : 'There is no late fee for faculty, but please return books on time so others can borrow them.'}</p>`}
    <div class="card">
      <div class="row">
        <label>Search <input id="search" type="search" placeholder="Title, author, ISBN or category"></label>
        <label>Category <select id="category"><option value="">All</option>
          ${categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      </div>
      <div id="bookList"></div>
    </div>`;

  async function loadBooks() {
    const q = encodeURIComponent($('search').value);
    const c = encodeURIComponent($('category').value);
    const books = await api(`/books?search=${q}&category=${c}`);
    $('bookList').innerHTML = table(
      ['Book', 'ISBN', 'Category', 'Available', ''],
      books.map(b => {
        let buttons = '';
        if (isLib) {
          buttons = `<button class="btn ghost" data-action="editBook" data-id="${b._id}">Edit</button>
                     <button class="btn danger" data-action="deleteBook" data-id="${b._id}">Delete</button>`;
        } else if (b.borrowedByMe) {
          buttons = '<span class="pill off">You have this</span>';
        } else if (b.requestedByMe) {
          buttons = '<span class="pill warn">Request pending</span>';
        } else if (b.canBorrow) {
          buttons = `<button class="btn" data-action="requestBorrow" data-id="${b._id}">Request to Borrow</button>`;
        } else {
          buttons = `<button class="btn ghost" data-action="reserve" data-id="${b._id}">Reserve</button>`;
        }
        return `<tr><td>${esc(b.title)}<div class="sub">${esc(b.author)}</div></td><td>${esc(b.isbn)}</td>
          <td>${esc(b.category)}</td>
          <td><span class="pill ${b.availableCopies ? 'ok' : 'warn'}">${b.availableCopies} of ${b.totalCopies}</span></td>
          <td class="actions">${buttons}</td></tr>`;
      }),
      'No books match your search.'
    );
    window.currentBooks = books;
  }
  $('search').addEventListener('input', () => attempt(loadBooks));
  $('category').addEventListener('change', () => attempt(loadBooks));
  screens.books.reload = loadBooks;
  await loadBooks();

  if (isLib) {
    $('bookForm').addEventListener('submit', e => {
      e.preventDefault();
      attempt(async () => {
        const body = {
          title: $('bTitle').value, author: $('bAuthor').value, isbn: $('bIsbn').value,
          category: $('bCategory').value, totalCopies: $('bCopies').value,
        };
        const id = $('bookId').value;
        await (id ? api('/books/' + id, 'PUT', body) : api('/books', 'POST', body));
        toast(id ? 'Book updated.' : 'Book added.');
        screens.books();
      });
    });
    $('bookCancel').onclick = () => screens.books();
  }
};

// Librarian: manage members (students + faculty)
screens.members = async () => {
  const members = await api('/users');
  $('content').innerHTML = `
    <form id="memberForm" class="card">
      <h2>Add a member</h2>
      <div class="row">
        <label>Name <input id="sName" required></label>
        <label>Email <input id="sEmail" type="email" required></label>
        <label>USN / Staff ID <input id="sMemberId" maxlength="20"></label>
        <label>Password (8+ chars) <input id="sPassword" type="password" minlength="8" required></label>
        <label>Role
          <select id="sRole">
            <option value="student">Student</option>
            <option value="faculty">Faculty</option>
          </select>
        </label>
        <button class="btn" type="submit">Add member</button>
      </div>
    </form>
    <div class="card"><h2>Members</h2>
      ${table(['Name', 'ID', 'Email', 'Role', 'Status', ''],
        members.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.memberId || '–')}</td><td>${esc(s.email)}</td>
          <td><span class="pill ${s.role === 'faculty' ? 'warn' : 'ok'}">${esc(s.role)}</span></td>
          <td>${s.status === 'pending' ? '<span class="pill warn">Needs approval</span>' : s.status === 'unverified' ? '<span class="pill off">Email not verified</span>' : '<span class="pill ok">Active</span>'}</td>
          <td class="actions">${s.status === 'pending' ? `<button class="btn" data-action="approveMember" data-id="${s._id}">Approve</button>` : ''}
            <button class="btn danger" data-action="deleteMember" data-id="${s._id}">Remove</button></td></tr>`),
        'No members yet.')}
    </div>`;
  $('memberForm').addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api('/users', 'POST', {
        name: $('sName').value,
        email: $('sEmail').value,
        password: $('sPassword').value,
        role: $('sRole').value,
        memberId: $('sMemberId').value,
      });
      toast('Member added.');
      screens.members();
    });
  });
};

// Librarian: issue a book and accept returns
screens.issue = async () => {
  const [allMembers, books, active] = await Promise.all([
    api('/users'), api('/books'), api('/transactions?active=true'),
  ]);
  const members = allMembers.filter(m => m.status === 'active');
  const free = books.filter(b => b.availableCopies > 0);

  $('content').innerHTML = `
    <form id="issueForm" class="card">
      <h2>Issue a book</h2>
      <div class="row" style="flex-wrap:wrap;gap:8px;align-items:flex-end;">
        <label style="display:flex;flex-direction:column;gap:4px;">
          Member
          <input id="memberSearch" type="text" placeholder="Search member…" style="margin-bottom:4px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" autocomplete="off">
          <select id="iStudent" required size="4" style="min-width:200px;border-radius:6px;border:1px solid #d1d5db;padding:4px;">
            ${members.map(s => `<option value="${s._id}" data-label="${esc(s.name).toLowerCase()} ${s.role}">${esc(s.name)} (${s.role})</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          Book
          <input id="bookSearch" type="text" placeholder="Search book…" style="margin-bottom:4px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" autocomplete="off">
          <select id="iBook" required size="4" style="min-width:220px;border-radius:6px;border:1px solid #d1d5db;padding:4px;">
            ${free.map(b => `<option value="${b._id}" data-label="${esc(b.title).toLowerCase()}">${esc(b.title)} (${b.availableCopies} left)</option>`).join('')}
          </select>
        </label>
        <button class="btn" type="submit" style="align-self:flex-end;" ${members.length && free.length ? '' : 'disabled'}>Issue</button>
      </div>
      <p class="muted small" style="margin-top:8px;">Due date is set to ${state.rules.loanDays} days from today. Late fine: Rs ${state.rules.fines.student} per day for students, ${state.rules.fines.faculty ? 'Rs ' + state.rules.fines.faculty + ' per day' : 'none'} for faculty.</p>
    </form>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <h2 style="margin:0;">Books currently issued</h2>
        <input id="issuedSearch" type="text" placeholder="🔍 Search by member or book…"
          style="padding:7px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;width:260px;" autocomplete="off">
      </div>
      <table id="issuedTable" style="width:100%;border-collapse:collapse;">
        <thead><tr>
          ${['Member','Book','Issued','Due','Status','Fine so far',''].map(h=>`<th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;font-size:13px;color:#6b7280;">${h}</th>`).join('')}
        </tr></thead>
        <tbody id="issuedTbody">
          ${active.length ? active.map(t => `
            <tr data-member="${esc(t.student?.name||'').toLowerCase()}" data-book="${esc(t.book?.title||'').toLowerCase()}">
              <td style="padding:8px 10px;">${esc(t.student?.name || 'Removed member')}</td>
              <td style="padding:8px 10px;">${esc(t.book?.title || 'Deleted book')}</td>
              <td style="padding:8px 10px;">${showDate(t.issueDate)}</td>
              <td style="padding:8px 10px;">${showDate(t.dueDate)}</td>
              <td style="padding:8px 10px;">${statusPill(t)}</td>
              <td style="padding:8px 10px;">${money(t.fine)}</td>
              <td style="padding:8px 10px;" class="actions">
                <button class="btn ghost" data-action="return" data-id="${t._id}">Accept return</button>
              </td>
            </tr>`).join('') : `<tr id="noIssuedRow"><td colspan="7" style="padding:16px 10px;color:#6b7280;text-align:center;">No books are issued right now.</td></tr>`}
        </tbody>
      </table>
      <p id="issuedEmpty" style="display:none;padding:12px;color:#6b7280;text-align:center;">No results match your search.</p>
    </div>`;

  // --- member search filter ---
  $('memberSearch').addEventListener('input', () => {
    const q = $('memberSearch').value.toLowerCase();
    Array.from($('iStudent').options).forEach(opt => {
      opt.hidden = q && !opt.dataset.label.includes(q);
    });
    // auto-select first visible
    const first = Array.from($('iStudent').options).find(o => !o.hidden);
    if (first) first.selected = true;
  });

  // --- book search filter ---
  $('bookSearch').addEventListener('input', () => {
    const q = $('bookSearch').value.toLowerCase();
    Array.from($('iBook').options).forEach(opt => {
      opt.hidden = q && !opt.dataset.label.includes(q);
    });
    const first = Array.from($('iBook').options).find(o => !o.hidden);
    if (first) first.selected = true;
  });

  // --- issued table search filter ---
  $('issuedSearch').addEventListener('input', () => {
    const q = $('issuedSearch').value.toLowerCase();
    let visible = 0;
    $('issuedTbody').querySelectorAll('tr[data-member]').forEach(row => {
      const match = !q || row.dataset.member.includes(q) || row.dataset.book.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    $('issuedEmpty').style.display = (visible === 0 && active.length > 0) ? '' : 'none';
  });

  $('issueForm').addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api('/transactions/issue', 'POST', { bookId: $('iBook').value, studentId: $('iStudent').value });
      toast('Book issued.');
      screens.issue();
    });
  });
};

// Librarian: overdue list
screens.overdue = async () => {
  const list = await api('/transactions/overdue');
  $('content').innerHTML = `<div class="card"><h2>Overdue books</h2>
    ${table(['Member', 'Book', 'Due', 'Days late', 'Fine so far', ''],
      list.map(t => {
        const late = t.daysLate;
        return `<tr><td>${esc(t.student?.name || 'Removed member')}<div class="sub">${esc(t.student?.email || '')}</div></td><td>${esc(t.book?.title || 'Deleted book')}</td>
          <td>${showDate(t.dueDate)}</td><td>${late}</td><td>${money(t.fine)}</td>
          <td class="actions"><button class="btn ghost" data-action="return" data-id="${t._id}">Accept return</button></td></tr>`;
      }),
      'Nothing is overdue.')}</div>`;
};

// Librarian: full borrowing history, mark fines as paid
screens.history = async () => {
  const list = await api('/transactions');
  $('content').innerHTML = `<div class="card"><h2>Borrowing history</h2>
    ${table(['Member', 'Book', 'Issued', 'Due', 'Returned', 'Fine', ''],
      list.map(t => {
        let fine = money(t.fine);
        let action = '';
        if (t.fine && t.returnDate) {
          fine += t.finePaid ? ' <span class="pill ok">Paid</span>' : ' <span class="pill warn">Unpaid</span>';
          if (!t.finePaid) action = `<button class="btn ghost" data-action="payFine" data-id="${t._id}">Mark paid</button>`;
        }
        return `<tr><td>${esc(t.student?.name || 'Removed member')}</td><td>${esc(t.book?.title || 'Deleted book')}</td><td>${showDate(t.issueDate)}</td>
          <td>${showDate(t.dueDate)}</td><td>${showDate(t.returnDate)}</td><td>${fine}</td><td class="actions">${action}</td></tr>`;
      }),
      'No history yet.')}</div>`;
};

// Student/Faculty: own books, due dates, reminders and fines
screens.mine = async () => {
  const list = await api('/transactions');
  const urgent = list.filter(t => t.status === 'overdue' || t.dueSoon);
  const totalFine = list.reduce((sum, t) => sum + (t.returnDate && t.finePaid ? 0 : t.fine || 0), 0);
  $('content').innerHTML = `
    ${urgent.map(t => `<div class="notice">${t.status === 'overdue'
      ? `<b>${esc(t.book?.title || 'Deleted book')}</b> is overdue. Return it soon.${state.rules.finePerDay ? ` The fine grows by Rs ${state.rules.finePerDay} each day.` : ''}`
      : `<b>${esc(t.book?.title || 'Deleted book')}</b> is due ${t.daysLeft === 0 ? 'today' : 'in ' + t.daysLeft + ' day' + (t.daysLeft > 1 ? 's' : '')} (${showDate(t.dueDate)}).`}</div>`).join('')}
    <div class="stats"><div class="stat"><b>${list.filter(t => !t.returnDate).length}</b><span>Books with you</span></div>
      <div class="stat"><b>Rs ${totalFine}</b><span>Unpaid fines</span></div></div>
    <div class="card"><h2>My borrowing</h2>
      ${table(['Book', 'Issued', 'Due', 'Returned', 'Status', 'Fine'],
        list.map(t => `<tr><td>${esc(t.book?.title || 'Deleted book')}<div class="sub">${esc(t.book?.author || '')}</div></td><td>${showDate(t.issueDate)}</td>
          <td>${showDate(t.dueDate)}</td><td>${showDate(t.returnDate)}</td><td>${statusPill(t)}</td>
          <td>${money(t.fine)}${t.fine && t.returnDate ? (t.finePaid ? ' <span class="pill ok">Paid</span>' : ' <span class="pill warn">Unpaid</span>') : ''}</td></tr>`),
        'You have not borrowed any books yet.')}</div>`;
};

// Both roles: reservations
screens.reservations = async () => {
  const isLib = state.user.role === 'librarian';
  const list = await api('/reservations');
  $('content').innerHTML = `<div class="card"><h2>${isLib ? 'Reservations' : 'My reservations'}</h2>
    ${table([isLib ? 'Member' : '', 'Book', 'Reserved on', 'Copies free now', ''],
      list.map(r => `<tr><td>${isLib ? esc(r.student.name) + ' <span class="sub">(' + esc(r.student.role) + ')</span>' : ''}</td><td>${esc(r.book.title)}</td>
        <td>${showDate(r.createdAt)}</td>
        <td>${r.book.availableCopies ? '<span class="pill ok">' + r.book.availableCopies + ' ready</span>' : '<span class="pill warn">Waiting</span>'}</td>
        <td class="actions"><button class="btn danger" data-action="cancelReservation" data-id="${r._id}">Cancel</button></td></tr>`),
      'No active reservations.')}</div>`;
};

// Librarian: pending borrow requests submitted by students / faculty
screens.requests = async () => {
  const list = await api('/borrow-requests');
  $('content').innerHTML = `<div class="card">
    <h2>Borrow Requests <span class="pill ${list.length ? 'warn' : 'ok'}" style="font-size:.85em;vertical-align:middle">${list.length} pending</span></h2>
    ${table(
      ['Member', 'Role', 'Book', 'Available copies', 'Requested on', ''],
      list.map(r => `<tr>
        <td>${esc(r.student.name)}<div class="sub">${esc(r.student.email)}</div></td>
        <td><span class="pill ${r.student.role === 'faculty' ? 'warn' : 'ok'}">${esc(r.student.role)}</span></td>
        <td>${esc(r.book.title)}<div class="sub">${esc(r.book.author)}</div></td>
        <td><span class="pill ${r.book.availableCopies > 0 ? 'ok' : 'bad'}">${r.book.availableCopies} of ${r.book.totalCopies}</span></td>
        <td>${showDate(r.createdAt)}</td>
        <td class="actions">
          <button class="btn" data-action="approveRequest" data-id="${r._id}" ${r.book.availableCopies < 1 ? 'disabled title="No copies available"' : ''}>Approve</button>
          <button class="btn danger" data-action="rejectRequest" data-id="${r._id}">Reject</button>
        </td></tr>`),
      'No pending borrow requests.'
    )}</div>`;
};

// ---------- Buttons inside the tables ----------
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.disabled) return;
  const isConfirm = btn.dataset.action === 'deleteBook' || btn.dataset.action === 'deleteMember';

  attempt(async () => {
    if (!isConfirm) btn.disabled = true; // stops a double click from sending the request twice
    switch (btn.dataset.action) {
      case 'editBook': {
        const b = window.currentBooks.find(x => x._id === id);
        $('bookId').value = b._id;
        $('bTitle').value = b.title; $('bAuthor').value = b.author; $('bIsbn').value = b.isbn;
        $('bCategory').value = b.category; $('bCopies').value = b.totalCopies;
        $('bookFormTitle').textContent = 'Edit book';
        $('bookSave').textContent = 'Save changes';
        $('bookCancel').hidden = false;
        $('bookForm').scrollIntoView({ behavior: 'smooth' });
        break;
      }
      case 'deleteBook':
        if (!btn.dataset.sure) {
          btn.dataset.sure = '1'; btn.textContent = 'Click again to confirm';
          setTimeout(() => { btn.dataset.sure = ''; btn.textContent = 'Delete'; }, 3000);
          return;
        }
        await api('/books/' + id, 'DELETE');
        toast('Book deleted.');
        screens.books();
        break;
      case 'deleteMember':
        if (!btn.dataset.sure) {
          btn.dataset.sure = '1'; btn.textContent = 'Click again to confirm';
          setTimeout(() => { btn.dataset.sure = ''; btn.textContent = 'Remove'; }, 3000);
          return;
        }
        await api('/users/' + id, 'DELETE');
        toast('Member removed.');
        screens.members();
        break;
      case 'return': {
        const result = await api('/transactions/return', 'POST', { transactionId: id });
        toast(result.message);
        openTab(state.tab);
        break;
      }
      case 'payFine':
        await api(`/transactions/${id}/pay`, 'POST');
        toast('Fine marked as paid.');
        screens.history();
        break;
      case 'requestBorrow': {
        const result = await api('/borrow-requests', 'POST', { bookId: id });
        toast(result.message);
        screens.books.reload();
        break;
      }
      case 'reserve':
        await api('/reservations', 'POST', { bookId: id });
        toast('Reserved. When a copy is free, a Borrow button appears for you.');
        screens.books.reload();
        break;
      case 'approveMember': {
        const result = await api(`/users/${id}/approve`, 'POST');
        toast(result.message);
        screens.members();
        break;
      }
      case 'cancelReservation':
        await api('/reservations/' + id, 'DELETE');
        toast('Reservation cancelled.');
        screens.reservations();
        break;
      case 'approveRequest': {
        const result = await api(`/borrow-requests/${id}/approve`, 'POST');
        toast(result.message);
        screens.requests();
        break;
      }
      case 'rejectRequest': {
        await api(`/borrow-requests/${id}/reject`, 'POST');
        toast('Request rejected.');
        screens.requests();
        break;
      }
    }
  }).finally(() => { btn.disabled = false; });
});

// ---------- Start: stay logged in while the browser tab is open ----------
try {
  const saved = JSON.parse(sessionStorage.getItem('lms'));
  if (saved && saved.token) {
    state.token = saved.token;
    state.user = saved.user;
    startApp();
  }
} catch (err) { /* no saved login, show the login screen */ }
