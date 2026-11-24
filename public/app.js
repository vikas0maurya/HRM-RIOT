/* HR Portal front end — plain JavaScript, no build step. */
'use strict';

// ---------------- utilities ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (s) => (s ? new Date(s.slice(0, 10) + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtMonth = (m) => new Date(m + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const hm = (mins) => (mins == null ? '—' : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`);
const t12 = (t) => { if (!t) return '—'; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const thisMonth = () => todayStr().slice(0, 7);
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const pill = (s, text) => `<span class="pill ${esc(s)}">${esc(text ?? s)}</span>`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hrms' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !url.includes('/login') && !url.includes('/me')) { state.me = null; render(); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b || {});

function toast(msg, err) {
  const d = document.createElement('div');
  d.textContent = msg;
  if (err) d.className = 'err';
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), err ? 6000 : 3000);
}
function modal(html, opts = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay"><div class="modal ${opts.wide ? 'wide' : ''}">${html}</div></div>`;
  const ov = $('.overlay', root);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
  const first = $('input, select, textarea', ov);
  if (first) setTimeout(() => first.focus(), 30);
  return $('.modal', root);
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };
function formObj(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value;
  }
  return o;
}
// Wire a form: handler receives data; errors are shown as a toast.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    if (btn) btn.disabled = true;
    try { await handler(formObj(form), form); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
  });
}
function credentialsModal(title, r) {
  const m = modal(`<h2>${esc(title)}</h2>
    <div class="note ok">Share these with the employee. They will be asked to set their own password on first login.</div>
    <div class="kv"><div>Login</div><div><b>${esc(r.login)}</b></div><div>Temporary password</div><div><b style="font-family:monospace;font-size:15px">${esc(r.temp_password)}</b></div><div>Portal</div><div>${esc(location.origin)}</div></div>
    <div class="actions"><button class="btn" id="cp">Copy</button><button class="btn primary" id="done">Done</button></div>`);
  $('#cp', m).onclick = async () => { try { await navigator.clipboard.writeText(`Login: ${r.login}\nTemporary password: ${r.temp_password}\nPortal: ${location.origin}`); toast('Copied'); } catch { toast('Copy failed — select and copy manually', true); } };
  $('#done', m).onclick = () => { closeModal(); render(); };
}
function confirmModal(text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const m = modal(`<h2>Please confirm</h2><p>${esc(text)}</p><div class="actions"><button class="btn" id="no">Cancel</button><button class="btn primary" id="yes">${esc(okLabel)}</button></div>`);
    $('#no', m).onclick = () => { closeModal(); resolve(false); };
    $('#yes', m).onclick = () => { closeModal(); resolve(true); };
  });
}

// Indian-system amount in words.
function inWords(num) {
  num = Math.round(num);
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''));
  const three = (n) => (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  const parts = [];
  const cr = Math.floor(num / 10000000); num %= 10000000;
  const lk = Math.floor(num / 100000); num %= 100000;
  const th = Math.floor(num / 1000); num %= 1000;
  if (cr) parts.push(three(cr) + ' Crore');
  if (lk) parts.push(two(lk) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (num) parts.push(three(num));
  return parts.join(' ');
}

// ---------------- state & routing ----------------
const state = { me: null, counts: {} };
function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [p, q] = raw.split('?');
  return { path: p, parts: p.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(q || '')) };
}
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };
window.addEventListener('hashchange', render);

async function render() {
  const app = $('#app');
  if (!state.me) {
    try { state.me = await GET('/api/me'); } catch { state.me = null; }
  }
  if (!state.me) {
    const st = await GET('/api/setup-status').catch(() => ({}));
    return st.needsSetup ? renderSetup(app) : renderLogin(app, st.company);
  }
  if (state.me.must_change_pw) return renderForcePw(app);
  document.title = `${state.me.company} · HR Portal`;
  const isHR = state.me.role === 'admin';
  if (isHR) state.counts = await GET('/api/admin/dashboard').then((d) => ({ leaves: d.pending_leaves, breaks: d.pending_breaks, res: d.pending_resignations })).catch(() => ({}));
  const { parts } = parseHash();
  const key = parts[0] || '';
  app.innerHTML = shell(isHR, key);
  $('.menu-btn')?.addEventListener('click', () => $('.side').classList.toggle('open'));
  $('#logout').onclick = async (e) => { e.preventDefault(); await POST('/api/logout'); state.me = null; location.hash = ''; render(); };
  const main = $('#main');
  const page = (isHR ? HR_PAGES : EMP_PAGES)[key] || (isHR ? HR_PAGES[''] : EMP_PAGES['']);
  try { await page(main, parseHash()); } catch (err) { main.innerHTML = `<div class="note warn">${esc(err.message)}</div>`; }
}

