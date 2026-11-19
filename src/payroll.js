// Payroll computation: proration, PF, ESI, professional tax, net pay.
const { db } = require('./db');
const { monthRange, monthDays, monthStatus, daysBetween } = require('./calendar');

const r0 = (n) => Math.round(n);

// Salary structure in force at a date (latest revision on/before it, else the employee's current figures).
function structureAt(emp, date) {
  const rev = db.prepare('SELECT * FROM salary_revisions WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(emp.id, date);
  const src = rev || emp;
  return { basic: src.basic, hra: src.hra, special: src.special, other_allow: src.other_allow };
}

function professionalTax(gross, slabsStr) {
  // "15000:0,20000:150,*:200" -> up to 15000: 0, up to 20000: 150, above: 200
  const slabs = (slabsStr || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [lim, amt] = p.split(':');
    return { lim: lim === '*' ? Infinity : Number(lim), amt: Number(amt) };
  });
  for (const sl of slabs) if (gross <= sl.lim) return sl.amt;
  return 0;
}

// Suggested LOP and paid days for an employee/month.
function attendanceBasis(emp, month, s) {
  const [start, end] = monthRange(month);
  const dim = monthDays(month);
  const winStart = emp.doj && emp.doj > start ? emp.doj : start;
  const winEnd = emp.relieving_date && emp.relieving_date < end ? emp.relieving_date : end;
  const employedDays = winStart > winEnd ? 0 : daysBetween(winStart, winEnd) + 1;
  const ms = monthStatus(emp, month, s);
  const warnings = [];
  let lop = ms.summary.lop;
  if (!ms.summary.has_attendance) {
    // No biometric data imported: count only unpaid leave as LOP.
    lop = ms.days.filter((d) => d.status === 'L').reduce((a, d) => a + d.lop, 0);
    if (employedDays > 0) warnings.push('No attendance imported for this month; absences not counted.');
  }
  if (ms.summary.missing_punch) warnings.push(`${ms.summary.missing_punch} day(s) with a missing punch (counted as present).`);
  return { days_in_month: dim, employed_days: employedDays, suggested_lop: lop, summary: ms.summary, warnings };
}

// Full payslip calculation. `inp` may override lop_days, other_earnings, other_deductions, tds.
function computePayslip(emp, month, s, inp = {}) {
  const basis = attendanceBasis(emp, month, s);
  const dim = basis.days_in_month;
  const lop = Math.max(0, Math.min(basis.employed_days, inp.lop_days ?? basis.suggested_lop));
  const paidDays = Math.max(0, basis.employed_days - lop);
  const ratio = paidDays / dim;
  const st = structureAt(emp, monthRange(month)[1]);
  const fullGross = st.basic + st.hra + st.special + st.other_allow;

  const basic = r0(st.basic * ratio), hra = r0(st.hra * ratio), special = r0(st.special * ratio), other_allow = r0(st.other_allow * ratio);
  const other_earnings = r0(Number(inp.other_earnings || 0));
  const fixedGross = basic + hra + special + other_allow;
  const gross = fixedGross + other_earnings;

  let pf_wages = 0, pf_employee = 0, pf_employer_epf = 0, pf_employer_eps = 0;
  if (emp.pf_enabled) {
    let wages = basic;
    if (s.pf_apply_50pct_rule === '1') wages = Math.max(wages, r0(fixedGross * 0.5));
    const ceiling = Number(s.pf_ceiling);
    pf_wages = s.pf_restrict_to_ceiling === '1' ? Math.min(wages, ceiling) : wages;
    pf_employee = r0(pf_wages * Number(s.pf_rate_employee) / 100);
    const employerTotal = r0(pf_wages * Number(s.pf_rate_employer) / 100);
    pf_employer_eps = r0(Math.min(wages, ceiling) * Number(s.eps_rate) / 100);
    if (pf_employer_eps > employerTotal) pf_employer_eps = employerTotal;
    pf_employer_epf = employerTotal - pf_employer_eps;
  }

  let esi_employee = 0, esi_employer = 0;
  if (emp.esi_enabled && fullGross <= Number(s.esi_ceiling)) {
    esi_employee = Math.ceil(gross * Number(s.esi_rate_employee) / 100);
    esi_employer = Math.ceil(gross * Number(s.esi_rate_employer) / 100);
  }

  const pt = emp.pt_enabled && gross > 0 ? professionalTax(gross, s.pt_slabs) : 0;
  const tds = r0(Number(inp.tds ?? emp.tds_monthly ?? 0));
  const other_deductions = r0(Number(inp.other_deductions || 0));
  const total_deductions = pf_employee + esi_employee + pt + tds + other_deductions;

  return {
    employee_id: emp.id, month, days_in_month: dim, paid_days: paidDays, lop_days: lop,
    basic, hra, special, other_allow, other_earnings, gross,
    pf_wages, pf_employee, pf_employer_epf, pf_employer_eps, esi_employee, esi_employer,
    pt, tds, other_deductions, total_deductions, net_pay: gross - total_deductions,
    suggested_lop: basis.suggested_lop, warnings: basis.warnings, summary: basis.summary,
  };
}

module.exports = { computePayslip, structureAt, professionalTax, attendanceBasis };
