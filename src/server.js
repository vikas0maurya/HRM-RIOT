const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, settings, putSetting, DB_PATH, DATA_DIR } = require('./db');
const cal = require('./calendar');
const { computePayslip, structureAt } = require('./payroll');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { if (!req.body) req.body = {}; next(); });
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const SESSION_DAYS = 7;
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const verifyPassword = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
};
const tempPassword = () => crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '9a';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };
const wrap = (fn) => (req, res, next) => { try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { next(e); } };
const str = (v, max = 500) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const reqDate = (v, name) => { if (!cal.isDate(v)) bad(`${name} must be a valid date`); return v; };
const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function startSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, Date.now() + SESSION_DAYS * 86400000);
  const secure = req.secure || process.env.COOKIE_SECURE === '1';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

// CSRF protection: state-changing calls must come from our own JS (custom header + same-site cookie).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'hrms') return res.status(403).json({ error: 'Bad request origin' });
  next();
});

// Attach the logged-in user, if any.
app.use('/api', (req, res, next) => {
  const sid = parseCookies(req).sid;
  if (sid) {
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(sid);
    if (row && row.expires_at > Date.now() && row.active) { req.user = row; req.sid = sid; }
  }
  next();
});
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please log in' }));
const admin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'HR access only' }));
const employee = (req, res, next) => (req.user?.employee_id ? next() : res.status(403).json({ error: 'No employee profile linked to this login' }));

// Simple login throttle: 10 failed attempts per IP per 15 minutes.
const fails = new Map();
function throttled(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 15 * 60000) { fails.delete(ip); return false; }
  return f.count >= 10;
}
function recordFail(ip) { const f = fails.get(ip) || { count: 0, since: Date.now() }; f.count++; fails.set(ip, f); }

// ---------- auth ----------
app.get('/api/setup-status', wrap(() => ({ needsSetup: db.prepare('SELECT COUNT(*) c FROM users').get().c === 0, company: settings().company_name })));

app.post('/api/setup', wrap((req, res) => {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) bad('Setup already done');
  const { company, name, email, password } = req.body;
  if (!str(name) || !str(email) || !password || password.length < 8) bad('Name, email and a password of at least 8 characters are required');
  if (str(company)) putSetting.run('company_name', str(company, 120));
  const info = db.prepare('INSERT INTO users(email,name,password_hash,role) VALUES (?,?,?,?)').run(email.trim().toLowerCase(), str(name, 100), hashPassword(password), 'admin');
  startSession(res, req, info.lastInsertRowid);
  return { ok: true };
}));