function shell(isHR, key) {
  const link = (k, label, badge) => `<a href="#/${k}" class="${key === k ? 'on' : ''}">${esc(label)}${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
  const c = state.counts;
  const nav = isHR
    ? `${link('', 'Dashboard')}${link('employees', 'Employees')}${link('attendance', 'Attendance')}
       <div class="sec">Requests</div>${link('leave-requests', 'Leave requests', c.leaves)}${link('break-requests', 'Break requests', c.breaks)}${link('resignations', 'Resignations', c.res)}
       <div class="sec">Payroll</div>${link('payroll', 'Run payroll')}${link('settings', 'Settings')}`
    : `${link('', 'Dashboard')}${link('attendance', 'My attendance')}${link('leaves', 'Leaves')}${link('breaks', 'Break requests')}
       <div class="sec">Pay</div>${link('salary', 'Salary & payslips')}${link('pf', 'PF ledger')}
       <div class="sec">Me</div>${link('resignation', 'Notice & resignation')}${link('profile', 'My profile')}`;
  return `<div class="shell">
    <nav class="side"><div class="brand">${esc(state.me.company)}</div><div class="role">${esc(state.me.name)} · ${isHR ? 'HR' : esc(state.me.employee?.emp_code || 'Employee')}</div>
      ${nav}<div class="sec"></div><a href="#" id="logout">Log out</a></nav>
    <main class="main"><button class="btn sm menu-btn no-print" style="margin-bottom:12px">☰ Menu</button><div id="main"><div class="muted">Loading…</div></div></main>
  </div>`;
}
const header = (title, sub, actions = '') => `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="row">${actions}</div></div>`;
const monthPicker = (m, base) => `<div class="row no-print"><a class="btn sm" href="${base}month=${shiftMonth(m, -1)}">‹</a><input type="month" value="${m}" style="width:160px" onchange="location.hash='${base}month='+this.value"><a class="btn sm" href="${base}month=${shiftMonth(m, 1)}">›</a></div>`;
const tabs = (items, cur, base) => `<div class="tabs">${items.map(([k, l]) => `<a href="${base}${k}" class="${cur === k ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;
const table = (head, rows, emptyText = 'Nothing here yet') => `<div class="tbl-wrap"><table><thead><tr>${head.map((h) => (h.startsWith('#') ? `<th class="num">${esc(h.slice(1))}</th>` : `<th>${esc(h)}</th>`)).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="empty">${esc(emptyText)}</td></tr>`}</tbody></table></div>`;

// ---------------- auth screens ----------------
function passwordStrength(value) {
  const checks = [value.length >= 8, /[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)];
  const score = checks.filter(Boolean).length;
  return { score, label: !value ? 'Enter a password' : score <= 2 ? 'Weak' : score <= 4 ? 'Good' : 'Strong' };
}
function bindPasswordTools(root) {
  const input = $('[data-password-input]', root);
  const meter = $('[data-password-meter]', root);
  const toggle = $('[data-password-toggle]', root);
  if (input && meter) {
    const update = () => {
      const result = passwordStrength(input.value);
      meter.textContent = `${result.label} · Use 8+ characters with uppercase, lowercase, a number and a symbol.`;
      meter.dataset.level = result.score <= 2 ? 'weak' : result.score <= 4 ? 'good' : 'strong';
    };
    input.addEventListener('input', update);
    update();
  }
  if (input && toggle) toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
  });
}
function strongPassword(value) {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}
function renderLogin(app, company) {
  app.innerHTML = `<div class="auth"><form class="card" id="f"><h1>${esc(company || 'HR Portal')}</h1><p class="muted" style="margin-top:0">Sign in to continue</p>
    <div class="field"><label for="login-id">Email or employee code</label><input id="login-id" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
    <div class="field"><label for="login-password">Password</label><div class="password-row"><input id="login-password" data-password-input name="password" type="password" autocomplete="current-password" required><button class="btn sm" type="button" data-password-toggle aria-label="Show password" aria-pressed="false">Show</button></div></div>
    <button class="btn primary" style="width:100%;justify-content:center" type="submit">Sign in</button>
    <p class="hint">Forgot your password? Contact your HR administrator. HR can issue a temporary password from the employee record.</p></form></div>`;
  bindPasswordTools($('#f'));
  onSubmit($('#f'), async (d) => { await POST('/api/login', d); state.me = null; render(); });
}
function renderSetup(app) {
  app.innerHTML = `<div class="auth"><form class="card" id="f"><h1>Welcome</h1><p class="muted" style="margin-top:0">Create the HR (admin) account. This screen only appears once.</p>
    <div class="field"><label>Company name</label><input name="company" autocomplete="organization" required></div>
    <div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>
    <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label>Password</label><div class="password-row"><input data-password-input name="password" type="password" minlength="8" autocomplete="new-password" required><button class="btn sm" type="button" data-password-toggle aria-label="Show password" aria-pressed="false">Show</button></div><div class="hint" data-password-meter aria-live="polite"></div></div>
    <button class="btn primary" style="width:100%;justify-content:center" type="submit">Create HR account</button></form></div>`;
  bindPasswordTools($('#f'));
  onSubmit($('#f'), async (d) => { if (!strongPassword(d.password)) throw new Error('Use at least 8 characters with uppercase, lowercase, a number and a symbol'); await POST('/api/setup', d); state.me = null; render(); });
}
function renderForcePw(app) {
  app.innerHTML = `<div class="auth"><form class="card" id="f"><h1>Set your password</h1><p class="muted" style="margin-top:0">Hi ${esc(state.me.name)}, please replace your temporary password.</p>
    <div class="field"><label>Temporary password</label><input name="current" type="password" autocomplete="current-password" required></div>
    <div class="field"><label>New password</label><div class="password-row"><input data-password-input name="next" type="password" minlength="8" autocomplete="new-password" required><button class="btn sm" type="button" data-password-toggle aria-label="Show password" aria-pressed="false">Show</button></div><div class="hint" data-password-meter aria-live="polite"></div></div>
    <div class="field"><label>Repeat new password</label><input name="again" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn primary" style="width:100%;justify-content:center" type="submit">Save password</button></form></div>`;
  bindPasswordTools($('#f'));
  onSubmit($('#f'), async (d) => {
    if (d.next !== d.again) throw new Error('Passwords do not match');
    if (!strongPassword(d.next)) throw new Error('Use at least 8 characters with uppercase, lowercase, a number and a symbol');
    await POST('/api/change-password', d); toast('Password updated'); state.me = null; render();
  });
}

// ---------------- shared views ----------------
function attendanceCalendar(days) {
  const first = new Date(days[0].date + 'T00:00').getDay();
  const t = todayStr();
  let html = `<div class="cal">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}${'<div></div>'.repeat(first)}`;
  for (const d of days) {
    html += `<div class="day ${esc(d.status)} ${d.date === t ? 'today' : ''}" data-date="${d.date}">
      <div class="row" style="justify-content:space-between"><span class="d">${Number(d.date.slice(8))}</span>${d.status && !['WO', 'NA'].includes(d.status) ? `<span class="c-${esc(d.status)}">${esc(d.status)}</span>` : ''}</div>
      ${d.first_in ? `<div>${t12(d.first_in)} – ${d.last_out ? t12(d.last_out) : '?'}</div>` : ''}
      <div class="muted">${esc(d.status === 'L' || d.status === 'H' ? d.label : d.late ? 'Late' : d.minutes != null ? hm(d.minutes) : '')}</div></div>`;
  }
  return html + '</div>';
}
function attendanceSummary(s) {
  const chip = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<div class="grid g4" style="margin-bottom:16px">${chip('Present', s.present)}${chip('Absent', s.absent)}${chip('Half days', s.half_day)}${chip('Leave', s.leave)}${chip('Late arrivals', s.late)}${chip('Missing punches', s.missing_punch)}${chip('Holidays', s.holiday)}${chip('Loss of pay days', s.lop)}</div>`;
}
function attendanceList(days, editable) {
  return table(['Date', 'Status', 'In', 'Out', 'Hours', 'Punches', 'Approved breaks', ...(editable ? [''] : [])],
    days.filter((d) => d.status !== '').map((d) => `<tr><td>${fmtDate(d.date)} <span class="muted">${DOW[new Date(d.date + 'T00:00').getDay()]}</span></td>
      <td>${d.status ? pill(d.status, d.label || d.status) : ''}${d.late ? ' ' + pill('warn', 'Late') : ''}</td><td>${t12(d.first_in)}</td><td>${t12(d.last_out)}</td><td>${hm(d.minutes)}</td>
      <td class="muted">${esc(d.punches.join(', '))}${d.source === 'manual' ? ' (edited)' : ''}</td><td>${esc(d.breaks.map((b) => `${b.start}–${b.end}`).join(', '))}</td>
      ${editable ? `<td><button class="btn sm" data-edit="${d.date}" data-in="${d.first_in || ''}" data-out="${d.last_out || ''}">Edit</button></td>` : ''}</tr>`));
}

function myAttendanceTable(days) {
  const visibleDays = days.filter((d) => d.status !== '');
  const rows = visibleDays.map((d) => {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const punchText = punches.length ? punches.join(' · ') : '—';
    const source = d.source === 'manual' ? 'HR adjusted' : d.source === 'biometric' ? 'Biometric' : '—';
    return `<tr data-att-row data-status="${esc(d.status)}">
      <td>${fmtDate(d.date)} <span class="muted">${DOW[new Date(d.date + 'T00:00').getDay()]}</span></td>
      <td>${d.status ? pill(d.status, d.label || d.status) : '—'}${d.late ? ' ' + pill('warn', 'Late') : ''}</td>
      <td>${t12(d.first_in)}</td><td>${t12(d.last_out)}</td><td>${hm(d.minutes)}</td>
      <td class="wrap">${esc(punchText)}</td><td>${esc(source)}</td>
      <td class="wrap">${esc(d.note || '')}</td>
    </tr>`;
  });
  return `<div class="tbl-wrap"><table id="my-attendance-table">
    <thead><tr><th>Date</th><th>Status</th><th>First in</th><th>Last out</th><th>Working hours</th><th>Recorded punches</th><th>Source</th><th>HR note</th></tr></thead>
    <tbody>${rows.length ? rows.join('') : '<tr><td colspan="8" class="empty">No attendance records for this month.</td></tr>'}</tbody>
  </table></div>`;
}
function downloadAttendanceCsv(month, days) {
  const columns = ['Date', 'Day', 'Status', 'First In', 'Last Out', 'Working Minutes', 'Punches', 'Source', 'HR Note'];
  const lines = [columns, ...days.filter((d) => d.status !== '').map((d) => [
    d.date, DOW[new Date(d.date + 'T00:00').getDay()], d.label || d.status,
    d.first_in || '', d.last_out || '', d.minutes ?? '',
    (Array.isArray(d.punches) ? d.punches.join(' | ') : ''),
    d.source || '', d.note || ''
  ])];
  const csv = lines.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `RIOT-Attendance-${month}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function leaveBalanceCards(bal) {
  return `<div class="grid g4" style="margin-bottom:16px">${bal.filter((b) => b.paid).map((b) => `<div class="stat"><div class="k">${esc(b.name)} (${esc(b.code)})</div><div class="v">${b.balance}</div><div class="s">Used ${b.used}${b.pending ? ` · ${b.pending} pending` : ''}</div></div>`).join('')}</div>`;
}
function leaveLedgerTable(rows) {
  return table(['Date', 'Type', 'Entry', 'Details', '#Days', '#Balance'], [...rows].reverse().map((r) => `<tr><td>${fmtDate(r.txn_date)}</td><td>${esc(r.code)}</td><td>${pill(r.days > 0 ? 'ok' : 'bad', r.kind)}</td><td class="wrap">${esc(r.note)}</td><td class="num">${r.days > 0 ? '+' : ''}${r.days}</td><td class="num"><b>${r.paid ? r.balance_after : '—'}</b></td></tr>`), 'No leave entries yet');
}
function leaveRequestRows(rows, hr) {
  return rows.map((r) => `<tr>${hr ? `<td><a href="#/employees/${r.employee_id}">${esc(r.emp_name)}</a><div class="muted">${esc(r.emp_code)}</div></td>` : ''}
    <td>${esc(r.code)}</td><td>${fmtDate(r.from_date)}${r.to_date !== r.from_date ? ' → ' + fmtDate(r.to_date) : ''}${r.half_day ? ' (½)' : ''}</td><td class="num">${r.days}</td>
    <td class="wrap">${esc(r.reason)}</td><td>${pill(r.status)}${r.hr_note ? `<div class="muted wrap">${esc(r.hr_note)}</div>` : ''}</td>
    <td>${hr ? (r.status === 'pending' ? `<button class="btn sm ok" data-leave="${r.id}" data-act="approve">Approve</button> <button class="btn sm danger" data-leave="${r.id}" data-act="reject">Reject</button>` : r.status === 'approved' ? `<button class="btn sm" data-leave="${r.id}" data-act="revoke">Revoke</button>` : '')
      : r.status === 'pending' ? `<button class="btn sm" data-cancel-leave="${r.id}">Cancel</button>` : ''}</td></tr>`);
}
function bindLeaveDecisions(el) {
  $$('[data-leave]', el).forEach((b) => (b.onclick = () => {
    const act = b.dataset.act;
    const m = modal(`<h2>${act === 'approve' ? 'Approve' : act === 'reject' ? 'Reject' : 'Revoke'} leave</h2>${act === 'revoke' ? '<div class="note warn">The days will be credited back to the employee\'s balance.</div>' : ''}
      <form id="f"><div class="field"><label>Note to employee (optional)</label><textarea name="note"></textarea></div>
      <div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">${act === 'approve' ? 'Approve' : act === 'reject' ? 'Reject' : 'Revoke'}</button></div></form>`);
    onSubmit($('#f', m), async (d) => { await POST(`/api/admin/leaves/${b.dataset.leave}/decide`, { action: act, note: d.note }); closeModal(); toast('Done'); render(); });
  }));
}
function salaryStructureCard(cur) {
  return `<div class="card"><h2>Current monthly salary</h2><div class="kv"><div>Basic</div><div>${inr(cur.basic)}</div><div>HRA</div><div>${inr(cur.hra)}</div><div>Special allowance</div><div>${inr(cur.special)}</div><div>Other allowance</div><div>${inr(cur.other_allow)}</div><div><b>Gross per month</b></div><div><b>${inr(cur.gross)}</b></div><div>Gross per year</div><div>${inr(cur.gross * 12)}</div></div></div>`;
}
function payslipRows(slips, base, hr) {
  return slips.map((p) => `<tr><td><b>${fmtMonth(p.month)}</b></td><td class="num">${p.paid_days}</td><td class="num">${p.lop_days}</td><td class="num">${inr(p.gross)}</td><td class="num">${inr(p.total_deductions)}</td><td class="num"><b>${inr(p.net_pay)}</b></td>
    <td>${pill(p.status, p.status === 'paid' ? 'Paid' : 'Processed')}${p.paid_on ? `<div class="muted">${fmtDate(p.paid_on)}${p.payment_ref ? ' · ' + esc(p.payment_ref) : ''}</div>` : ''}</td><td><a class="btn sm" href="${base}${p.id}">View</a></td></tr>`);
}
function revisionsTable(revs) {
  return table(['Effective from', '#Basic', '#HRA', '#Special', '#Other', '#Gross / month', 'Note'], revs.map((r) => `<tr><td>${fmtDate(r.effective_from)}</td><td class="num">${inr(r.basic)}</td><td class="num">${inr(r.hra)}</td><td class="num">${inr(r.special)}</td><td class="num">${inr(r.other_allow)}</td><td class="num"><b>${inr(r.basic + r.hra + r.special + r.other_allow)}</b></td><td class="wrap">${esc(r.note)}</td></tr>`), 'No revisions recorded');
}
function pfTable(pf) {
  return `<div class="grid g4" style="margin-bottom:16px"><div class="stat"><div class="k">Your contribution</div><div class="v">${inr(pf.totals.employee)}</div></div><div class="stat"><div class="k">Employer EPF</div><div class="v">${inr(pf.totals.employer_epf)}</div></div><div class="stat"><div class="k">PF balance (excl. interest)</div><div class="v">${inr(pf.totals.pf_balance)}</div></div><div class="stat"><div class="k">Pension (EPS)</div><div class="v">${inr(pf.totals.eps)}</div></div></div>
  <div class="card">${table(['Month', '#PF wages', '#Employee 12%', '#Employer EPF', '#Employer EPS', '#Total', '#PF balance'], pf.rows.map((r) => `<tr><td>${fmtMonth(r.month)}</td><td class="num">${inr(r.pf_wages)}</td><td class="num">${inr(r.pf_employee)}</td><td class="num">${inr(r.pf_employer_epf)}</td><td class="num">${inr(r.pf_employer_eps)}</td><td class="num">${inr(r.total)}</td><td class="num"><b>${inr(r.cumulative_pf)}</b></td></tr>`), 'No PF contributions yet')}
  <p class="hint">The balance is the sum of contributions recorded in payroll. Interest is credited by EPFO — check the EPFO passbook with your UAN for the official figure.</p></div>`;
}
function noticeCard(n) {
  const r = n.resignation;
  let body = `<div class="kv"><div>Notice period</div><div><b>${n.notice_days} days</b></div><div>Employment status</div><div>${pill(n.status)}</div>`;
  if (r && r.status === 'accepted') {
    body += `<div>Resigned on</div><div>${fmtDate(r.submitted_on)}</div><div>Notice ends (as per policy)</div><div>${fmtDate(r.notice_end)}</div><div>Approved last working day</div><div><b>${fmtDate(n.last_working_day)}</b></div>
      <div>Days served</div><div>${n.days_served}</div><div>Days remaining</div><div><b>${n.days_remaining}</b></div>${n.shortfall_days ? `<div>Notice shortfall</div><div>${n.shortfall_days} days (waived or to be recovered as per policy)</div>` : ''}`;
  }
  if (n.relieving_date && n.status === 'relieved') body += `<div>Relieved on</div><div>${fmtDate(n.relieving_date)}</div>`;
  return `<div class="card"><h2>Notice period</h2>${body}</div></div>`;
}
async function payslipView(el, url, back) {
  const p = await GET(url);
  const e = p.employee;
  const earn = [['Basic', p.basic], ['House rent allowance', p.hra], ['Special allowance', p.special], ['Other allowance', p.other_allow], ['Incentive / other earnings', p.other_earnings]].filter((x) => x[1]);
  const ded = [['Provident fund (employee)', p.pf_employee], ['ESI (employee)', p.esi_employee], ['Professional tax', p.pt], ['Income tax (TDS)', p.tds], ['Other deductions', p.other_deductions]].filter((x) => x[1]);
  const n = Math.max(earn.length, ded.length);
  let rows = '';
  for (let i = 0; i < n; i++) rows += `<tr><td>${esc(earn[i]?.[0] || '')}</td><td class="num">${earn[i] ? inr(earn[i][1]) : ''}</td><td>${esc(ded[i]?.[0] || '')}</td><td class="num">${ded[i] ? inr(ded[i][1]) : ''}</td></tr>`;
  el.innerHTML = `${header('Payslip', fmtMonth(p.month), `<a class="btn" href="${back}">Back</a><button class="btn primary" onclick="window.print()">Print / Save PDF</button>`)}
  <div class="slip"><div class="hd"><div><div class="co">${esc(p.company.name)}</div><div class="muted" style="white-space:pre-line">${esc(p.company.address)}</div></div><div style="text-align:right"><b>Payslip</b><div>${fmtMonth(p.month)}</div></div></div>
    <div class="grid g2" style="margin-bottom:16px"><div class="kv"><div>Employee</div><div><b>${esc(e.name)}</b></div><div>Employee code</div><div>${esc(e.emp_code)}</div><div>Designation</div><div>${esc(e.designation || '—')}</div><div>Department</div><div>${esc(e.department || '—')}</div><div>Date of joining</div><div>${fmtDate(e.doj)}</div></div>
    <div class="kv"><div>PAN</div><div>${esc(e.pan || '—')}</div><div>UAN</div><div>${esc(e.uan || '—')}</div><div>Bank</div><div>${esc(e.bank_name || '—')}${e.bank_account ? ' · XXXX' + esc(String(e.bank_account).slice(-4)) : ''}</div><div>Days in month</div><div>${p.days_in_month}</div><div>Paid days / LOP</div><div>${p.paid_days} / ${p.lop_days}</div></div></div>
    <table><thead><tr><th>Earnings</th><th class="num">Amount</th><th>Deductions</th><th class="num">Amount</th></tr></thead><tbody>${rows}
    <tr><td><b>Gross earnings</b></td><td class="num"><b>${inr(p.gross)}</b></td><td><b>Total deductions</b></td><td class="num"><b>${inr(p.total_deductions)}</b></td></tr></tbody></table>
    <div class="net"><span>Net pay</span><span>${inr(p.net_pay)}</span></div><div class="muted" style="margin-top:6px">Rupees ${esc(inWords(p.net_pay))} only</div>
    ${p.pf_employer_epf || p.pf_employer_eps || p.esi_employer ? `<p class="muted" style="margin-top:14px">Employer contributions (not deducted from pay): EPF ${inr(p.pf_employer_epf)} · EPS ${inr(p.pf_employer_eps)}${p.esi_employer ? ` · ESI ${inr(p.esi_employer)}` : ''}</p>` : ''}
    ${p.remarks ? `<p class="muted">Remarks: ${esc(p.remarks)}</p>` : ''}
    <p class="muted" style="margin-top:24px;font-size:12px">This is a computer-generated payslip and does not require a signature.</p></div>`;
}

// ================= EMPLOYEE PAGES =================
const EMP_PAGES = {
  async ''(el) {
    const d = await GET('/api/my/dashboard');
    const t = d.today;
    const n = d.notice;
    const summary = d.month_summary || {};
    const todayStatus = t?.status === 'WO' ? 'Weekly off'
      : t?.status === 'H' ? 'Holiday'
        : t?.status === 'P' ? 'Present'
          : t?.status === 'HD' ? 'Half day'
            : t?.status === 'MP' ? 'Missing punch'
              : t?.status === 'A' ? 'Absent'
                : t?.status === '-' ? 'No punch yet'
                  : t?.label || 'Not available';
    const attendanceTone = ['Present'].includes(todayStatus) ? 'ok' : (['Weekly off', 'Holiday'].includes(todayStatus) ? 'info' : 'warn');
    const worked = Number(summary.present || 0) + Number(summary.half_day || 0);
    const attendancePct = summary.elapsed_working_days
      ? Math.min(100, Math.round((worked / summary.elapsed_working_days) * 100)) : 0;
    el.innerHTML = `${header(`Hello, ${d.profile.name.split(' ')[0]}`, `${esc(d.profile.designation || '')} ${d.profile.department ? '· ' + esc(d.profile.department) : ''} · ${esc(d.profile.emp_code)}`, `<a class="btn" href="#/breaks?new=1">Request break</a><a class="btn primary" href="#/leaves?new=1">Apply leave</a>`)}
    ${d.profile.status === 'notice' && n.last_working_day ? `<div class="note warn">You are serving notice. Last working day: <b>${fmtDate(n.last_working_day)}</b> (${n.days_remaining} days left).</div>` : ''}
    <div class="card dashboard-attendance">
      <div class="dash-attendance-head">
        <div><div class="k">Today's attendance</div><div class="dash-status">${pill(attendanceTone, todayStatus)}</div></div>
        <a class="btn sm" href="#/attendance">View attendance</a>
      </div>
      <div class="grid g3">
        <div><div class="k">First login</div><div class="dash-time">${t?.first_in ? t12(t.first_in) : '—'}</div></div>
        <div><div class="k">Last logout</div><div class="dash-time">${t?.last_out ? t12(t.last_out) : '—'}</div></div>
        <div><div class="k">Working time</div><div class="dash-time">${t?.minutes != null ? hm(t.minutes) : '—'}</div></div>
      </div>
      <div class="hint">${t?.source ? `Attendance source: ${esc(t.source)}` : 'Attendance times appear here after biometric attendance is synchronized.'}</div>
    </div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="stat"><div class="k">Present this month</div><div class="v">${summary.present || 0}</div><div class="s">${summary.absent || 0} absent · ${summary.late || 0} late</div></div>
      <div class="stat"><div class="k">Scheduled working days</div><div class="v">${summary.scheduled_working_days || 0}</div><div class="s">${summary.elapsed_working_days || 0} elapsed so far</div></div>
      <div class="stat"><div class="k">Pending requests</div><div class="v">${d.pending.leaves + d.pending.breaks}</div><div class="s">${d.pending.leaves} leave · ${d.pending.breaks} break</div><a class="stat-link" href="#/leaves">View requests →</a></div>
      <a class="stat" href="${d.last_payslip ? '#/payslip/' + d.last_payslip.id : '#/salary'}"><div class="k">Last payslip</div><div class="v">${d.last_payslip ? inr(d.last_payslip.net_pay) : '—'}</div><div class="s">${d.last_payslip ? fmtMonth(d.last_payslip.month) : 'None yet'}</div></a>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between"><h2>Monthly attendance progress</h2><span class="muted">${attendancePct}% of elapsed working days present/half-day</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${attendancePct}%"></div></div>
      <div class="dash-metrics"><span>${summary.half_day || 0} half days</span><span>${summary.leave || 0} leave days</span><span>${summary.weekly_off || 0} weekly offs</span><span>${summary.holiday || 0} holidays</span></div>
    </div>
    <div class="card">
      <h2>Office working schedule</h2>
      <div class="schedule-chips"><span class="schedule-chip active">1st Saturday · Working</span><span class="schedule-chip off">2nd Saturday · Off</span><span class="schedule-chip active">3rd Saturday · Working</span><span class="schedule-chip off">4th Saturday · Off</span><span class="schedule-chip active">5th Saturday · Working</span></div>
      <div class="hint">Monday to Friday: Working · Sunday: Weekly off. Declared company holidays are handled separately.</div>
    </div>
    <h2>Leave balance</h2>${leaveBalanceCards(d.balances)}`;
  },

  async attendance(el, { q }) {
    const month = q.month || thisMonth();
    const d = await GET(`/api/my/attendance?month=${month}`);
    const s = d.summary || {};
    const rate = s.elapsed_working_days
      ? Math.round(((Number(s.present || 0) + Number(s.half_day || 0) * 0.5) / s.elapsed_working_days) * 100)
      : 0;
    const missing = Number(s.missing_punch || 0);
    const schedule = `<div class="riot-work-schedule">
      <b>RIOT Ecommerce working schedule</b>
      <div class="riot-schedule-chips">
        <span class="schedule-chip active">1st Saturday · Working</span>
        <span class="schedule-chip off">2nd Saturday · Off</span>
        <span class="schedule-chip active">3rd Saturday · Working</span>
        <span class="schedule-chip off">4th Saturday · Off</span>
        <span class="schedule-chip active">5th Saturday · Working</span>
      </div>
      <div class="hint">Monday–Friday are working days. Every Sunday is weekly off. Company holidays are shown separately.</div>
    </div>`;
    el.innerHTML = `${header('My attendance', `${fmtMonth(month)} · your monthly attendance and punch history`,
      `${monthPicker(month, '#/attendance?')}<button class="btn sm" id="export-my-attendance">Export CSV</button>`)}
      <div class="grid g4 my-attendance-stats">
        <div class="stat"><div class="k">Present</div><div class="v">${Number(s.present || 0)}</div><div class="s">Full working days</div></div>
        <div class="stat"><div class="k">Absent</div><div class="v">${Number(s.absent || 0)}</div><div class="s">Scheduled days</div></div>
        <div class="stat"><div class="k">Half days</div><div class="v">${Number(s.half_day || 0)}</div><div class="s">Partial attendance</div></div>
        <div class="stat"><div class="k">Attendance rate</div><div class="v">${rate}%</div><div class="s">${Number(s.elapsed_working_days || 0)} elapsed working days</div></div>
        <div class="stat"><div class="k">Late arrivals</div><div class="v">${Number(s.late || 0)}</div><div class="s">Based on configured shift</div></div>
        <div class="stat"><div class="k">Missing punches</div><div class="v">${missing}</div><div class="s">Needs HR review</div></div>
        <div class="stat"><div class="k">Approved leave</div><div class="v">${Number(s.leave || 0)}</div><div class="s">Leave days</div></div>
        <div class="stat"><div class="k">Loss of pay</div><div class="v">${Number(s.lop || 0)}</div><div class="s">Calculated LOP days</div></div>
      </div>
      ${missing ? `<div class="note warn"><b>${missing} attendance day(s) have missing punches.</b> Please contact HR and share the affected date(s) for verification.</div>` : ''}
      ${schedule}
      <div class="card my-attendance-calendar-card">
        <div class="row" style="justify-content:space-between;align-items:center"><h2>Monthly calendar</h2><span class="muted">${Number(s.scheduled_working_days || 0)} scheduled working days this month</span></div>
        ${attendanceCalendar(d.days)}
        <div class="attendance-legend">
          <span>${pill('P', 'Present')}</span><span>${pill('A', 'Absent')}</span><span>${pill('HD', 'Half day')}</span>
          <span>${pill('L', 'Leave')}</span><span>${pill('WO', 'Weekly off')}</span><span>${pill('H', 'Holiday')}</span><span>${pill('MP', 'Missing punch')}</span>
        </div>
      </div>
      <div class="card">
        <div class="row my-attendance-table-head">
          <div><h2>Daily punch details</h2><p class="hint">Original punch times and the attendance source recorded by HRM.</p></div>
          <div class="field my-attendance-filter"><label for="attendance-status-filter">Filter by status</label>
            <select id="attendance-status-filter"><option value="">All statuses</option>
              <option value="P">Present</option><option value="A">Absent</option><option value="HD">Half day</option>
              <option value="L">Leave</option><option value="MP">Missing punch</option><option value="WO">Weekly off</option><option value="H">Holiday</option>
            </select>
          </div>
        </div>
        ${myAttendanceTable(d.days)}
      </div>
      <p class="hint">If a punch is missing or incorrect, contact HR with the date. Attendance corrections are controlled by HR to preserve an audit trail.</p>`;
    $('#export-my-attendance', el).onclick = () => downloadAttendanceCsv(month, d.days);
    $('#attendance-status-filter', el).onchange = (e) => {
      const value = e.target.value;
      $$('[data-att-row]', el).forEach((row) => { row.hidden = Boolean(value && row.dataset.status !== value); });
    };
  },

  async leaves(el, { q }) {
    const d = await GET('/api/my/leaves');
    const tab = q.tab || 'requests';
    const requests = Array.isArray(d.requests) ? d.requests : [];
    const balances = Array.isArray(d.balances) ? d.balances : [];
    const ledger = Array.isArray(d.ledger) ? d.ledger : [];
    const pendingCount = requests.filter((r) => r.status === 'pending').length;
    const approvedCount = requests.filter((r) => r.status === 'approved').length;
    const rejectedCount = requests.filter((r) => r.status === 'rejected').length;
    const paidAvailable = balances.filter((b) => b.paid).reduce((n, b) => n + Math.max(0, Number(b.balance || 0) - Number(b.pending || 0)), 0);
    const requestsView = `<div class="grid g3 leave-overview">
      <div class="stat"><div class="k">Pending requests</div><div class="v">${pendingCount}</div><div class="s">Awaiting HR decision</div></div>
      <div class="stat"><div class="k">Approved requests</div><div class="v">${approvedCount}</div><div class="s">Approved by HR</div></div>
      <div class="stat"><div class="k">Rejected requests</div><div class="v">${rejectedCount}</div><div class="s">Review HR notes</div></div>
    </div>
    <div class="card">
      <div class="row leave-filter-row">
        <div><h2>My leave requests</h2><p class="hint">Track decisions and HR notes for every application.</p></div>
        <div class="field"><label for="leave-status-filter">Filter status</label>
          <select id="leave-status-filter"><option value="">All requests</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
        </div>
      </div>
      <div class="tbl-wrap"><table id="my-leave-requests">
        <thead><tr><th>Leave type</th><th>Dates</th><th>Working days</th><th>Reason</th><th>Status / HR note</th><th>Action</th></tr></thead>
        <tbody>${requests.length ? leaveRequestRows(requests, false).map((row, i) => row.replace('<tr>', `<tr data-leave-status="${esc(requests[i].status)}">`)).join('') : '<tr><td colspan="6" class="empty">No leave requests yet. Select Apply leave to create your first request.</td></tr>'}</tbody>
      </table></div>
    </div>`;
    const calendarView = `<div class="card">
      <h2>Leave calendar</h2>
      <p class="hint">Approved and pending leave applications are shown below.</p>
      <div class="leave-calendar-list">${requests.length ? [...requests].sort((a, b) => a.from_date.localeCompare(b.from_date)).map((r) => `<div class="leave-calendar-item">
        <div class="leave-calendar-date"><b>${fmtDate(r.from_date)}</b>${r.to_date !== r.from_date ? `<span>to ${fmtDate(r.to_date)}</span>` : ''}</div>
        <div class="leave-calendar-detail"><b>${esc(r.code)}</b><span>${Number(r.days)} working day(s)${r.half_day ? ' · Half day' : ''}</span></div>
        <div>${pill(r.status)}${r.hr_note ? `<div class="muted">${esc(r.hr_note)}</div>` : ''}</div>
      </div>`).join('') : '<div class="empty">No leave applications to display.</div>'}</div>
    </div>`;
    el.innerHTML = `${header('Leaves', 'Manage your leave balance, applications and history', '<button class="btn primary" id="apply">Apply leave</button>')}
      <div class="grid g3 leave-overview">
        <div class="stat"><div class="k">Available paid leave</div><div class="v">${paidAvailable}</div><div class="s">After pending requests</div></div>
        <div class="stat"><div class="k">Pending requests</div><div class="v">${pendingCount}</div><div class="s">Awaiting HR decision</div></div>
        <div class="stat"><div class="k">Approved requests</div><div class="v">${approvedCount}</div><div class="s">Recorded in your leave history</div></div>
      </div>
      <h2 class="section-title">Leave balances</h2>
      ${leaveBalanceCards(balances)}
      <div class="leave-policy-note">
        <b>RIOT Ecommerce working-day policy</b>
        <p>Monday–Friday: working. 1st, 3rd and 5th Saturdays: working. 2nd and 4th Saturdays and every Sunday: weekly off.</p>
        <small>Company holidays are excluded from the final leave-day calculation. The server's calculated day count is authoritative.</small>
      </div>
      ${tabs([['requests', 'My requests'], ['calendar', 'Leave calendar'], ['ledger', 'Leave ledger']], tab, '#/leaves?tab=')}
      ${tab === 'ledger' ? `<div class="card">${leaveLedgerTable(ledger)}</div>` : tab === 'calendar' ? calendarView : requestsView}`;
    const open = () => {
      const m = modal(`<h2>Apply for leave</h2><form id="f">
        <div class="field"><label>Leave type</label><select name="leave_type_id" required>${d.types.map((t) => { const b = balances.find((x) => x.id === t.id); return `<option value="${t.id}">${esc(t.name)}${t.paid ? ` — ${b ? Math.max(0, Number(b.balance) - Number(b.pending || 0)) : 0} available` : ' (unpaid)'}</option>`; }).join('')}</select></div>
        <div class="grid g2"><div class="field"><label>From</label><input type="date" name="from_date" required value="${todayStr()}"></div><div class="field"><label>To</label><input type="date" name="to_date" required value="${todayStr()}"></div></div>
        <label class="check field"><input type="checkbox" name="half_day"> Half day (single date only)</label>
        <div class="field"><label>Reason</label><textarea name="reason" required maxlength="1000" placeholder="Please explain why you need leave"></textarea></div>
        <div class="note">Leave days are calculated using the RIOT working calendar: 1st, 3rd and 5th Saturdays are working; 2nd and 4th Saturdays and Sundays are weekly offs. Company holidays are excluded by HRM.</div>
        <div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Submit request</button></div></form>`);
      const f = $('#f', m);
      f.from_date.onchange = () => { if (f.to_date.value < f.from_date.value) f.to_date.value = f.from_date.value; };
      f.to_date.min = f.from_date.value;
      f.half_day.onchange = () => { if (f.half_day.checked) f.to_date.value = f.from_date.value; };
      f.from_date.onchange = () => { f.to_date.min = f.from_date.value; if (f.to_date.value < f.from_date.value || f.half_day.checked) f.to_date.value = f.from_date.value; };
      onSubmit(f, async (data) => {
        if (data.to_date < data.from_date) { toast('End date cannot be before start date', true); return; }
        if (data.half_day && data.from_date !== data.to_date) { toast('Half-day leave must be for one date', true); return; }
        const r = await POST('/api/my/leaves', data);
        closeModal(); toast(`Leave request sent (${r.days} day${r.days === 1 ? '' : 's'})`); go('#/leaves');
      });
    };
    $('#apply').onclick = open;
    if (q.new) open();
    const statusFilter = $('#leave-status-filter', el);
    if (statusFilter) statusFilter.onchange = () => {
      $$('[data-leave-status]', el).forEach((row) => { row.hidden = Boolean(statusFilter.value && row.dataset.leaveStatus !== statusFilter.value); });
    };
    $$('[data-cancel-leave]', el).forEach((b) => (b.onclick = async () => {
      if (await confirmModal('Cancel this leave request?', 'Cancel request')) {
        await POST(`/api/my/leaves/${b.dataset.cancelLeave}/cancel`).catch((e) => toast(e.message, true));
        render();
      }
    }));
  },
  async breaks(el, { q }) {
    const rows = await GET('/api/my/breaks');
    el.innerHTML = `${header('Break requests', 'Ask permission to step out during working hours', '<button class="btn primary" id="new">Request break</button>')}
      <div class="card">${table(['Date', 'Time', '#Minutes', 'Reason', 'Status', ''], rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${t12(r.start_time)} – ${t12(r.end_time)}</td><td class="num">${r.minutes}</td><td class="wrap">${esc(r.reason)}</td><td>${pill(r.status)}${r.hr_note ? `<div class="muted wrap">${esc(r.hr_note)}</div>` : ''}</td><td>${r.status === 'pending' ? `<button class="btn sm" data-c="${r.id}">Cancel</button>` : ''}</td></tr>`), 'No break requests yet')}</div>`;
    const open = () => {
      const m = modal(`<h2>Request a break</h2><form id="f"><div class="field"><label>Date</label><input type="date" name="date" value="${todayStr()}" required></div>
        <div class="grid g2"><div class="field"><label>From</label><input type="time" name="start_time" required></div><div class="field"><label>To</label><input type="time" name="end_time" required></div></div>
        <div class="field"><label>Reason</label><textarea name="reason" required></textarea></div>
        <div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Submit</button></div></form>`);
      onSubmit($('#f', m), async (d) => { await POST('/api/my/breaks', d); closeModal(); toast('Break request sent'); go('#/breaks'); });
    };
    $('#new').onclick = open;
    if (q.new) open();
    $$('[data-c]', el).forEach((b) => (b.onclick = async () => { await POST(`/api/my/breaks/${b.dataset.c}/cancel`).catch((e) => toast(e.message, true)); render(); }));
  },

  async salary(el) {
    const s = await GET('/api/my/salary');
    el.innerHTML = `${header('Salary & payslips', 'Your salary ledger')}
      <div class="grid g2"><div>${salaryStructureCard(s.current)}</div><div class="card"><h2>Totals</h2><div class="kv"><div>Total gross earned</div><div>${inr(s.totals.gross)}</div><div>Total net pay</div><div>${inr(s.totals.net)}</div><div>Paid</div><div>${inr(s.totals.paid)}</div><div>Processed, not yet paid</div><div>${inr(s.totals.unpaid)}</div></div></div></div>
      <div class="card"><h2>Salary ledger</h2>${table(['Month', '#Paid days', '#LOP', '#Gross', '#Deductions', '#Net pay', 'Status', ''], payslipRows(s.payslips, '#/payslip/'), 'No payslips yet')}</div>
      <div class="card"><h2>Salary revisions</h2>${revisionsTable(s.revisions)}</div>`;
  },

  async pf(el) {
    const pf = await GET('/api/my/pf');
    el.innerHTML = `${header('PF ledger', `UAN: ${esc(pf.uan || 'not added yet')}`)}${pfTable(pf)}`;
  },

  async resignation(el) {
    const d = await GET('/api/my/resignation');
    const pending = d.history.find((r) => r.status === 'pending');
    let action = '';
    if (pending) action = `<div class="card"><h2>Resignation submitted</h2><div class="note warn">Waiting for HR. Submitted on ${fmtDate(pending.submitted_on)}. As per your ${pending.notice_days}-day notice period, your notice would end on <b>${fmtDate(pending.notice_end)}</b>.</div><p class="wrap">${esc(pending.reason)}</p><button class="btn danger" id="wd">Withdraw resignation</button></div>`;
    else if (d.status === 'active') action = `<div class="card"><h2>Submit resignation</h2><form id="f"><div class="field"><label>Reason</label><textarea name="reason" required></textarea></div>
      <div class="field"><label>Preferred last working day (optional)</label><input type="date" name="requested_last_day" min="${todayStr()}" style="max-width:220px"><div class="hint">Your notice period is ${d.notice_days} days. HR will confirm the final last working day.</div></div>
      <button class="btn primary" type="submit">Submit resignation</button></form></div>`;
    el.innerHTML = `${header('Notice & resignation')}${noticeCard(d)}${action}
      <div class="card"><h2>History</h2>${table(['Submitted', 'Requested last day', 'Status', 'Approved last day', 'HR note'], d.history.map((r) => `<tr><td>${fmtDate(r.submitted_on)}</td><td>${fmtDate(r.requested_last_day)}</td><td>${pill(r.status)}</td><td>${fmtDate(r.approved_last_day)}</td><td class="wrap">${esc(r.hr_note)}</td></tr>`), 'No resignations')}</div>`;
    if ($('#f')) onSubmit($('#f'), async (data) => { if (!(await confirmModal('Submit your resignation to HR?', 'Submit'))) return; await POST('/api/my/resignation', data); toast('Resignation submitted'); render(); });
    if ($('#wd')) $('#wd').onclick = async () => { if (await confirmModal('Withdraw your resignation?', 'Withdraw')) { await POST('/api/my/resignation/withdraw'); render(); } };
  },

  async profile(el) {
    const p = await GET('/api/my/profile');
    const kv = (k, v) => `<div>${k}</div><div>${esc(v || '—')}</div>`;
    el.innerHTML = `${header('My profile', 'Contact HR to update any details')}
      <div class="grid g2"><div class="card"><h2>Personal & job</h2><div class="kv">${kv('Name', p.name)}${kv('Employee code', p.emp_code)}${kv('Email', p.email)}${kv('Phone', p.phone)}${kv('Designation', p.designation)}${kv('Department', p.department)}${kv('Date of joining', fmtDate(p.doj))}${kv('Date of birth', fmtDate(p.dob))}</div></div>
      <div class="card"><h2>Statutory & bank</h2><div class="kv">${kv('PAN', p.pan)}${kv('UAN', p.uan)}${kv('ESIC no.', p.esic_no)}${kv('Bank', p.bank_name)}${kv('Account', p.bank_account ? 'XXXX' + String(p.bank_account).slice(-4) : '')}${kv('IFSC', p.ifsc)}${kv('Notice period', p.notice_days + ' days')}</div></div></div>
      ${changePwCard()}`;
    bindChangePw();
  },

  async payslip(el, { parts }) { await payslipView(el, `/api/my/payslips/${parts[1]}`, '#/salary'); },
};

function changePwCard() {
  return `<div class="card" style="max-width:420px"><h2>Change password</h2><form id="pw"><div class="field"><label>Current password</label><input type="password" name="current" required></div><div class="field"><label>New password (min 8)</label><input type="password" name="next" minlength="8" required></div><button class="btn primary" type="submit">Update password</button></form></div>`;
}
function bindChangePw() { onSubmit($('#pw'), async (d, f) => { await POST('/api/change-password', d); f.reset(); toast('Password updated'); }); }

// ================= HR PAGES =================
const empForm = (e = {}) => {
  const f = (name, label, type = 'text', extra = '') => `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(e[name] ?? '')}" ${extra}></div>`;
  const ck = (name, label) => `<label class="check field"><input type="checkbox" name="${name}" ${e[name] ?? (name !== 'esi_enabled') ? 'checked' : ''}> ${label}</label>`;
  return `<h3>Job</h3><div class="grid g3">${f('emp_code', 'Employee code *', 'text', 'required')}${f('name', 'Full name *', 'text', 'required')}${f('email', 'Email (login) *', 'email', 'required')}
    ${f('phone', 'Phone')}${f('designation', 'Designation')}${f('department', 'Department')}${f('doj', 'Date of joining', 'date')}${f('dob', 'Date of birth', 'date')}${f('notice_days', 'Notice period (days)', 'number', 'min="0"')}</div>
    <h3>Statutory & bank</h3><div class="grid g3">${f('pan', 'PAN')}${f('uan', 'UAN')}${f('esic_no', 'ESIC no.')}${f('bank_name', 'Bank')}${f('bank_account', 'Account number')}${f('ifsc', 'IFSC')}</div>
    <h3>Deductions</h3><div class="row" style="gap:20px">${ck('pf_enabled', 'PF applicable')}${ck('esi_enabled', 'ESI applicable')}${ck('pt_enabled', 'Professional tax')}<div style="width:200px">${f('tds_monthly', 'Monthly TDS (₹)', 'number', 'min="0"')}</div></div>`;
};
const salaryFields = (s = {}) => `<div class="grid g4">${['basic:Basic', 'hra:HRA', 'special:Special allowance', 'other_allow:Other allowance'].map((x) => { const [k, l] = x.split(':'); return `<div class="field"><label>${l} (₹/month)</label><input type="number" min="0" step="1" name="${k}" value="${esc(s[k] ?? '')}" ${k === 'basic' ? 'required' : ''}></div>`; }).join('')}</div><div class="hint" id="gross-hint"></div>`;
function bindGross(m) {
  const upd = () => { const g = ['basic', 'hra', 'special', 'other_allow'].reduce((a, k) => a + Number($(`[name=${k}]`, m)?.value || 0), 0); const b = Number($('[name=basic]', m).value || 0); $('#gross-hint', m).textContent = `Gross: ${inr(g)} / month · Basic is ${g ? Math.round((b / g) * 100) : 0}% of gross${g && b / g < 0.5 ? ' — under the labour codes, PF wages will be raised to 50% of gross' : ''}`; };
  $$('[name=basic],[name=hra],[name=special],[name=other_allow]', m).forEach((i) => (i.oninput = upd)); upd();
}

