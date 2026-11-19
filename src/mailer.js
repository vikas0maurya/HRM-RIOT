// Email OTP mailer — uses nodemailer with SMTP credentials from .env
'use strict';

const nodemailer = require('nodemailer');

function isSmtpConfigured() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return false;
  if (pass === 'your-app-password' || user === 'your-email@gmail.com') return false;
  return true;
}

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: process.env.SMTP_IGNORE_TLS === 'true' ? false : true,
    },
  });
  return _transporter;
}

async function sendOtpEmail(to, otp, company) {
  const companyName = company || 'HR Portal';
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || `noreply@hrms.local`;

  if (!isSmtpConfigured()) {
    console.log(`\n======================================================`);
    console.log(`[EMAIL OTP] SMTP not configured in .env; simulated email:`);
    console.log(`To: ${to}`);
    console.log(`Company: ${companyName}`);
    console.log(`OTP Code: ${otp}`);
    console.log(`Valid for: 5 minutes`);
    console.log(`======================================================\n`);
    return { simulated: true };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from,
    to,
    subject: `${companyName} – Your Password Reset OTP: ${otp}`,
    text: [
      `Hi,`,
      ``,
      `Your verification code for password reset is: ${otp}`,
      ``,
      `This code is valid for 5 minutes and can only be used once.`,
      `If you did not request a password reset, please ignore this email.`,
      ``,
      `– ${companyName} HR Team`,
    ].join('\n'),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c2230;">
  <div style="max-width:500px;margin:32px auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="background:#2f5bea;padding:24px 28px;">
      <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">${companyName}</h1>
      <p style="margin:4px 0 0;color:#eaf0ff;font-size:13px;">HR &amp; Payroll Portal</p>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#1c2230;">Password Reset Verification</h2>
      <p style="margin:0 0 20px;color:#667085;font-size:14px;line-height:1.5;">
        We received a request to reset your password. Use the 6-digit verification code below to complete the reset:
      </p>
      <div style="text-align:center;margin:28px 0;">
        <div style="display:inline-block;background:#eaf0ff;border:2px dashed #2f5bea;border-radius:12px;padding:16px 36px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#2f5bea;font-family:monospace;">
            ${otp}
          </span>
        </div>
      </div>
      <div style="background:#fef3e6;border:1px solid #fedf89;border-radius:8px;padding:12px 14px;margin-bottom:20px;">
        <p style="margin:0;color:#b54708;font-size:13px;font-weight:500;">
          ⏱ <strong>Valid for 5 minutes only</strong> &bull; Single-use code.
        </p>
      </div>
      <p style="margin:0;color:#667085;font-size:13px;line-height:1.5;">
        If you did not make this request, you can safely ignore this email. Your existing password will remain active and unchanged.
      </p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e4e7ec;">
      <p style="margin:0;color:#94a3b8;font-size:12px;">
        &copy; ${new Date().getFullYear()} ${companyName}. Secure HR Access.
      </p>
    </div>
  </div>
</body>
</html>`,
  });

  return { simulated: false };
}

module.exports = { sendOtpEmail, isSmtpConfigured };