app.post('/api/login', wrap((req, res) => {
  const ip = req.ip;
  if (throttled(ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const login = String(req.body.login || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(login);
  if (!user) {
    const emp = db.prepare('SELECT id FROM employees WHERE lower(emp_code) = ?').get(login);
    if (emp) user = db.prepare('SELECT * FROM users WHERE employee_id = ?').get(emp.id);
  }
  if (!user || !verifyPassword(password, user.password_hash)) { recordFail(ip); throw new HttpError(401, 'Wrong login or password'); }
  if (!user.active) throw new HttpError(403, 'This login has been disabled. Contact HR.');
  fails.delete(ip);
  startSession(res, req, user.id);
  return { ok: true };
}));

app.post('/api/logout', wrap((req, res) => {
  if (req.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
  return { ok: true };
}));

app.get('/api/me', auth, wrap((req) => {
  const u = req.user;
  const emp = u.employee_id ? db.prepare('SELECT id, emp_code, name, designation, department, status FROM employees WHERE id = ?').get(u.employee_id) : null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, must_change_pw: !!u.must_change_pw, employee: emp, company: settings().company_name };
}));

app.post('/api/change-password', auth, wrap((req) => {
  const { current, next } = req.body;
  if (!verifyPassword(String(current || ''), req.user.password_hash)) bad('Current password is wrong');
  if (!next || String(next).length < 8) bad('New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(hashPassword(String(next)), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sid);
  return { ok: true };
}));

// ---------- shared builders ----------
function getEmp(id) {
  const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
}
function leaveBalances(empId) {
  const types = db.prepare('SELECT * FROM leave_types WHERE active = 1 ORDER BY id').all();
  const sums = new Map(db.prepare('SELECT leave_type_id, SUM(days) bal FROM leave_ledger WHERE employee_id = ? GROUP BY leave_type_id').all(empId).map((r) => [r.leave_type_id, r.bal]));
  const pend = new Map(db.prepare(`SELECT leave_type_id, SUM(days) d FROM leave_requests WHERE employee_id = ? AND status = 'pending' GROUP BY leave_type_id`).all(empId).map((r) => [r.leave_type_id, r.d]));
  const used = new Map(db.prepare(`SELECT leave_type_id, SUM(days) d FROM leave_requests WHERE employee_id = ? AND status = 'approved' GROUP BY leave_type_id`).all(empId).map((r) => [r.leave_type_id, r.d]));
  return types.map((t) => ({ id: t.id, code: t.code, name: t.name, paid: !!t.paid, annual_quota: t.annual_quota, balance: sums.get(t.id) || 0, pending: pend.get(t.id) || 0, used: used.get(t.id) || 0 }));
}
function leaveLedger(empId) {
  const rows = db.prepare(`SELECT l.*, t.code, t.paid FROM leave_ledger l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.employee_id = ? ORDER BY l.txn_date, l.id`).all(empId);
  const run = {};
  return rows.map((r) => { run[r.code] = (run[r.code] || 0) + r.days; return { ...r, balance_after: run[r.code] }; });
}
function leaveRequests(empId) {
  return db.prepare(`SELECT lr.*, t.code, t.name type_name FROM leave_requests lr JOIN leave_types t ON t.id = lr.leave_type_id WHERE lr.employee_id = ? ORDER BY lr.created_at DESC`).all(empId);
}
function salaryLedger(empId, includeAll) {
  const slips = db.prepare(`SELECT id, month, gross, total_deductions, net_pay, status, paid_on, payment_ref, lop_days, paid_days FROM payslips WHERE employee_id = ? ORDER BY month DESC`).all(empId);
  const revisions = db.prepare('SELECT * FROM salary_revisions WHERE employee_id = ? ORDER BY effective_from DESC, id DESC').all(empId);
  const emp = getEmp(empId);
  const current = structureAt(emp, cal.today());
  const totals = slips.reduce((a, p) => { a.gross += p.gross; a.net += p.net_pay; if (p.status === 'paid') a.paid += p.net_pay; else a.unpaid += p.net_pay; return a; }, { gross: 0, net: 0, paid: 0, unpaid: 0 });
  return { current: { ...current, gross: current.basic + current.hra + current.special + current.other_allow }, revisions, payslips: slips, totals };
}
function pfLedger(empId) {
  const rows = db.prepare(`SELECT month, pf_wages, pf_employee, pf_employer_epf, pf_employer_eps FROM payslips WHERE employee_id = ? ORDER BY month`).all(empId);
  let cum = 0, cumEps = 0;
  const out = rows.map((r) => { cum += r.pf_employee + r.pf_employer_epf; cumEps += r.pf_employer_eps; return { ...r, total: r.pf_employee + r.pf_employer_epf + r.pf_employer_eps, cumulative_pf: cum, cumulative_eps: cumEps }; });
  return { rows: out.reverse(), totals: { employee: rows.reduce((a, r) => a + r.pf_employee, 0), employer_epf: rows.reduce((a, r) => a + r.pf_employer_epf, 0), eps: cumEps, pf_balance: cum } };
}
function noticeInfo(empId) {
  const emp = getEmp(empId);
  const resignation = db.prepare(`SELECT * FROM resignations WHERE employee_id = ? ORDER BY id DESC LIMIT 1`).get(empId) || null;
  const info = { notice_days: emp.notice_days, status: emp.status, relieving_date: emp.relieving_date, resignation };
  if (resignation && resignation.status === 'accepted') {
    const lwd = resignation.approved_last_day || resignation.notice_end;
    const t = cal.today();
    info.last_working_day = lwd;
    info.days_served = Math.max(0, Math.min(cal.daysBetween(resignation.submitted_on, t), cal.daysBetween(resignation.submitted_on, lwd)));
    info.days_remaining = Math.max(0, cal.daysBetween(t, lwd));
    info.shortfall_days = Math.max(0, cal.daysBetween(lwd, resignation.notice_end));
  }
  return info;
}
function payslipDetail(id) {
  const p = db.prepare('SELECT * FROM payslips WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'Payslip not found');
  const e = db.prepare('SELECT id, emp_code, name, designation, department, doj, pan, uan, esic_no, bank_name, bank_account, ifsc FROM employees WHERE id = ?').get(p.employee_id);
  const s = settings();
  return { ...p, employee: e, company: { name: s.company_name, address: s.company_address } };
}

// ================= EMPLOYEE (self-service) =================
// Every route below uses req.user.employee_id only — employees can never pass another employee's id.
const my = express.Router();
my.use(auth, employee);

my.get('/dashboard', wrap((req) => {
  const id = req.user.employee_id;
  const emp = getEmp(id);
  const s = settings();
  const month = cal.today().slice(0, 7);
  const ms = cal.monthStatus(emp, month, s);
  const todayRow = ms.days.find((d) => d.date === cal.today());
  return {
    profile: { emp_code: emp.emp_code, name: emp.name, designation: emp.designation, department: emp.department, doj: emp.doj, status: emp.status },
    today: todayRow, month_summary: ms.summary, balances: leaveBalances(id), notice: noticeInfo(id),
    pending: {
      leaves: db.prepare(`SELECT COUNT(*) c FROM leave_requests WHERE employee_id = ? AND status = 'pending'`).get(id).c,
      breaks: db.prepare(`SELECT COUNT(*) c FROM break_requests WHERE employee_id = ? AND status = 'pending'`).get(id).c,
    },
    last_payslip: db.prepare('SELECT id, month, net_pay, status FROM payslips WHERE employee_id = ? ORDER BY month DESC LIMIT 1').get(id) || null,
  };
}));
my.get('/profile', wrap((req) => {
  const e = getEmp(req.user.employee_id);
  delete e.tds_monthly;
  return e;
}));
my.get('/attendance', wrap((req) => {
  const month = cal.isMonth(req.query.month) ? req.query.month : cal.today().slice(0, 7);
  return { month, ...cal.monthStatus(getEmp(req.user.employee_id), month, settings()) };
}));
my.get('/leaves', wrap((req) => ({ balances: leaveBalances(req.user.employee_id), ledger: leaveLedger(req.user.employee_id), requests: leaveRequests(req.user.employee_id), types: db.prepare('SELECT id, code, name, paid FROM leave_types WHERE active = 1').all() })));
my.post('/leaves', wrap((req) => {
  const id = req.user.employee_id;
  const emp = getEmp(id);
  if (emp.status === 'relieved') bad('You are no longer an active employee');
  const from = reqDate(req.body.from_date, 'From date');
  const to = reqDate(req.body.to_date || from, 'To date');
  if (to < from) bad('To date is before from date');
  const half = req.body.half_day ? 1 : 0;
  if (half && from !== to) bad('Half day leave must be a single date');
  const type = db.prepare('SELECT * FROM leave_types WHERE id = ? AND active = 1').get(req.body.leave_type_id);
  if (!type) bad('Choose a leave type');
  const days = cal.countLeaveDays(from, to, half, settings());
  if (days <= 0) bad('Those dates are all holidays or weekly offs');
  const overlap = db.prepare(`SELECT COUNT(*) c FROM leave_requests WHERE employee_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ?`).get(id, to, from).c;
  if (overlap) bad('You already have a leave request covering some of these dates');
  if (type.paid) {
    const b = leaveBalances(id).find((x) => x.id === type.id);
    if (b.balance - b.pending < days) bad(`Not enough ${type.code} balance (available ${b.balance - b.pending}). Apply for LOP instead, or ask HR.`);
  }
  db.prepare('INSERT INTO leave_requests(employee_id,leave_type_id,from_date,to_date,half_day,days,reason) VALUES (?,?,?,?,?,?,?)').run(id, type.id, from, to, half, days, str(req.body.reason, 1000));
  return { ok: true, days };
}));
my.post('/leaves/:id/cancel', wrap((req) => {
  const r = db.prepare(`UPDATE leave_requests SET status = 'cancelled', decided_at = datetime('now') WHERE id = ? AND employee_id = ? AND status = 'pending'`).run(req.params.id, req.user.employee_id);
  if (!r.changes) bad('Only pending requests can be cancelled');
  return { ok: true };
}));
my.get('/breaks', wrap((req) => db.prepare('SELECT * FROM break_requests WHERE employee_id = ? ORDER BY date DESC, id DESC').all(req.user.employee_id)));
my.post('/breaks', wrap((req) => {
  const date = reqDate(req.body.date, 'Date');
  const { start_time, end_time } = req.body;
  if (!isTime(start_time) || !isTime(end_time)) bad('Enter start and end time');
  const minutes = cal.toMin(end_time) - cal.toMin(start_time);
  if (minutes <= 0) bad('End time must be after start time');
  if (!str(req.body.reason)) bad('Please give a reason');
  db.prepare('INSERT INTO break_requests(employee_id,date,start_time,end_time,minutes,reason) VALUES (?,?,?,?,?,?)').run(req.user.employee_id, date, start_time, end_time, minutes, str(req.body.reason, 1000));
  return { ok: true };
}));
my.post('/breaks/:id/cancel', wrap((req) => {
  const r = db.prepare(`UPDATE break_requests SET status = 'cancelled', decided_at = datetime('now') WHERE id = ? AND employee_id = ? AND status = 'pending'`).run(req.params.id, req.user.employee_id);
  if (!r.changes) bad('Only pending requests can be cancelled');
  return { ok: true };
}));
my.get('/salary', wrap((req) => salaryLedger(req.user.employee_id)));
my.get('/pf', wrap((req) => ({ uan: getEmp(req.user.employee_id).uan, ...pfLedger(req.user.employee_id) })));
my.get('/payslips/:id', wrap((req) => {
  const p = payslipDetail(req.params.id);
  if (p.employee_id !== req.user.employee_id) throw new HttpError(404, 'Payslip not found');
  return p;
}));
my.get('/resignation', wrap((req) => ({ ...noticeInfo(req.user.employee_id), history: db.prepare('SELECT * FROM resignations WHERE employee_id = ? ORDER BY id DESC').all(req.user.employee_id) })));
my.post('/resignation', wrap((req) => {
  const id = req.user.employee_id;
  const emp = getEmp(id);
  if (emp.status !== 'active') bad('You already have an accepted resignation or are relieved');
  if (db.prepare(`SELECT COUNT(*) c FROM resignations WHERE employee_id = ? AND status = 'pending'`).get(id).c) bad('You already have a pending resignation');
  if (!str(req.body.reason)) bad('Please give a reason');
  const t = cal.today();
  const reqLast = req.body.requested_last_day ? reqDate(req.body.requested_last_day, 'Requested last day') : null;
  if (reqLast && reqLast < t) bad('Requested last day cannot be in the past');
  db.prepare('INSERT INTO resignations(employee_id,submitted_on,reason,requested_last_day,notice_days,notice_end) VALUES (?,?,?,?,?,?)')
    .run(id, t, str(req.body.reason, 2000), reqLast, emp.notice_days, cal.addDays(t, emp.notice_days));
  return { ok: true };
}));
my.post('/resignation/withdraw', wrap((req) => {
  const r = db.prepare(`UPDATE resignations SET status = 'withdrawn', decided_at = datetime('now') WHERE employee_id = ? AND status = 'pending'`).run(req.user.employee_id);
  if (!r.changes) bad('No pending resignation to withdraw');
  return { ok: true };
}));
app.use('/api/my', my);

// ================= HR / ADMIN =================
const hr = express.Router();
hr.use(auth, admin);

hr.get('/dashboard', wrap(() => {
  const s = settings();
  const t = cal.today();
  const emps = db.prepare(`SELECT * FROM employees WHERE status != 'relieved' ORDER BY name`).all();
  const todayRows = emps.map((e) => {
    const d = cal.monthStatus(e, t.slice(0, 7), s).days.find((x) => x.date === t);
    return { id: e.id, emp_code: e.emp_code, name: e.name, department: e.department, ...d };
  });
  const count = (sql) => db.prepare(sql).get().c;
  return {
    date: t,
    headcount: emps.length,
    on_notice: emps.filter((e) => e.status === 'notice').length,
    present: todayRows.filter((r) => ['P', 'HD', 'MP', 'A'].includes(r.status) && r.first_in).length,
    on_leave: todayRows.filter((r) => r.status === 'L').length,
    pending_leaves: count(`SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'`),
    pending_breaks: count(`SELECT COUNT(*) c FROM break_requests WHERE status = 'pending'`),
    pending_resignations: count(`SELECT COUNT(*) c FROM resignations WHERE status = 'pending'`),
    last_import: db.prepare(`SELECT MAX(date) d FROM attendance WHERE source = 'biometric'`).get().d,
    today: todayRows,
  };
}));

// --- employees ---
const EMP_FIELDS = ['emp_code', 'name', 'email', 'phone', 'designation', 'department', 'doj', 'dob', 'gender', 'address', 'pan', 'uan', 'esic_no', 'bank_name', 'bank_account', 'ifsc', 'notice_days', 'pf_enabled', 'esi_enabled', 'pt_enabled', 'tds_monthly'];
function cleanEmp(b) {
  const o = {};
  for (const f of EMP_FIELDS) {
    if (!(f in b)) continue;
    if (['notice_days', 'tds_monthly'].includes(f)) o[f] = num(b[f]);
    else if (['pf_enabled', 'esi_enabled', 'pt_enabled'].includes(f)) o[f] = b[f] ? 1 : 0;
    else if (['doj', 'dob'].includes(f)) o[f] = b[f] ? reqDate(b[f], f.toUpperCase()) : null;
    else o[f] = str(b[f], 300);
  }
  return o;
}
hr.get('/employees', wrap(() => db.prepare(`SELECT e.id, e.emp_code, e.name, e.email, e.phone, e.designation, e.department, e.doj, e.status, e.basic+e.hra+e.special+e.other_allow gross, u.active login_active FROM employees e LEFT JOIN users u ON u.employee_id = e.id ORDER BY e.status = 'relieved', e.name`).all()));
hr.post('/employees', wrap((req) => {
  const b = cleanEmp(req.body);
  if (!b.emp_code || !b.name) bad('Employee code and name are required');
  if (!b.email) bad('Email is required (used for login)');
  const email = b.email.toLowerCase();
  if (db.prepare('SELECT 1 FROM employees WHERE lower(emp_code) = lower(?)').get(b.emp_code)) bad('That employee code already exists');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) bad('That email already has a login');
  if (b.notice_days === undefined) b.notice_days = Number(settings().default_notice_days);
  const sal = { basic: num(req.body.basic), hra: num(req.body.hra), special: num(req.body.special), other_allow: num(req.body.other_allow) };
  const pw = tempPassword();
  const tx = db.transaction(() => {
    const cols = [...Object.keys(b), ...Object.keys(sal)];
    const info = db.prepare(`INSERT INTO employees(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => (c in b ? b[c] : sal[c])));
    const id = info.lastInsertRowid;
    db.prepare('INSERT INTO salary_revisions(employee_id,effective_from,basic,hra,special,other_allow,note) VALUES (?,?,?,?,?,?,?)').run(id, b.doj || cal.today(), sal.basic, sal.hra, sal.special, sal.other_allow, 'Joining salary');
    db.prepare('INSERT INTO users(email,name,password_hash,role,employee_id,must_change_pw) VALUES (?,?,?,?,?,1)').run(email, b.name, hashPassword(pw), 'employee', id);
    // Credit this year's leave, prorated from joining month.
    creditAnnual(id, new Date().getFullYear());
    return id;
  });
  const id = tx();
  return { ok: true, id, login: email, temp_password: pw };
}));
hr.get('/employees/:id', wrap((req) => {
  const id = Number(req.params.id);
  const e = getEmp(id);
  const u = db.prepare('SELECT email, active, must_change_pw FROM users WHERE employee_id = ?').get(id);
  return {
    profile: e, login: u, balances: leaveBalances(id), leave_ledger: leaveLedger(id), leave_requests: leaveRequests(id),
    breaks: db.prepare('SELECT * FROM break_requests WHERE employee_id = ? ORDER BY date DESC').all(id),
    salary: salaryLedger(id), pf: pfLedger(id), notice: noticeInfo(id),
    resignations: db.prepare('SELECT * FROM resignations WHERE employee_id = ? ORDER BY id DESC').all(id),
  };
}));
hr.put('/employees/:id', wrap((req) => {
  const id = Number(req.params.id);
  const e = getEmp(id);
  const b = cleanEmp(req.body);
  if ('emp_code' in b && !b.emp_code) bad('Employee code is required');
  if ('name' in b && !b.name) bad('Name is required');
  if (b.emp_code && db.prepare('SELECT 1 FROM employees WHERE lower(emp_code) = lower(?) AND id != ?').get(b.emp_code, id)) bad('That employee code already exists');
  const tx = db.transaction(() => {
    if (Object.keys(b).length) db.prepare(`UPDATE employees SET ${Object.keys(b).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(b), id);
    if (b.email && b.email.toLowerCase() !== (db.prepare('SELECT email FROM users WHERE employee_id = ?').get(id) || {}).email) {
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND employee_id != ?').get(b.email.toLowerCase(), id)) bad('That email already has a login');
      db.prepare('UPDATE users SET email = ? WHERE employee_id = ?').run(b.email.toLowerCase(), id);
    }
    if (b.name) db.prepare('UPDATE users SET name = ? WHERE employee_id = ?').run(b.name, id);
  });
  tx();
  return { ok: true, id: e.id };
}));
hr.post('/employees/:id/salary', wrap((req) => {
  const id = Number(req.params.id); getEmp(id);
  const eff = reqDate(req.body.effective_from, 'Effective date');
  const s = { basic: num(req.body.basic), hra: num(req.body.hra), special: num(req.body.special), other_allow: num(req.body.other_allow) };
  if (s.basic <= 0) bad('Basic must be more than 0');
  db.transaction(() => {
    db.prepare('INSERT INTO salary_revisions(employee_id,effective_from,basic,hra,special,other_allow,note) VALUES (?,?,?,?,?,?,?)').run(id, eff, s.basic, s.hra, s.special, s.other_allow, str(req.body.note, 300));
    const cur = structureAt(getEmp(id), cal.today());
    db.prepare('UPDATE employees SET basic = ?, hra = ?, special = ?, other_allow = ? WHERE id = ?').run(cur.basic, cur.hra, cur.special, cur.other_allow, id);
  })();
  return { ok: true };
}));
hr.post('/employees/:id/reset-password', wrap((req) => {
  const id = Number(req.params.id); getEmp(id);
  const pw = tempPassword();
  const u = db.prepare('SELECT id, email FROM users WHERE employee_id = ?').get(id);
  if (!u) bad('No login for this employee');
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(hashPassword(pw), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  return { ok: true, login: u.email, temp_password: pw };
}));
hr.post('/employees/:id/login-active', wrap((req) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE users SET active = ? WHERE employee_id = ?').run(req.body.active ? 1 : 0, id);
  if (!req.body.active) db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id = ?)').run(id);
  return { ok: true };
}));
hr.post('/employees/:id/relieve', wrap((req) => {
  const id = Number(req.params.id); getEmp(id);
  const d = reqDate(req.body.relieving_date, 'Relieving date');
  db.prepare(`UPDATE employees SET status = 'relieved', relieving_date = ? WHERE id = ?`).run(d, id);
  return { ok: true };
}));
hr.post('/employees/:id/reactivate', wrap((req) => {
  db.prepare(`UPDATE employees SET status = 'active', relieving_date = NULL WHERE id = ?`).run(Number(req.params.id));
  return { ok: true };
}));

// --- attendance ---
hr.get('/attendance/day', wrap((req) => {
  const date = cal.isDate(req.query.date) ? req.query.date : cal.today();
  const s = settings();
  const emps = db.prepare(`SELECT * FROM employees WHERE NOT (status = 'relieved' AND relieving_date < ?) ORDER BY name`).all(date);
  return { date, rows: emps.map((e) => ({ id: e.id, emp_code: e.emp_code, name: e.name, department: e.department, ...cal.monthStatus(e, date.slice(0, 7), s).days.find((x) => x.date === date) })) };
}));
hr.get('/attendance/month', wrap((req) => {
  const month = cal.isMonth(req.query.month) ? req.query.month : cal.today().slice(0, 7);
  const s = settings();
  const [start] = cal.monthRange(month);
  const emps = db.prepare(`SELECT * FROM employees WHERE NOT (status = 'relieved' AND relieving_date < ?) ORDER BY name`).all(start);
  return { month, rows: emps.map((e) => { const ms = cal.monthStatus(e, month, s); return { id: e.id, emp_code: e.emp_code, name: e.name, days: ms.days.map((d) => ({ date: d.date, status: d.status, late: d.late, first_in: d.first_in, last_out: d.last_out })), summary: ms.summary }; }) };
}));
hr.get('/attendance/employee/:id', wrap((req) => {
  const month = cal.isMonth(req.query.month) ? req.query.month : cal.today().slice(0, 7);
  return { month, ...cal.monthStatus(getEmp(Number(req.params.id)), month, settings()) };
}));
// Import biometric punches. Body: { punches: [{ code, date: 'YYYY-MM-DD', time: 'HH:MM' }], replace: bool }
hr.post('/attendance/import', wrap((req) => {
  const punches = Array.isArray(req.body.punches) ? req.body.punches : bad('No punches to import');
  if (punches.length > 200000) bad('File too large; split it by month');
  const codeMap = new Map(db.prepare('SELECT id, lower(emp_code) code FROM employees').all().map((r) => [r.code, r.id]));
  const groups = new Map();
  const unknown = new Set();
  let skipped = 0;
  for (const p of punches) {
    const code = String(p.code || '').trim().toLowerCase();
    if (!cal.isDate(p.date) || !isTime(p.time)) { skipped++; continue; }
    const empId = codeMap.get(code) ?? codeMap.get(code.replace(/^0+/, ''));
    if (!empId) { unknown.add(p.code); continue; }
    const key = `${empId}|${p.date}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(p.time);
  }
  const get = db.prepare('SELECT punches FROM attendance WHERE employee_id = ? AND date = ?');
  const up = db.prepare(`INSERT INTO attendance(employee_id,date,first_in,last_out,punches,source) VALUES (?,?,?,?,?,'biometric')
    ON CONFLICT(employee_id,date) DO UPDATE SET first_in=excluded.first_in, last_out=excluded.last_out, punches=excluded.punches, source='biometric'`);
  let days = 0;
  db.transaction(() => {
    for (const [key, set] of groups) {
      const [empId, date] = key.split('|');
      const existing = req.body.replace ? [] : JSON.parse(get.get(empId, date)?.punches || '[]');
      const all = [...new Set([...existing, ...set])].sort();
      up.run(empId, date, all[0], all.length > 1 ? all[all.length - 1] : null, JSON.stringify(all));
      days++;
    }
  })();
  return { ok: true, days_updated: days, unknown_codes: [...unknown].slice(0, 50), unknown_count: unknown.size, skipped_rows: skipped };
}));
hr.put('/attendance', wrap((req) => {
  const empId = Number(req.body.employee_id); getEmp(empId);
  const date = reqDate(req.body.date, 'Date');
  const fi = req.body.first_in || null, lo = req.body.last_out || null;
  if ((fi && !isTime(fi)) || (lo && !isTime(lo))) bad('Times must be HH:MM');
  if (!fi && !lo) { db.prepare('DELETE FROM attendance WHERE employee_id = ? AND date = ?').run(empId, date); return { ok: true }; }
  if (fi && lo && lo <= fi) bad('Out time must be after in time');
  const punches = [fi, lo].filter(Boolean);
  db.prepare(`INSERT INTO attendance(employee_id,date,first_in,last_out,punches,source,note) VALUES (?,?,?,?,?,'manual',?)
    ON CONFLICT(employee_id,date) DO UPDATE SET first_in=excluded.first_in, last_out=excluded.last_out, punches=excluded.punches, source='manual', note=excluded.note`)
    .run(empId, date, fi || lo, fi && lo ? lo : null, JSON.stringify(punches), str(req.body.note, 300) || 'Corrected by HR');
  return { ok: true };
}));

// --- leaves ---
hr.get('/leaves', wrap((req) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  return db.prepare(`SELECT lr.*, t.code, e.name emp_name, e.emp_code FROM leave_requests lr JOIN leave_types t ON t.id = lr.leave_type_id JOIN employees e ON e.id = lr.employee_id
    ${status ? 'WHERE lr.status = ?' : ''} ORDER BY lr.status = 'pending' DESC, lr.from_date DESC LIMIT 500`).all(...(status ? [status] : []));
}));
hr.post('/leaves/:id/decide', wrap((req) => {
  const lr = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!lr) throw new HttpError(404, 'Request not found');
  const action = req.body.action;
  const note = str(req.body.note, 500);
  db.transaction(() => {
    if (action === 'approve' || action === 'reject') {
      if (lr.status !== 'pending') bad('This request was already decided');
      db.prepare(`UPDATE leave_requests SET status = ?, hr_note = ?, decided_at = datetime('now') WHERE id = ?`).run(action === 'approve' ? 'approved' : 'rejected', note, lr.id);
      if (action === 'approve') {
        db.prepare(`INSERT INTO leave_ledger(employee_id,leave_type_id,txn_date,kind,days,request_id,note) VALUES (?,?,?,?,?,?,?)`)
          .run(lr.employee_id, lr.leave_type_id, lr.from_date, 'debit', -lr.days, lr.id, `Leave ${lr.from_date}${lr.to_date !== lr.from_date ? ' to ' + lr.to_date : ''}${lr.half_day ? ' (half day)' : ''}`);
      }
    } else if (action === 'revoke') {
      if (lr.status !== 'approved') bad('Only approved leave can be revoked');
      db.prepare(`UPDATE leave_requests SET status = 'cancelled', hr_note = ?, decided_at = datetime('now') WHERE id = ?`).run(note || 'Revoked by HR', lr.id);
      db.prepare(`INSERT INTO leave_ledger(employee_id,leave_type_id,txn_date,kind,days,request_id,note) VALUES (?,?,?,?,?,?,?)`)
        .run(lr.employee_id, lr.leave_type_id, cal.today(), 'reversal', lr.days, lr.id, `Reversal of leave ${lr.from_date}`);
    } else bad('Unknown action');
  })();
  return { ok: true };
}));
function creditAnnual(empId, year) {
  const emp = getEmp(empId);
  const types = db.prepare('SELECT * FROM leave_types WHERE active = 1 AND annual_quota > 0').all();
  let n = 0;
  for (const t of types) {
    const key = `annual-${year}`;
    if (db.prepare('SELECT 1 FROM leave_ledger WHERE employee_id = ? AND leave_type_id = ? AND ref_key = ?').get(empId, t.id, key)) continue;
    let days = t.annual_quota;
    if (emp.doj && emp.doj.startsWith(String(year))) {
      const monthsLeft = 12 - Number(emp.doj.slice(5, 7)) + 1;
      days = Math.round((t.annual_quota * monthsLeft / 12) * 2) / 2;
    } else if (emp.doj && emp.doj > `${year}-12-31`) continue;
    if (days <= 0) continue;
    db.prepare(`INSERT INTO leave_ledger(employee_id,leave_type_id,txn_date,kind,days,ref_key,note) VALUES (?,?,?,?,?,?,?)`)
      .run(empId, t.id, emp.doj && emp.doj > `${year}-01-01` ? emp.doj : `${year}-01-01`, 'credit', days, key, `Annual ${t.code} quota ${year}`);
    n++;
  }
  return n;
}
hr.post('/leaves/allocate', wrap((req) => {
  const year = Number(req.body.year) || new Date().getFullYear();
  const emps = db.prepare(`SELECT id FROM employees WHERE status != 'relieved'`).all();
  let n = 0;
  db.transaction(() => { for (const e of emps) n += creditAnnual(e.id, year); })();
  return { ok: true, credits: n };
}));
hr.post('/leaves/adjust', wrap((req) => {
  const empId = Number(req.body.employee_id); getEmp(empId);
  const t = db.prepare('SELECT id FROM leave_types WHERE id = ?').get(req.body.leave_type_id);
  if (!t) bad('Choose a leave type');
  const days = num(req.body.days);
  if (!days) bad('Days cannot be 0');
  if (!str(req.body.note)) bad('Add a note explaining the adjustment');
  db.prepare(`INSERT INTO leave_ledger(employee_id,leave_type_id,txn_date,kind,days,note) VALUES (?,?,?,?,?,?)`).run(empId, t.id, cal.today(), days > 0 ? 'credit' : 'adjustment', days, str(req.body.note, 300));
  return { ok: true };
}));

// --- breaks ---
hr.get('/breaks', wrap((req) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  return db.prepare(`SELECT b.*, e.name emp_name, e.emp_code FROM break_requests b JOIN employees e ON e.id = b.employee_id ${status ? 'WHERE b.status = ?' : ''} ORDER BY b.status = 'pending' DESC, b.date DESC LIMIT 500`).all(...(status ? [status] : []));
}));
hr.post('/breaks/:id/decide', wrap((req) => {
  const st = req.body.action === 'approve' ? 'approved' : req.body.action === 'reject' ? 'rejected' : bad('Unknown action');
  const r = db.prepare(`UPDATE break_requests SET status = ?, hr_note = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(st, str(req.body.note, 500), req.params.id);
  if (!r.changes) bad('This request was already decided');
  return { ok: true };
}));

// --- resignations ---
hr.get('/resignations', wrap(() => db.prepare(`SELECT r.*, e.name emp_name, e.emp_code, e.status emp_status FROM resignations r JOIN employees e ON e.id = r.employee_id ORDER BY r.status = 'pending' DESC, r.id DESC`).all()));
hr.post('/resignations/:id/decide', wrap((req) => {
  const r = db.prepare('SELECT * FROM resignations WHERE id = ?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Not found');
  if (r.status !== 'pending') bad('Already decided');
  const note = str(req.body.note, 500);
  if (req.body.action === 'accept') {
    const lwd = req.body.approved_last_day ? reqDate(req.body.approved_last_day, 'Last working day') : r.notice_end;
    if (lwd < r.submitted_on) bad('Last working day cannot be before the resignation date');
    db.transaction(() => {
      db.prepare(`UPDATE resignations SET status = 'accepted', approved_last_day = ?, hr_note = ?, decided_at = datetime('now') WHERE id = ?`).run(lwd, note, r.id);
      db.prepare(`UPDATE employees SET status = 'notice', relieving_date = ? WHERE id = ?`).run(lwd, r.employee_id);
    })();
  } else if (req.body.action === 'reject') {
    db.prepare(`UPDATE resignations SET status = 'rejected', hr_note = ?, decided_at = datetime('now') WHERE id = ?`).run(note, r.id);
  } else bad('Unknown action');
  return { ok: true };
}));

// --- payroll ---
hr.get('/payroll', wrap((req) => {
  const month = cal.isMonth(req.query.month) ? req.query.month : bad('Choose a month');
  const s = settings();
  const [start, end] = cal.monthRange(month);
  const emps = db.prepare(`SELECT * FROM employees WHERE (doj IS NULL OR doj <= ?) AND (relieving_date IS NULL OR relieving_date >= ?) ORDER BY name`).all(end, start);
  const existing = new Map(db.prepare('SELECT * FROM payslips WHERE month = ?').all(month).map((p) => [p.employee_id, p]));
  return {
    month,
    rows: emps.map((e) => ({ employee: { id: e.id, emp_code: e.emp_code, name: e.name }, payslip: existing.get(e.id) || null, preview: existing.has(e.id) ? null : computePayslip(e, month, s) })),
  };
}));
hr.post('/payroll/preview', wrap((req) => {
  const month = cal.isMonth(req.body.month) ? req.body.month : bad('Choose a month');
  const e = getEmp(Number(req.body.employee_id));
  return computePayslip(e, month, settings(), req.body);
}));
hr.post('/payroll/generate', wrap((req) => {
  const month = cal.isMonth(req.body.month) ? req.body.month : bad('Choose a month');
  const items = Array.isArray(req.body.items) ? req.body.items : bad('Nothing to generate');
  const s = settings();
  const cols = ['employee_id', 'month', 'days_in_month', 'paid_days', 'lop_days', 'basic', 'hra', 'special', 'other_allow', 'other_earnings', 'gross', 'pf_wages', 'pf_employee', 'pf_employer_epf', 'pf_employer_eps', 'esi_employee', 'esi_employer', 'pt', 'tds', 'other_deductions', 'total_deductions', 'net_pay', 'remarks'];
  const ins = db.prepare(`INSERT INTO payslips(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  let n = 0;
  db.transaction(() => {
    for (const it of items) {
      const e = getEmp(Number(it.employee_id));
      const old = db.prepare('SELECT * FROM payslips WHERE employee_id = ? AND month = ?').get(e.id, month);
      if (old) { if (old.status === 'paid') continue; db.prepare('DELETE FROM payslips WHERE id = ?').run(old.id); }
      const p = computePayslip(e, month, s, { lop_days: it.lop_days === '' || it.lop_days === undefined ? undefined : num(it.lop_days), other_earnings: it.other_earnings, other_deductions: it.other_deductions, tds: it.tds === '' || it.tds === undefined ? undefined : num(it.tds) });
      p.remarks = str(it.remarks, 300);
      ins.run(...cols.map((c) => p[c] ?? null));
      n++;
    }
  })();
  return { ok: true, generated: n };
}));
hr.post('/payroll/mark-paid', wrap((req) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : bad('Choose payslips');
  const d = reqDate(req.body.paid_on, 'Paid date');
  const st = db.prepare(`UPDATE payslips SET status = 'paid', paid_on = ?, payment_ref = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id) => st.run(d, str(req.body.payment_ref, 100), id)))();
  return { ok: true };
}));
hr.delete('/payslips/:id', wrap((req) => {
  const r = db.prepare(`DELETE FROM payslips WHERE id = ? AND status != 'paid'`).run(req.params.id);
  if (!r.changes) bad('Paid payslips cannot be deleted');
  return { ok: true };
}));
hr.get('/payslips/:id', wrap((req) => payslipDetail(req.params.id)));

// --- settings, holidays, leave types ---
hr.get('/settings', wrap(() => ({ settings: settings(), holidays: db.prepare('SELECT * FROM holidays ORDER BY date').all(), leave_types: db.prepare('SELECT * FROM leave_types ORDER BY id').all() })));
hr.put('/settings', wrap((req) => {
  const cur = settings();
  for (const [k, v] of Object.entries(req.body || {})) if (k in cur) putSetting.run(k, String(v ?? '').slice(0, 500));
  return { ok: true };
}));
hr.post('/holidays', wrap((req) => {
  const d = reqDate(req.body.date, 'Date');
  if (!str(req.body.name)) bad('Holiday name is required');
  db.prepare('INSERT INTO holidays(date,name) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET name = excluded.name').run(d, str(req.body.name, 100));
  return { ok: true };
}));
hr.delete('/holidays/:id', wrap((req) => { db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id); return { ok: true }; }));
hr.post('/leave-types', wrap((req) => {
  const code = str(req.body.code, 10), name = str(req.body.name, 60);
  if (!code || !name) bad('Code and name are required');
  if (req.body.id) db.prepare('UPDATE leave_types SET code = ?, name = ?, annual_quota = ?, paid = ?, active = ? WHERE id = ?').run(code.toUpperCase(), name, num(req.body.annual_quota), req.body.paid ? 1 : 0, req.body.active === false ? 0 : 1, req.body.id);
  else db.prepare('INSERT INTO leave_types(code,name,annual_quota,paid) VALUES (?,?,?,?)').run(code.toUpperCase(), name, num(req.body.annual_quota), req.body.paid ? 1 : 0);
  return { ok: true };
}));
hr.get('/admins', wrap(() => db.prepare(`SELECT id, name, email, active FROM users WHERE role = 'admin'`).all()));
hr.post('/admins', wrap((req) => {
  const email = str(req.body.email, 200)?.toLowerCase();
  if (!email || !str(req.body.name)) bad('Name and email are required');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) bad('That email already has a login');
  const pw = tempPassword();
  db.prepare('INSERT INTO users(email,name,password_hash,role,must_change_pw) VALUES (?,?,?,?,1)').run(email, str(req.body.name, 100), hashPassword(pw), 'admin');
  return { ok: true, login: email, temp_password: pw };
}));
hr.get('/backup', async (req, res, next) => {
  try {
    const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
    await db.backup(file);
    res.download(file, `hrms-backup-${cal.today()}.db`, () => require('fs').unlink(file, () => {}));
  } catch (e) { next(e); }
});
app.use('/api/admin', hr);

// ---------- errors & SPA ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Something went wrong. Please try again.' });
});
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Clean expired sessions hourly.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`HRMS running on http://localhost:${PORT}  (database: ${DB_PATH})`));
module.exports = app;
