// Date helpers, working-day rules and daily attendance status.
const { db } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseYmd(s));
const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthDays = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthRange = (month) => [`${month}-01`, `${month}-${pad(monthDays(month))}`];
const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function holidaySet() {
  return new Set(db.prepare('SELECT date FROM holidays').all().map((r) => r.date));
}

function isWeeklyOff(dateStr, s) {
  const d = parseYmd(dateStr);
  const dow = d.getDay();
  const offs = (s.weekly_off || '').split(',').filter(Boolean).map(Number);
  if (offs.includes(dow)) return true;
  if (dow === 6 && s.off_saturdays) {
    const nth = Math.ceil(d.getDate() / 7);
    return s.off_saturdays.split(',').map(Number).includes(nth);
  }
  return false;
}

// Number of leave days in a range (weekly offs and holidays don't count).
function countLeaveDays(from, to, halfDay, s) {
  if (halfDay) return 0.5;
  const hol = holidaySet();
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWeeklyOff(d, s) && !hol.has(d)) n++;
  }
  return n;
}

// Build the day-by-day attendance picture for one employee and month.
function monthStatus(emp, month, s) {
  const [start, end] = monthRange(month);
  const hol = new Map(db.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?').all(start, end).map((r) => [r.date, r.name]));
  const att = new Map(db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?').all(emp.id, start, end).map((r) => [r.date, r]));
  const leaves = db.prepare(`SELECT lr.*, lt.code, lt.paid FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id = ? AND lr.status = 'approved' AND lr.to_date >= ? AND lr.from_date <= ?`).all(emp.id, start, end);
  const breaks = db.prepare(`SELECT * FROM break_requests WHERE employee_id = ? AND status = 'approved' AND date BETWEEN ? AND ?`).all(emp.id, start, end);
  const t = today();
  const full = Number(s.full_day_hours) * 60, half = Number(s.half_day_hours) * 60;
  const lateAfter = toMin(s.shift_start) + Number(s.grace_minutes || 0);

  const days = [];
  const sum = { present: 0, absent: 0, half_day: 0, leave: 0, unpaid_leave: 0, holiday: 0, weekly_off: 0, late: 0, missing_punch: 0, lop: 0 };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const a = att.get(d);
    const day = { date: d, first_in: a?.first_in || null, last_out: a?.last_out || null, punches: a ? JSON.parse(a.punches) : [], source: a?.source, note: a?.note, minutes: null, status: '', label: '', late: false, lop: 0 };
    if (a?.first_in && a?.last_out && a.last_out !== a.first_in) day.minutes = toMin(a.last_out) - toMin(a.first_in);
    day.breaks = breaks.filter((b) => b.date === d).map((b) => ({ start: b.start_time, end: b.end_time, reason: b.reason }));
    const lv = leaves.find((l) => l.from_date <= d && l.to_date >= d);

    if ((emp.doj && d < emp.doj) || (emp.relieving_date && d > emp.relieving_date)) {
      day.status = 'NA'; day.label = 'Not employed';
    } else if (hol.has(d)) {
      day.status = 'H'; day.label = hol.get(d); sum.holiday++;
    } else if (isWeeklyOff(d, s)) {
      day.status = 'WO'; day.label = 'Weekly off'; sum.weekly_off++;
    } else if (lv && !lv.half_day) {
      day.status = 'L'; day.label = lv.code; sum.leave++;
      if (!lv.paid) { day.lop = 1; sum.unpaid_leave++; }
    } else if (a && a.first_in) {
      if (toMin(a.first_in) > lateAfter) { day.late = true; sum.late++; }
      if (day.minutes === null) {
        day.status = 'MP'; day.label = 'Missing punch'; sum.missing_punch++; sum.present++;
      } else if (day.minutes >= full) {
        day.status = 'P'; day.label = 'Present'; sum.present++;
      } else if (day.minutes >= half) {
        day.status = 'HD'; day.label = 'Half day'; sum.half_day++;
        day.lop = lv ? (lv.paid ? 0 : 0.5) : 0.5;
      } else {
        day.status = 'A'; day.label = 'Short hours'; sum.absent++; day.lop = lv ? 0.5 : 1;
      }
      if (lv && lv.half_day) { day.label += ` + ½ ${lv.code}`; sum.leave += 0.5; if (!lv.paid) sum.unpaid_leave += 0.5; }
    } else if (lv && lv.half_day) {
      day.status = 'A'; day.label = `½ ${lv.code}, ½ absent`; day.lop = lv.paid ? 0.5 : 1; sum.leave += 0.5; sum.absent += 0.5;
    } else if (d > t) {
      day.status = ''; day.label = '';
    } else if (d === t) {
      day.status = '-'; day.label = 'No punch yet';
    } else {
      day.status = 'A'; day.label = 'Absent'; day.lop = 1; sum.absent++;
    }
    sum.lop += day.lop;
    days.push(day);
  }
  sum.has_attendance = att.size > 0;
  return { days, summary: sum };
}

module.exports = { pad, ymd, parseYmd, addDays, today, daysBetween, isDate, isMonth, monthDays, monthRange, toMin, isWeeklyOff, countLeaveDays, monthStatus, holidaySet };