const HR_PAGES = {
  async ''(el) {
    const d = await GET('/api/admin/dashboard');
    const stat = (k, v, s, href) => `<a class="stat" href="${href}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></a>`;
    el.innerHTML = `${header('Dashboard', fmtDate(d.date), '<a class="btn" href="#/attendance?view=import">Import biometric data</a><a class="btn primary" href="#/employees?new=1">Add employee</a>')}
      ${!d.last_import ? '<div class="note warn">No biometric attendance imported yet. Go to Attendance → Import.</div>' : d.last_import < d.date ? `<div class="note">Latest biometric data is for ${fmtDate(d.last_import)}.</div>` : ''}
      <div class="grid g4" style="margin-bottom:16px">${stat('Employees', d.headcount, `${d.on_notice} on notice`, '#/employees')}${stat('Punched in today', d.present, `${d.on_leave} on leave`, '#/attendance')}${stat('Pending leave requests', d.pending_leaves, 'Needs your decision', '#/leave-requests?status=pending')}${stat('Pending breaks / resignations', `${d.pending_breaks} / ${d.pending_resignations}`, 'Needs your decision', d.pending_resignations ? '#/resignations' : '#/break-requests?status=pending')}</div>
      <div class="card"><h2>Today's attendance</h2>${table(['Employee', 'Department', 'Status', 'Login', 'Logout', 'Hours'], d.today.map((r) => `<tr class="click" onclick="location.hash='#/employees/${r.id}?tab=attendance'"><td><b>${esc(r.name)}</b> <span class="muted">${esc(r.emp_code)}</span></td><td>${esc(r.department || '')}</td><td>${r.status ? pill(r.status, r.label) : ''}${r.late ? ' ' + pill('warn', 'Late') : ''}</td><td>${t12(r.first_in)}</td><td>${t12(r.last_out)}</td><td>${hm(r.minutes)}</td></tr>`), 'No employees yet — add your first employee')}</div>`;
  },

  async employees(el, { parts, q }) {
    if (parts[1]) return HR_EMPLOYEE(el, Number(parts[1]), q);
    const rows = await GET('/api/admin/employees');
    el.innerHTML = `${header('Employees', `${rows.filter((r) => r.status !== 'relieved').length} current · ${rows.filter((r) => r.status === 'relieved').length} relieved`, '<button class="btn primary" id="add">Add employee</button>')}
      <div class="card"><input id="search" placeholder="Search by name, code, department…" style="max-width:320px;margin-bottom:12px">
      ${table(['Code', 'Name', 'Designation', 'Department', 'Joined', '#Gross / month', 'Status', 'Login'], rows.map((r) => `<tr class="click" data-href="#/employees/${r.id}" data-s="${esc((r.name + ' ' + r.emp_code + ' ' + (r.department || '') + ' ' + (r.designation || '')).toLowerCase())}"><td>${esc(r.emp_code)}</td><td><b>${esc(r.name)}</b><div class="muted">${esc(r.email)}</div></td><td>${esc(r.designation || '')}</td><td>${esc(r.department || '')}</td><td>${fmtDate(r.doj)}</td><td class="num">${inr(r.gross)}</td><td>${pill(r.status)}</td><td>${r.login_active ? pill('ok', 'Enabled') : pill('bad', 'Disabled')}</td></tr>`), 'No employees yet')}</div>`;
    $$('tr[data-href]', el).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
    $('#search').oninput = (e) => { const v = e.target.value.toLowerCase(); $$('tr[data-s]', el).forEach((tr) => (tr.style.display = tr.dataset.s.includes(v) ? '' : 'none')); };
    const open = () => {
      const m = modal(`<h2>Add employee</h2><form id="f">${empForm()}<h3>Monthly salary</h3>${salaryFields()}
        <div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Create employee & login</button></div></form>`, { wide: true });
      bindGross(m);
      onSubmit($('#f', m), async (d) => { const r = await POST('/api/admin/employees', d); credentialsModal('Employee created', r); });
    };
    $('#add').onclick = open;
    if (q.new) open();
  },

  async attendance(el, { q }) {
    const view = q.view || 'day';
    const base = '#/attendance?view=';
    if (view === 'import') return attendanceImport(el, tabs([['day', 'Daily'], ['month', 'Monthly register'], ['import', 'Import biometric']], view, base));
    if (view === 'month') {
      const month = q.month || thisMonth();
      const d = await GET(`/api/admin/attendance/month?month=${month}`);
      const days = d.rows[0]?.days || [];
      el.innerHTML = `${header('Attendance', 'Monthly register', monthPicker(month, '#/attendance?view=month&'))}${tabs([['day', 'Daily'], ['month', 'Monthly register'], ['import', 'Import biometric']], view, base)}
        <div class="card tbl-wrap"><table class="grid-month"><thead><tr><th>Employee</th>${days.map((x) => `<th>${Number(x.date.slice(8))}<br><span class="muted">${DOW[new Date(x.date + 'T00:00').getDay()][0]}</span></th>`).join('')}<th>P</th><th>A</th><th>L</th><th>LOP</th></tr></thead>
        <tbody>${d.rows.map((r) => `<tr><td><a href="#/employees/${r.id}?tab=attendance&month=${month}">${esc(r.name)}</a></td>${r.days.map((x) => `<td class="c-${esc(x.status)}" title="${esc(x.first_in ? t12(x.first_in) + ' – ' + t12(x.last_out) : '')}">${esc(x.status === 'NA' ? '' : x.status)}${x.late ? '*' : ''}</td>`).join('')}<td>${r.summary.present}</td><td>${r.summary.absent}</td><td>${r.summary.leave}</td><td><b>${r.summary.lop}</b></td></tr>`).join('') || `<tr><td class="empty">No employees</td></tr>`}</tbody></table>
        <p class="hint">P present · A absent · HD half day · MP missing punch · L leave · H holiday · WO weekly off · * late</p></div>`;
      return;
    }
    const date = q.date || todayStr();
    const d = await GET(`/api/admin/attendance/day?date=${date}`);
    el.innerHTML = `${header('Attendance', 'Daily login and logout times', `<input type="date" value="${date}" style="width:170px" onchange="location.hash='#/attendance?view=day&date='+this.value">`)}${tabs([['day', 'Daily'], ['month', 'Monthly register'], ['import', 'Import biometric']], view, base)}
      <div class="card">${table(['Employee', 'Status', 'Login', 'Logout', 'Hours', 'All punches', ''], d.rows.map((r) => `<tr><td><a href="#/employees/${r.id}?tab=attendance"><b>${esc(r.name)}</b></a> <span class="muted">${esc(r.emp_code)}</span></td><td>${r.status ? pill(r.status, r.label) : ''}${r.late ? ' ' + pill('warn', 'Late') : ''}</td><td>${t12(r.first_in)}</td><td>${t12(r.last_out)}</td><td>${hm(r.minutes)}</td><td class="muted">${esc(r.punches.join(', '))}${r.source === 'manual' ? ' (edited)' : ''}</td><td><button class="btn sm" data-edit="${date}" data-emp="${r.id}" data-name="${esc(r.name)}" data-in="${r.first_in || ''}" data-out="${r.last_out || ''}">Edit</button></td></tr>`))}</div>`;
    bindAttendanceEdit(el);
  },

  async 'leave-requests'(el, { q }) {
    const status = q.status || 'pending';
    const rows = await GET(`/api/admin/leaves${status === 'all' ? '' : '?status=' + status}`);
    el.innerHTML = `${header('Leave requests', '', `<button class="btn" id="alloc">Credit annual leave</button>`)}${tabs([['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']], status, '#/leave-requests?status=')}
      <div class="card">${table(['Employee', 'Type', 'Dates', '#Days', 'Reason', 'Status', ''], leaveRequestRows(rows, true), 'No requests')}</div>`;
    bindLeaveDecisions(el);
    $('#alloc').onclick = () => {
      const y = new Date().getFullYear();
      const m = modal(`<h2>Credit annual leave</h2><p>Adds each leave type's annual quota to every current employee's ledger (prorated for people who joined during the year). Safe to run again — nobody is credited twice for the same year.</p>
        <form id="f"><div class="field"><label>Year</label><input type="number" name="year" value="${y}" style="max-width:140px"></div><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Credit leave</button></div></form>`);
      onSubmit($('#f', m), async (d) => { const r = await POST('/api/admin/leaves/allocate', d); closeModal(); toast(`${r.credits} credit entries added`); render(); });
    };
  },

  async 'break-requests'(el, { q }) {
    const status = q.status || 'pending';
    const rows = await GET(`/api/admin/breaks${status === 'all' ? '' : '?status=' + status}`);
    el.innerHTML = `${header('Break requests')}${tabs([['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']], status, '#/break-requests?status=')}
      <div class="card">${table(['Employee', 'Date', 'Time', '#Minutes', 'Reason', 'Status', ''], rows.map((r) => `<tr><td><a href="#/employees/${r.employee_id}">${esc(r.emp_name)}</a><div class="muted">${esc(r.emp_code)}</div></td><td>${fmtDate(r.date)}</td><td>${t12(r.start_time)} – ${t12(r.end_time)}</td><td class="num">${r.minutes}</td><td class="wrap">${esc(r.reason)}</td><td>${pill(r.status)}</td>
        <td>${r.status === 'pending' ? `<button class="btn sm ok" data-b="${r.id}" data-a="approve">Approve</button> <button class="btn sm danger" data-b="${r.id}" data-a="reject">Reject</button>` : ''}</td></tr>`), 'No requests')}</div>`;
    $$('[data-b]', el).forEach((b) => (b.onclick = async () => { try { await POST(`/api/admin/breaks/${b.dataset.b}/decide`, { action: b.dataset.a }); toast('Done'); render(); } catch (e) { toast(e.message, true); } }));
  },

  async resignations(el) {
    const rows = await GET('/api/admin/resignations');
    el.innerHTML = `${header('Resignations & notice period')}
      <div class="card">${table(['Employee', 'Submitted', 'Reason', 'Notice', 'Notice ends', 'Requested last day', 'Status', 'Last working day', ''], rows.map((r) => `<tr><td><a href="#/employees/${r.employee_id}?tab=notice">${esc(r.emp_name)}</a><div class="muted">${esc(r.emp_code)}</div></td><td>${fmtDate(r.submitted_on)}</td><td class="wrap">${esc(r.reason)}</td><td>${r.notice_days} days</td><td>${fmtDate(r.notice_end)}</td><td>${fmtDate(r.requested_last_day)}</td><td>${pill(r.status)}</td><td>${fmtDate(r.approved_last_day)}</td>
        <td>${r.status === 'pending' ? `<button class="btn sm ok" data-r="${r.id}" data-a="accept" data-end="${r.notice_end}" data-req="${r.requested_last_day || ''}">Accept</button> <button class="btn sm danger" data-r="${r.id}" data-a="reject">Reject</button>` : ''}</td></tr>`), 'No resignations')}</div>`;
    $$('[data-r]', el).forEach((b) => (b.onclick = () => {
      const accept = b.dataset.a === 'accept';
      const m = modal(`<h2>${accept ? 'Accept' : 'Reject'} resignation</h2><form id="f">${accept ? `<div class="field"><label>Last working day</label><input type="date" name="approved_last_day" value="${b.dataset.end}" required><div class="hint">Notice period ends ${fmtDate(b.dataset.end)}${b.dataset.req ? `; employee asked for ${fmtDate(b.dataset.req)}` : ''}. Pick an earlier date to waive or buy out part of the notice.</div></div>` : ''}
        <div class="field"><label>Note (optional)</label><textarea name="note"></textarea></div><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">${accept ? 'Accept' : 'Reject'}</button></div></form>`);
      onSubmit($('#f', m), async (d) => { await POST(`/api/admin/resignations/${b.dataset.r}/decide`, { action: b.dataset.a, ...d }); closeModal(); toast('Done'); render(); });
    }));
  },

  async payroll(el, { q }) {
    const month = q.month || shiftMonth(thisMonth(), -1);
    const d = await GET(`/api/admin/payroll?month=${month}`);
    const done = d.rows.filter((r) => r.payslip);
    const todo = d.rows.filter((r) => !r.payslip);
    const totals = done.reduce((a, r) => { a.gross += r.payslip.gross; a.net += r.payslip.net_pay; a.pf += r.payslip.pf_employee + r.payslip.pf_employer_epf + r.payslip.pf_employer_eps; return a; }, { gross: 0, net: 0, pf: 0 });
    el.innerHTML = `${header('Run payroll', fmtMonth(month), monthPicker(month, '#/payroll?'))}
      ${todo.length ? `<div class="card"><h2>To process (${todo.length})</h2><p class="muted" style="margin-top:-6px">Loss-of-pay days are suggested from biometric attendance and unpaid leave. Change any figure, then generate.</p>
      ${table(['', 'Employee', '#Paid days', 'LOP days', 'Incentive (₹)', 'Other deduction (₹)', 'TDS (₹)', '#Gross', '#Deductions', '#Net pay', 'Notes'], todo.map((r) => {
      const p = r.preview; return `<tr data-emp="${r.employee.id}"><td><input type="checkbox" class="sel" checked></td><td><b>${esc(r.employee.name)}</b><div class="muted">${esc(r.employee.emp_code)}</div></td>
        <td class="num pd">${p.paid_days}</td><td><input class="in" name="lop_days" type="number" step="0.5" min="0" value="${p.lop_days}" style="width:80px"></td><td><input class="in" name="other_earnings" type="number" min="0" value="0" style="width:100px"></td><td><input class="in" name="other_deductions" type="number" min="0" value="0" style="width:100px"></td><td><input class="in" name="tds" type="number" min="0" value="${p.tds}" style="width:90px"></td>
        <td class="num g">${inr(p.gross)}</td><td class="num dd">${inr(p.total_deductions)}</td><td class="num n"><b>${inr(p.net_pay)}</b></td><td class="wrap muted" style="font-size:12px">${esc(p.warnings.join(' '))}</td></tr>`;
    }))}
      <div class="row" style="margin-top:12px"><button class="btn primary" id="gen">Generate payslips for selected</button></div></div>` : ''}
      <div class="card"><div class="row" style="justify-content:space-between"><h2>Processed (${done.length})</h2>${done.length ? `<div class="row"><span class="muted">Gross ${inr(totals.gross)} · Net ${inr(totals.net)} · PF total ${inr(totals.pf)}</span><button class="btn" id="paid">Mark selected as paid</button></div>` : ''}</div>
      ${table(['', 'Employee', '#Paid days', '#LOP', '#Gross', '#PF', '#PT', '#TDS', '#Net pay', 'Status', ''], done.map((r) => {
      const p = r.payslip; return `<tr><td>${p.status !== 'paid' ? `<input type="checkbox" class="psel" value="${p.id}" checked>` : ''}</td><td><b>${esc(r.employee.name)}</b><div class="muted">${esc(r.employee.emp_code)}</div></td><td class="num">${p.paid_days}</td><td class="num">${p.lop_days}</td><td class="num">${inr(p.gross)}</td><td class="num">${inr(p.pf_employee)}</td><td class="num">${inr(p.pt)}</td><td class="num">${inr(p.tds)}</td><td class="num"><b>${inr(p.net_pay)}</b></td>
        <td>${pill(p.status, p.status === 'paid' ? 'Paid' : 'Processed')}${p.paid_on ? `<div class="muted">${fmtDate(p.paid_on)}</div>` : ''}</td><td><a class="btn sm" href="#/payslip/${p.id}">View</a> ${p.status !== 'paid' ? `<button class="btn sm danger" data-del="${p.id}">Redo</button>` : ''}</td></tr>`;
    }), 'No payslips generated for this month yet')}</div>`;

    // live recalculation of preview rows
    $$('tr[data-emp]', el).forEach((tr) => {
      let timer;
      $$('.in', tr).forEach((inp) => (inp.oninput = () => {
        clearTimeout(timer); timer = setTimeout(async () => {
          const body = { month, employee_id: tr.dataset.emp }; $$('.in', tr).forEach((i) => (body[i.name] = i.value === '' ? undefined : Number(i.value)));
          try { const p = await POST('/api/admin/payroll/preview', body); $('.pd', tr).textContent = p.paid_days; $('.g', tr).textContent = inr(p.gross); $('.dd', tr).textContent = inr(p.total_deductions); $('.n', tr).innerHTML = `<b>${inr(p.net_pay)}</b>`; } catch (e) { toast(e.message, true); }
        }, 350);
      }));
    });
    $('#gen')?.addEventListener('click', async () => {
      const items = $$('tr[data-emp]', el).filter((tr) => $('.sel', tr).checked).map((tr) => { const o = { employee_id: tr.dataset.emp }; $$('.in', tr).forEach((i) => (o[i.name] = i.value)); return o; });
      if (!items.length) return toast('Select at least one employee', true);
      try { const r = await POST('/api/admin/payroll/generate', { month, items }); toast(`${r.generated} payslip(s) generated`); render(); } catch (e) { toast(e.message, true); }
    });
    $('#paid')?.addEventListener('click', () => {
      const ids = $$('.psel', el).filter((c) => c.checked).map((c) => c.value);
      if (!ids.length) return toast('Select payslips to mark as paid', true);
      const m = modal(`<h2>Mark ${ids.length} payslip(s) as paid</h2><form id="f"><div class="field"><label>Paid on</label><input type="date" name="paid_on" value="${todayStr()}" required></div><div class="field"><label>Payment reference (UTR / batch no.)</label><input name="payment_ref"></div><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Mark paid</button></div></form>`);
      onSubmit($('#f', m), async (d) => { await POST('/api/admin/payroll/mark-paid', { ids, ...d }); closeModal(); toast('Marked as paid'); render(); });
    });
    $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmModal('Delete this payslip so you can recalculate it?', 'Delete')) { await api('DELETE', `/api/admin/payslips/${b.dataset.del}`).catch((e) => toast(e.message, true)); render(); } }));
  },

  async settings(el, { q }) {
    const tab = q.tab || 'company';
    const d = await GET('/api/admin/settings');
    const s = d.settings;
    const t = tabs([['company', 'Company & attendance'], ['payroll', 'Payroll rules'], ['holidays', 'Holidays'], ['leave', 'Leave types'], ['users', 'HR users & backup']], tab, '#/settings?tab=');
    const f = (k, label, type = 'text', hint = '') => `<div class="field"><label>${label}</label><input name="${k}" type="${type}" value="${esc(s[k])}" step="any">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    let body = '';
    if (tab === 'company') {
      body = `<form id="sf" class="card"><div class="grid g2">${f('company_name', 'Company name')}<div class="field"><label>Company address (shown on payslips)</label><textarea name="company_address">${esc(s.company_address)}</textarea></div></div>
        <h3>Working days</h3><div class="note info"><b>RIOT Ecommerce office schedule</b><br>Monday–Friday: Working · Sunday: Weekly off · 1st, 3rd and 5th Saturday: Working · 2nd and 4th Saturday: Weekly off. This company policy is applied automatically to attendance, leave-day and payroll attendance calculations.</div>
        <div class="grid g3">${f('shift_start', 'Shift start', 'time')}${f('grace_minutes', 'Late grace (minutes)', 'number')}${f('full_day_hours', 'Hours for a full day', 'number', 'First login to last logout')}${f('half_day_hours', 'Hours for a half day', 'number', 'Less than this = absent')}${f('default_notice_days', 'Default notice period (days)', 'number')}</div>
        <button class="btn primary" type="submit">Save</button></form>`;
    } else if (tab === 'payroll') {
      body = `<form id="sf" class="card"><div class="note">Defaults reflect rules as of November 2026: EPF wage ceiling ₹25,000 (from 17 Sep 2026), Telangana professional tax, and the labour-code rule that PF wages are at least 50% of gross. Confirm with your CA before your first payroll.</div>
        <h3>Provident fund</h3><div class="grid g3">${f('pf_ceiling', 'PF/EPS wage ceiling (₹)', 'number')}${f('pf_rate_employee', 'Employee PF %', 'number')}${f('pf_rate_employer', 'Employer PF % (EPF + EPS)', 'number')}${f('eps_rate', 'EPS % (part of employer share)', 'number')}</div>
        <label class="check field"><input type="checkbox" name="pf_restrict_to_ceiling" ${s.pf_restrict_to_ceiling === '1' ? 'checked' : ''}> Contribute only up to the wage ceiling</label>
        <label class="check field"><input type="checkbox" name="pf_apply_50pct_rule" ${s.pf_apply_50pct_rule === '1' ? 'checked' : ''}> Apply the 50% wages rule (if basic is below half of gross, PF is calculated on half of gross)</label>
        <h3>ESI</h3><div class="grid g3">${f('esi_ceiling', 'ESI gross ceiling (₹)', 'number')}${f('esi_rate_employee', 'Employee ESI %', 'number')}${f('esi_rate_employer', 'Employer ESI %', 'number')}</div>
        <h3>Professional tax</h3>${f('pt_slabs', 'Slabs on monthly gross', 'text', 'Format "limit:tax" separated by commas, * means above. Telangana: 15000:0,20000:150,*:200')}
        <button class="btn primary" type="submit">Save</button></form>`;
    } else if (tab === 'holidays') {
      body = `<div class="card"><form id="hf" class="row" style="margin-bottom:14px"><input type="date" name="date" required style="width:170px"><input name="name" placeholder="Holiday name" required class="grow" style="max-width:300px"><button class="btn primary" type="submit">Add holiday</button></form>
        ${table(['Date', 'Day', 'Holiday', ''], d.holidays.map((h) => `<tr><td>${fmtDate(h.date)}</td><td>${DOW[new Date(h.date + 'T00:00').getDay()]}</td><td>${esc(h.name)}</td><td><button class="btn sm danger" data-h="${h.id}">Remove</button></td></tr>`), 'No holidays added')}</div>`;
    } else if (tab === 'leave') {
      body = `<div class="card"><div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn primary" data-lt="">Add leave type</button></div>
        ${table(['Code', 'Name', '#Annual quota', 'Paid', 'Active', ''], d.leave_types.map((l) => `<tr><td><b>${esc(l.code)}</b></td><td>${esc(l.name)}</td><td class="num">${l.annual_quota}</td><td>${l.paid ? 'Yes' : 'No (LOP)'}</td><td>${l.active ? 'Yes' : 'No'}</td><td><button class="btn sm" data-lt='${esc(JSON.stringify(l))}'>Edit</button></td></tr>`))}
        <p class="hint">Annual quotas are credited with "Credit annual leave" on the Leave requests page.</p></div>`;
    } else {
      const admins = await GET('/api/admin/admins');
      body = `<div class="card"><div class="row" style="justify-content:space-between"><h2>HR users</h2><button class="btn primary" id="addAdmin">Add HR user</button></div>
        ${table(['Name', 'Email', 'Status'], admins.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.email)}</td><td>${a.active ? pill('ok', 'Active') : pill('bad', 'Disabled')}</td></tr>`))}<p class="hint">HR users can see every employee's data.</p></div>
        <div class="card"><h2>Backup</h2><p>Download a full copy of the database. Keep a backup at least weekly.</p><a class="btn" href="/api/admin/backup">Download backup</a></div>${changePwCard()}`;
    }
    el.innerHTML = header('Settings') + t + body;
    if ($('#sf')) onSubmit($('#sf'), async (data, form) => {
      for (const k of ['pf_restrict_to_ceiling', 'pf_apply_50pct_rule']) if (k in data) data[k] = data[k] ? '1' : '0';
      await api('PUT', '/api/admin/settings', data); toast('Settings saved'); state.me = null; render();
    });
    if ($('#hf')) onSubmit($('#hf'), async (data) => { await POST('/api/admin/holidays', data); render(); });
    $$('[data-h]', el).forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/admin/holidays/${b.dataset.h}`); render(); }));
    $$('[data-lt]', el).forEach((b) => (b.onclick = () => {
      const l = b.dataset.lt ? JSON.parse(b.dataset.lt) : { paid: 1, active: 1 };
      const m = modal(`<h2>${l.id ? 'Edit' : 'Add'} leave type</h2><form id="f"><div class="grid g2"><div class="field"><label>Code</label><input name="code" value="${esc(l.code || '')}" required maxlength="10"></div><div class="field"><label>Name</label><input name="name" value="${esc(l.name || '')}" required></div></div>
        <div class="field"><label>Annual quota (days)</label><input type="number" step="0.5" min="0" name="annual_quota" value="${l.annual_quota ?? 0}"></div><label class="check field"><input type="checkbox" name="paid" ${l.paid ? 'checked' : ''}> Paid leave (unticked = loss of pay)</label><label class="check field"><input type="checkbox" name="active" ${l.active ? 'checked' : ''}> Active</label>
        <div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
      onSubmit($('#f', m), async (data) => { await POST('/api/admin/leave-types', { ...data, id: l.id }); closeModal(); render(); });
    }));
    if ($('#addAdmin')) $('#addAdmin').onclick = () => {
      const m = modal(`<h2>Add HR user</h2><form id="f"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Create</button></div></form>`);
      onSubmit($('#f', m), async (data) => { const r = await POST('/api/admin/admins', data); credentialsModal('HR user created', r); });
    };
    if ($('#pw')) bindChangePw();
  },

  async payslip(el, { parts }) { await payslipView(el, `/api/admin/payslips/${parts[1]}`, 'javascript:history.back()'); },
};

