// Database setup (SQLite). The file lives in DATA_DIR (default ./data).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'hrms.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  designation TEXT,
  department TEXT,
  doj TEXT,                 -- date of joining YYYY-MM-DD
  dob TEXT,
  gender TEXT,
  address TEXT,
  pan TEXT,
  uan TEXT,
  esic_no TEXT,
  bank_name TEXT,
  bank_account TEXT,
  ifsc TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | notice | relieved
  relieving_date TEXT,
  notice_days INTEGER NOT NULL DEFAULT 30,
  basic REAL NOT NULL DEFAULT 0,
  hra REAL NOT NULL DEFAULT 0,
  special REAL NOT NULL DEFAULT 0,
  other_allow REAL NOT NULL DEFAULT 0,
  pf_enabled INTEGER NOT NULL DEFAULT 1,
  esi_enabled INTEGER NOT NULL DEFAULT 0,
  pt_enabled INTEGER NOT NULL DEFAULT 1,
  tds_monthly REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','employee')),
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  basic REAL NOT NULL, hra REAL NOT NULL, special REAL NOT NULL, other_allow REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  annual_quota REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  half_day INTEGER NOT NULL DEFAULT 0,
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  hr_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  txn_date TEXT NOT NULL,
  kind TEXT NOT NULL,       -- credit | debit | reversal | adjustment
  days REAL NOT NULL,       -- + adds to balance, - takes from it
  request_id INTEGER,
  ref_key TEXT,             -- e.g. annual-2026 to avoid double credit
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  first_in TEXT,
  last_out TEXT,
  punches TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'biometric',  -- biometric | manual
  note TEXT,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS break_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  hr_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resignations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  submitted_on TEXT NOT NULL,
  reason TEXT,
  requested_last_day TEXT,
  notice_days INTEGER NOT NULL,
  notice_end TEXT NOT NULL,          -- submitted_on + notice_days
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | withdrawn
  approved_last_day TEXT,
  hr_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,              -- YYYY-MM
  days_in_month INTEGER NOT NULL,
  paid_days REAL NOT NULL,
  lop_days REAL NOT NULL,
  basic REAL NOT NULL, hra REAL NOT NULL, special REAL NOT NULL, other_allow REAL NOT NULL,
  other_earnings REAL NOT NULL DEFAULT 0,
  gross REAL NOT NULL,
  pf_wages REAL NOT NULL DEFAULT 0,
  pf_employee REAL NOT NULL DEFAULT 0,
  pf_employer_epf REAL NOT NULL DEFAULT 0,
  pf_employer_eps REAL NOT NULL DEFAULT 0,
  esi_employee REAL NOT NULL DEFAULT 0,
  esi_employer REAL NOT NULL DEFAULT 0,
  pt REAL NOT NULL DEFAULT 0,
  tds REAL NOT NULL DEFAULT 0,
  other_deductions REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL,
  net_pay REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'finalized', -- finalized | paid
  paid_on TEXT,
  payment_ref TEXT,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, month)
);

CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_ledger_emp ON leave_ledger(employee_id);

CREATE TABLE IF NOT EXISTS otp_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,                 -- scrypt hash of the 6-digit OTP
  expires_at INTEGER NOT NULL,            -- Unix ms timestamp (5 mins)
  resend_available_at INTEGER NOT NULL DEFAULT 0, -- Unix ms timestamp (60s cooldown)
  verified INTEGER NOT NULL DEFAULT 0,    -- 1 when OTP is verified
  reset_token TEXT,                       -- token for password reset step
  reset_token_expires_at INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,        -- single use flag
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_tokens(email);
`);

// Migration to ensure otp_tokens columns exist on existing databases
try {
  const existingCols = db.prepare("PRAGMA table_info(otp_tokens)").all().map((c) => c.name);
  if (!existingCols.includes('resend_available_at')) db.exec("ALTER TABLE otp_tokens ADD COLUMN resend_available_at INTEGER NOT NULL DEFAULT 0");
  if (!existingCols.includes('verified')) db.exec("ALTER TABLE otp_tokens ADD COLUMN verified INTEGER NOT NULL DEFAULT 0");
  if (!existingCols.includes('reset_token')) db.exec("ALTER TABLE otp_tokens ADD COLUMN reset_token TEXT");
  if (!existingCols.includes('reset_token_expires_at')) db.exec("ALTER TABLE otp_tokens ADD COLUMN reset_token_expires_at INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS idx_otp_reset ON otp_tokens(reset_token)");
} catch (_) {}

// Fix typo in admin email (viond.riot@gmail.com -> vinodsingh.riot@gmail.com)
try {
  db.prepare("UPDATE users SET email = 'vinodsingh.riot@gmail.com' WHERE lower(email) = 'viond.riot@gmail.com'").run();
} catch (_) {}

const DEFAULT_SETTINGS = {
  company_name: 'My Company',
  company_address: '',
  weekly_off: '0',              // 0=Sun ... 6=Sat, comma separated
  off_saturdays: '',            // nth Saturdays off e.g. "2,4" (only used if 6 not in weekly_off)
  shift_start: '09:30',
  grace_minutes: '15',
  full_day_hours: '8',
  half_day_hours: '4',
  default_notice_days: '30',
  pf_ceiling: '25000',          // EPF/EPS wage ceiling (raised from 15,000 effective 17 Sep 2026)
  pf_restrict_to_ceiling: '1',  // 1 = contribute on min(wages, ceiling)
  pf_rate_employee: '12',
  pf_rate_employer: '12',
  eps_rate: '8.33',
  pf_apply_50pct_rule: '1',     // Labour codes: PF wages >= 50% of gross
  esi_ceiling: '21000',
  esi_rate_employee: '0.75',
  esi_rate_employer: '3.25',
  pt_slabs: '15000:0,20000:150,*:200', // Telangana
};

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const putSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!getSetting.get(k)) putSetting.run(k, v);
}

if (db.prepare('SELECT COUNT(*) c FROM leave_types').get().c === 0) {
  const ins = db.prepare('INSERT INTO leave_types(code,name,annual_quota,paid) VALUES (?,?,?,?)');
  ins.run('CL', 'Casual Leave', 12, 1);  // 1 per month
  ins.run('SL', 'Sick Leave', 12, 1);    // 1 per month
  ins.run('LOP', 'Loss of Pay', 0, 0);
} else {
  // Migration: update SL quota to 12/year (1/month) and deactivate EL
  db.prepare("UPDATE leave_types SET annual_quota = 12 WHERE code = 'SL'").run();
  db.prepare("UPDATE leave_types SET active = 0 WHERE code = 'EL'").run();
}

function settings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

module.exports = { db, settings, putSetting, DB_PATH, DATA_DIR };
