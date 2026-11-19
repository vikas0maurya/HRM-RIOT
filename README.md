# HR Portal

A self-hosted HR web app. HR sees every employee's data; each employee logs in and sees only their own.

**HR can:** add and edit employees, import biometric login/logout data, correct attendance, approve or reject leave, break and resignation requests, run monthly payroll, publish payslips, mark salaries as paid, and keep the leave, salary and PF ledgers.

**Employees can:** see their daily login/logout times, leave balance and leave ledger, salary ledger and payslips (print or save as PDF), PF ledger and notice period. They can apply for leave, request breaks, and submit or withdraw a resignation.

Built with Node.js, Express and SQLite. All data is kept in one file, `data/hrms.db`.

---

## 1. Run it on your computer (to try it out)

1. Install Node.js 20 or newer from https://nodejs.org
2. Unzip this folder, open a terminal inside it, and run:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:3000. The first screen creates the HR (admin) account.

## 2. Put it online so employees can log in

Pick a host that offers a **persistent disk**, so the database survives restarts.

**Option A: Railway (easiest, about $5/month)**
1. Push this folder to a private GitHub repository.
2. On railway.app, create a New Project, choose Deploy from GitHub, and pick the repo. Railway detects the Dockerfile.
3. Add a **Volume** mounted at `/data`.
4. Under Settings → Networking, generate a domain, or connect your own (for example hr.yourcompany.com).

**Option B: Render (about $7/month plus disk)**
Create a Web Service from the repo on the Starter plan. Add a Disk mounted at `/data` and set the environment variable `DATA_DIR=/data`. Render's free plan wipes the disk, so it is not suitable.

**Option C: Any VPS (Hostinger, DigitalOcean, AWS Lightsail; about ₹400–600/month)**
```
docker build -t hr-portal .
docker run -d --restart=always -p 3000:3000 -v /opt/hr-data:/data hr-portal
```
Put Nginx or Caddy in front for HTTPS. HTTPS is required for real use, because passwords travel over it.

Environment variables (all optional): `PORT` (default 3000), `DATA_DIR` (default `./data`), and `COOKIE_SECURE=1` to force secure cookies behind a proxy that doesn't forward the protocol.

## 3. First-time setup checklist

1. **Settings → Company & attendance:** company name and address, weekly offs (and 2nd/4th Saturdays if applicable), shift start, grace minutes, full-day and half-day hours.
2. **Settings → Payroll rules:** check the PF, ESI and professional-tax values with your CA (see the defaults below).
3. **Settings → Holidays:** add this year's holidays.
4. **Settings → Leave types:** set annual quotas. The defaults are CL 12, SL 6, EL 15, plus LOP.
5. **Employees → Add employee.** Use the **same employee code as on the biometric machine**. You get a temporary password to share, and the employee must change it at first login. The current year's leave is credited automatically, prorated by joining month.
6. **Opening leave balances:** open the employee → Leave ledger → Adjust balance.

## 4. Monthly routine

1. **Attendance → Import biometric.** Upload the CSV or Excel export from your machine (eSSL, ZKTeco, Realtime and similar). Match the columns once: employee code, date/time, or separate In/Out columns. Re-importing the same days merges punches safely.
2. Review the **Monthly register** and fix any wrong days (Edit → login/logout time + reason).
3. Clear pending **leave / break requests**.
4. **Run payroll** for the month. Loss-of-pay days are suggested from absences, short days and unpaid leave. Adjust LOP, incentive, other deductions or TDS, then click **Generate**.
5. After paying salaries, select the payslips and **Mark as paid** with the date and UTR. Employees see their payslip right away.
6. **Settings → HR users & backup → Download backup.** Do this at least weekly.

## How things are calculated

- **Attendance:** first punch = login, last punch = logout. Worked hours ≥ full-day hours = Present. ≥ half-day hours = Half day (½ LOP). Less = Absent. A single punch = Missing punch (counted present; correct it manually). Login after shift start + grace = Late.
- **Leave days** exclude weekly offs and holidays. Paid leave can't exceed the available balance. Approving leave debits the ledger, and revoking it posts a reversal.
- **Salary proration:** each component × (paid days ÷ calendar days in month). Paid days = days employed in the month − LOP.
- **PF:** 12% employee and 12% employer, on basic. Where basic is less than half of gross, PF wages are raised to 50% of gross (labour-code wage rule; can be switched off). Contributions are capped at the wage ceiling, **₹25,000 from 17 Sep 2026**. The employer share is split into EPS (8.33% of wages up to the ceiling) and EPF (the rest).
- **ESI:** 0.75% employee and 3.25% employer, when the monthly gross is ≤ ₹21,000 and ESI is ticked for the employee.
- **Professional tax (Telangana):** up to ₹15,000 → ₹0; ₹15,001–20,000 → ₹150; above ₹20,000 → ₹200.
- **TDS:** a fixed monthly amount set per employee, which you can override in each payroll run.
- **Notice period:** resignation date + notice days. HR can accept with an earlier last working day (waiver/buyout), and the shortfall is shown. On acceptance the employee's status becomes "notice". Use "Mark as relieved" after they leave. Their login stays active so they can download payslips, and you can disable it.

All rates are editable in Settings. They are defaults, not legal advice, so confirm them with your CA.

## Security

- Passwords are hashed (scrypt). Sessions use HttpOnly, SameSite=Strict cookies and expire after 7 days. Login is throttled after 10 failures.
- Every employee API route works only on the logged-in employee's own record. Employee IDs are never taken from the request, so one employee cannot open another's data.
- HR users see everything. Only give HR access to people who should.