function bindAttendanceEdit(el, empId, empName) {
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => {
    const id = b.dataset.emp || empId, name = b.dataset.name || empName;
    const m = modal(`<h2>Correct attendance</h2><p class="muted">${esc(name)} · ${fmtDate(b.dataset.edit)}</p><form id="f">
      <div class="grid g2"><div class="field"><label>Login time</label><input type="time" name="first_in" value="${b.dataset.in}"></div><div class="field"><label>Logout time</label><input type="time" name="last_out" value="${b.dataset.out}"></div></div>
      <div class="field"><label>Reason for correction</label><input name="note" placeholder="e.g. forgot to punch out"></div><div class="hint">Clear both times to remove the record for this day.</div>
      <div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    onSubmit($('#f', m), async (d) => { await api('PUT', '/api/admin/attendance', { employee_id: id, date: b.dataset.edit, ...d }); closeModal(); toast('Attendance updated'); render(); });
  }));
}

async function HR_EMPLOYEE(el, id, q) {
  const d = await GET(`/api/admin/employees/${id}`);
  const p = d.profile;
  const tab = q.tab || 'overview';
  const base = `#/employees/${id}?tab=`;
  const kv = (k, v) => `<div>${k}</div><div>${esc(v || '—')}</div>`;
  let body = '';
  if (tab === 'overview') {
    body = `<div class="grid g2"><div class="card"><h2>Job & personal</h2><div class="kv">${kv('Employee code', p.emp_code)}${kv('Email (login)', p.email)}${kv('Phone', p.phone)}${kv('Designation', p.designation)}${kv('Department', p.department)}${kv('Date of joining', fmtDate(p.doj))}${kv('Date of birth', fmtDate(p.dob))}${kv('Notice period', p.notice_days + ' days')}${kv('Login', d.login?.active ? (d.login.must_change_pw ? 'Enabled · temporary password not yet changed' : 'Enabled') : 'Disabled')}</div></div>
      <div class="card"><h2>Statutory & bank</h2><div class="kv">${kv('PAN', p.pan)}${kv('UAN', p.uan)}${kv('ESIC no.', p.esic_no)}${kv('Bank', p.bank_name)}${kv('Account', p.bank_account)}${kv('IFSC', p.ifsc)}${kv('PF', p.pf_enabled ? 'Yes' : 'No')}${kv('ESI', p.esi_enabled ? 'Yes' : 'No')}${kv('Professional tax', p.pt_enabled ? 'Yes' : 'No')}${kv('Monthly TDS', inr(p.tds_monthly))}</div></div></div>
      <h2>Leave balance</h2>${leaveBalanceCards(d.balances)}`;
  } else if (tab === 'attendance') {
    const month = q.month || thisMonth();
    const a = await GET(`/api/admin/attendance/employee/${id}?month=${month}`);
    body = `<div class="row" style="justify-content:flex-end;margin-bottom:12px">${monthPicker(month, `${base}attendance&`)}</div>${attendanceSummary(a.summary)}<div class="card">${attendanceCalendar(a.days)}</div><div class="card">${attendanceList(a.days, true)}</div>`;
  } else if (tab === 'leaves') {
    body = `${leaveBalanceCards(d.balances)}<div class="row" style="justify-content:flex-end;margin-bottom:12px"><button class="btn" id="adj">Adjust balance</button></div>
      <div class="card"><h2>Leave ledger</h2>${leaveLedgerTable(d.leave_ledger)}</div><div class="card"><h2>Leave requests</h2>${table(['Type', 'Dates', '#Days', 'Reason', 'Status', ''], leaveRequestRows(d.leave_requests.map((r) => ({ ...r, emp_name: p.name, emp_code: p.emp_code })), true).map((r) => r.replace(/^<tr><td>.*?<\/td>/s, '<tr>')), 'No requests')}</div>`;
  } else if (tab === 'salary') {
    body = `<div class="grid g2"><div>${salaryStructureCard(d.salary.current)}</div><div class="card"><h2>Totals</h2><div class="kv"><div>Total gross</div><div>${inr(d.salary.totals.gross)}</div><div>Total net</div><div>${inr(d.salary.totals.net)}</div><div>Paid</div><div>${inr(d.salary.totals.paid)}</div><div>Unpaid</div><div>${inr(d.salary.totals.unpaid)}</div></div><div style="margin-top:14px"><button class="btn primary" id="rev">Revise salary</button></div></div></div>
      <div class="card"><h2>Salary ledger</h2>${table(['Month', '#Paid days', '#LOP', '#Gross', '#Deductions', '#Net pay', 'Status', ''], payslipRows(d.salary.payslips, '#/payslip/', true), 'No payslips yet')}</div><div class="card"><h2>Salary revisions</h2>${revisionsTable(d.salary.revisions)}</div>`;
  } else if (tab === 'pf') {
    body = `<p class="muted">UAN: ${esc(p.uan || 'not added')}</p>${pfTable(d.pf)}`;
  } else if (tab === 'notice') {
    body = `${noticeCard(d.notice)}<div class="card"><h2>Resignations</h2>${table(['Submitted', 'Reason', 'Requested last day', 'Status', 'Last working day', 'Note'], d.resignations.map((r) => `<tr><td>${fmtDate(r.submitted_on)}</td><td class="wrap">${esc(r.reason)}</td><td>${fmtDate(r.requested_last_day)}</td><td>${pill(r.status)}</td><td>${fmtDate(r.approved_last_day)}</td><td class="wrap">${esc(r.hr_note)}</td></tr>`), 'No resignations')}${d.resignations.some((r) => r.status === 'pending') ? '<p><a class="btn" href="#/resignations">Review pending resignation</a></p>' : ''}</div>`;
  } else if (tab === 'breaks') {
    body = `<div class="card">${table(['Date', 'Time', '#Minutes', 'Reason', 'Status'], d.breaks.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${t12(r.start_time)} – ${t12(r.end_time)}</td><td class="num">${r.minutes}</td><td class="wrap">${esc(r.reason)}</td><td>${pill(r.status)}</td></tr>`), 'No break requests')}</div>`;
  }
  el.innerHTML = `${header(p.name, `${esc(p.emp_code)} · ${esc(p.designation || '')} ${pill(p.status)}`, `<a class="btn" href="#/employees">All employees</a><button class="btn" id="edit">Edit</button><button class="btn" id="more">More ▾</button>`)}
    ${tabs([['overview', 'Overview'], ['attendance', 'Attendance'], ['leaves', 'Leave ledger'], ['salary', 'Salary ledger'], ['pf', 'PF ledger'], ['notice', 'Notice & resignation'], ['breaks', 'Breaks']], tab, base)}${body}`;

  if (tab === 'attendance') bindAttendanceEdit(el, id, p.name);
  if (tab === 'leaves') {
    bindLeaveDecisions(el);
    $('#adj').onclick = () => {
      const m = modal(`<h2>Adjust leave balance</h2><form id="f"><div class="grid g2"><div class="field"><label>Leave type</label><select name="leave_type_id">${d.balances.map((b) => `<option value="${b.id}">${esc(b.name)} (balance ${b.balance})</option>`).join('')}</select></div><div class="field"><label>Days (use minus to deduct)</label><input type="number" step="0.5" name="days" required></div></div><div class="field"><label>Reason</label><input name="note" required placeholder="e.g. Opening balance carried forward"></div><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
      onSubmit($('#f', m), async (x) => { await POST('/api/admin/leaves/adjust', { employee_id: id, ...x }); closeModal(); toast('Ledger updated'); render(); });
    };
  }
  if (tab === 'salary') $('#rev').onclick = () => {
    const m = modal(`<h2>Revise salary</h2><form id="f"><div class="field"><label>Effective from</label><input type="date" name="effective_from" value="${todayStr().slice(0, 8)}01" required style="max-width:200px"></div>${salaryFields(d.salary.current)}<div class="field"><label>Note</label><input name="note" placeholder="e.g. Annual increment"></div><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Save revision</button></div></form>`, { wide: true });
    bindGross(m);
    onSubmit($('#f', m), async (x) => { await POST(`/api/admin/employees/${id}/salary`, x); closeModal(); toast('Salary revised'); render(); });
  };
  $('#edit').onclick = () => {
    const m = modal(`<h2>Edit ${esc(p.name)}</h2><form id="f">${empForm(p)}<p class="hint">To change salary use Salary ledger → Revise salary, so the history is kept.</p><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, { wide: true });
    onSubmit($('#f', m), async (x) => { await api('PUT', `/api/admin/employees/${id}`, x); closeModal(); toast('Saved'); render(); });
  };
  $('#more').onclick = () => {
    const m = modal(`<h2>Account actions</h2><div style="display:grid;gap:8px">
      <button class="btn" id="rp">Reset password</button>
      <button class="btn" id="lg">${d.login?.active ? 'Disable login' : 'Enable login'}</button>
      ${p.status !== 'relieved' ? '<button class="btn danger" id="rl">Mark as relieved</button>' : '<button class="btn" id="ra">Re-activate employee</button>'}</div>
      <div class="actions"><button class="btn" onclick="closeModal()">Close</button></div>`);
    $('#rp', m).onclick = async () => { const r = await POST(`/api/admin/employees/${id}/reset-password`); credentialsModal('Password reset', r); };
    $('#lg', m).onclick = async () => { await POST(`/api/admin/employees/${id}/login-active`, { active: !d.login?.active }); closeModal(); render(); };
    if ($('#rl', m)) $('#rl', m).onclick = () => {
      const mm = modal(`<h2>Mark ${esc(p.name)} as relieved</h2><form id="f"><div class="field"><label>Relieving date</label><input type="date" name="relieving_date" value="${p.relieving_date || todayStr()}" required></div><p class="hint">Their login stays enabled so they can download payslips. Disable it separately if needed.</p><div class="actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" type="submit">Mark relieved</button></div></form>`);
      onSubmit($('#f', mm), async (x) => { await POST(`/api/admin/employees/${id}/relieve`, x); closeModal(); render(); });
    };
    if ($('#ra', m)) $('#ra', m).onclick = async () => { await POST(`/api/admin/employees/${id}/reactivate`); closeModal(); render(); };
  };
}

// ---------------- biometric import ----------------
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function normDate(s, fmt) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const mo = MONTHS[m[2].toLowerCase()]; return mo ? `${y}-${pad(mo)}-${pad(m[1])}` : null; }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const [d, mo] = fmt === 'MDY' ? [m[2], m[1]] : [m[1], m[2]]; if (Number(mo) > 12 || Number(d) > 31) return null; return `${y}-${pad(mo)}-${pad(d)}`; }
  return null;
}
function normTime(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) { const pm = m[3].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${pad(h)}:${m[2]}`;
}
function splitDateTime(s, fmt) {
  s = String(s || '').trim();
  const tm = s.match(/\d{1,2}:\d{2}(?::\d{2})?\s*([AaPp][Mm])?/);
  return { date: normDate(tm ? s.slice(0, tm.index) : s, fmt), time: tm ? normTime(tm[0]) : null };
}

function attendanceImport(el, tabsHtml) {
  el.innerHTML = `${header('Attendance', 'Import the export file from your biometric (fingerprint) machine')}${tabsHtml}
    <div class="card"><h2>1. Choose file</h2><p class="muted">CSV or Excel export from eSSL, ZKTeco, Realtime, Mantra or similar. Employee codes in the file must match the employee codes in this portal (leading zeros are ignored).</p>
    <input type="file" id="file" accept=".csv,.txt,.xls,.xlsx" style="max-width:420px"></div><div id="step2"></div>`;
  let rows = [];
  $('#file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        if (!window.XLSX) throw new Error('Excel reader did not load. Save the file as CSV and try again.');
        const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm', defval: '' }).filter((r) => r.some((x) => String(x).trim()));
      } else rows = parseCSV(await file.text());
      if (rows.length < 2) throw new Error('The file looks empty');
      mapping();
    } catch (err) { toast(err.message, true); }
  };
  function mapping() {
    // find header row = first row with 3+ non-empty cells
    const hIdx = Math.max(0, rows.findIndex((r) => r.filter((x) => String(x).trim()).length >= 2));
    const head = rows[hIdx].map((h, i) => String(h).trim() || `Column ${i + 1}`);
    const opts = (guess) => `<option value="">— not in file —</option>` + head.map((h, i) => `<option value="${i}" ${guess(h.toLowerCase()) ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const has = (...w) => (h) => w.some((x) => h.includes(x));
    $('#step2').innerHTML = `<div class="card"><h2>2. Match columns</h2>
      <div class="field"><label>File layout</label><select id="layout"><option value="punch">One row per punch (every fingerprint scan is a row)</option><option value="day">One row per day (with In and Out columns)</option></select></div>
      <div class="grid g3"><div class="field"><label>Employee code column</label><select id="c_code">${opts(has('code', 'emp', 'id', 'enroll', 'user', 'badge'))}</select></div>
      <div class="field"><label>Date column (or date + time)</label><select id="c_date">${opts(has('date', 'time', 'punch', 'log'))}</select></div>
      <div class="field"><label>Date format</label><select id="fmt"><option value="DMY">DD/MM/YYYY (India)</option><option value="MDY">MM/DD/YYYY</option></select><div class="hint">YYYY-MM-DD and 13-Nov-2026 are detected automatically.</div></div>
      <div class="field punch-only"><label>Time column (if separate from date)</label><select id="c_time">${opts((h) => h === 'time' || h.includes('punch time') || h.includes('log time'))}</select></div>
      <div class="field day-only" style="display:none"><label>In time column</label><select id="c_in">${opts(has('in'))}</select></div>
      <div class="field day-only" style="display:none"><label>Out time column</label><select id="c_out">${opts(has('out'))}</select></div></div>
      <label class="check field"><input type="checkbox" id="replace"> Replace existing punches for the days in this file (instead of merging)</label>
      <button class="btn" id="prev">Preview</button><div id="pv" style="margin-top:14px"></div></div>`;
    const lay = $('#layout');
    lay.onchange = () => { $$('.punch-only').forEach((x) => (x.style.display = lay.value === 'punch' ? '' : 'none')); $$('.day-only').forEach((x) => (x.style.display = lay.value === 'day' ? '' : 'none')); };
    const build = () => {
      const g = (id) => ($('#' + id).value === '' ? null : Number($('#' + id).value));
      const code = g('c_code'), dc = g('c_date'), tc = g('c_time'), ic = g('c_in'), oc = g('c_out'), fmt = $('#fmt').value;
      if (code === null || dc === null) throw new Error('Choose the employee code and date columns');
      const out = []; let bad = 0;
      for (const r of rows.slice(hIdx + 1)) {
        const c = String(r[code] ?? '').trim();
        if (!c) continue;
        if (lay.value === 'punch') {
          let { date, time } = splitDateTime(r[dc], fmt);
          if (tc !== null) time = normTime(r[tc]);
          if (date && time) out.push({ code: c, date, time }); else bad++;
        } else {
          const date = normDate(r[dc], fmt);
          const ti = ic !== null ? normTime(r[ic]) : null, to = oc !== null ? normTime(r[oc]) : null;
          if (!date) { bad++; continue; }
          if (ti) out.push({ code: c, date, time: ti });
          if (to) out.push({ code: c, date, time: to });
        }
      }
      return { out, bad };
    };
    $('#prev').onclick = () => {
      try {
        const { out, bad } = build();
        const codes = new Set(out.map((p) => p.code));
        const dates = out.map((p) => p.date).sort();
        $('#pv').innerHTML = `<div class="note ${out.length ? 'ok' : 'warn'}">${out.length} punches for ${codes.size} employee code(s)${dates.length ? `, ${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}` : ''}.${bad ? ` ${bad} row(s) could not be read and will be skipped.` : ''}</div>
          ${table(['Employee code', 'Date', 'Time'], out.slice(0, 8).map((p) => `<tr><td>${esc(p.code)}</td><td>${fmtDate(p.date)}</td><td>${t12(p.time)}</td></tr>`))}
          ${out.length ? '<button class="btn primary" id="go" style="margin-top:12px">Import now</button>' : ''}`;
        if ($('#go')) $('#go').onclick = async () => {
          $('#go').disabled = true;
          try {
            const r = await POST('/api/admin/attendance/import', { punches: out, replace: $('#replace').checked });
            $('#pv').innerHTML = `<div class="note ok">Imported. ${r.days_updated} employee-day records updated.</div>${r.unknown_count ? `<div class="note warn">${r.unknown_count} employee code(s) in the file don't match anyone in the portal: ${esc(r.unknown_codes.join(', '))}. Add those employees (or fix their codes) and import again.</div>` : ''}<a class="btn" href="#/attendance?view=month">View monthly register</a>`;
          } catch (err) { toast(err.message, true); $('#go').disabled = false; }
        };
      } catch (err) { toast(err.message, true); }
    };
  }
}

render();
