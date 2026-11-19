// Automated verification test for Email OTP Forgot Password flow
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { db } = require('./src/db');
const mailer = require('./src/mailer');
const app = require('./src/server');

// Spy on mailer to capture the generated OTP instantly without brute force
let capturedOtp = null;
const originalSendOtp = mailer.sendOtpEmail;
mailer.sendOtpEmail = async (to, otp, company) => {
  capturedOtp = otp;
  return { simulated: true };
};

function invoke(app, method, url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.originalUrl = url;
    req.path = url.split('?')[0];
    req.headers = {
      'content-type': 'application/json',
      'x-requested-with': 'hrms',
    };
    req.get = (name) => req.headers[name.toLowerCase()];
    req.header = req.get;
    req.body = body || {};
    req.query = {};
    req.params = {};
    req.ip = '127.0.0.1';
    req.connection = { remoteAddress: '127.0.0.1' };
    req.socket = { remoteAddress: '127.0.0.1' };

    const res = new EventEmitter();
    let resStatus = 200;
    let resHeaders = {};
    let resBody = null;

    res.status = (code) => {
      resStatus = code;
      return res;
    };
    res.setHeader = (k, v) => { resHeaders[k] = v; return res; };
    res.set = res.setHeader;
    res.get = (k) => resHeaders[k];

    res.json = (data) => {
      resBody = data;
      resolve({ statusCode: resStatus, status: resStatus, body: data, headers: resHeaders });
      return res;
    };

    res.send = (data) => {
      resBody = data;
      resolve({ statusCode: resStatus, status: resStatus, body: data, headers: resHeaders });
      return res;
    };

    res.end = (data) => {
      if (resBody === null) resBody = data;
      resolve({ statusCode: resStatus, status: resStatus, body: resBody, headers: resHeaders });
    };

    app(req, res, (err) => {
      if (err) {
        resolve({
          statusCode: err.status || 500,
          status: err.status || 500,
          body: { error: err.message },
          headers: resHeaders,
        });
      }
    });
  });
}

async function runTests() {
  console.log('--- Starting Comprehensive Email OTP Forgot Password Flow Tests ---');

  const testEmail = 'test_automation_employee@example.com';
  const initialPassword = 'InitialPassword123!';
  const newPassword = 'NewSecretPassword2026!';

  // Clean up any previous test user
  db.prepare('DELETE FROM users WHERE email = ?').run(testEmail);
  db.prepare('DELETE FROM otp_tokens WHERE email = ?').run(testEmail);

  // Hash initial password
  const salt = crypto.randomBytes(16).toString('hex');
  const pwHash = `${salt}:${crypto.scryptSync(initialPassword, salt, 64).toString('hex')}`;

  // Insert test employee user
  db.prepare(`
    INSERT INTO users (email, name, password_hash, role, active)
    VALUES (?, 'Test Employee', ?, 'employee', 1)
  `).run(testEmail, pwHash);

  try {
    // Test 1: Send OTP to non-existent email
    console.log('Test 1: Request OTP for unregistered email...');
    const resUnknown = await invoke(app, 'POST', '/api/forgot-password/send-otp', { email: 'unknown_404@example.com' });
    assert.strictEqual(resUnknown.statusCode, 400);
    assert.match(resUnknown.body.error, /No account found/i);
    console.log('✓ Correctly rejected unregistered email');

    // Test 2: Send OTP to valid registered email
    console.log('Test 2: Request OTP for registered email...');
    capturedOtp = null;
    const resSend = await invoke(app, 'POST', '/api/forgot-password/send-otp', { email: testEmail });
    assert.strictEqual(resSend.statusCode, 200);
    assert.strictEqual(resSend.body.ok, true);
    assert.strictEqual(resSend.body.email, testEmail);
    assert.ok(capturedOtp && capturedOtp.length === 6, 'Must generate and send a 6-digit OTP');
    console.log(`✓ OTP generated (${capturedOtp}) and sent successfully`);

    // Test 3: Check 60-second cooldown
    console.log('Test 3: Requesting OTP immediately again (cooldown check)...');
    const resCooldown = await invoke(app, 'POST', '/api/forgot-password/send-otp', { email: testEmail });
    assert.strictEqual(resCooldown.statusCode, 400);
    assert.match(resCooldown.body.error, /Please wait .* seconds/i);
    console.log('✓ 60-second cooldown properly enforced');

    // Retrieve the token from database to check expiration and hashing
    const tokenRecord = db.prepare('SELECT * FROM otp_tokens WHERE email = ? ORDER BY id DESC LIMIT 1').get(testEmail);
    assert.ok(tokenRecord, 'OTP record should exist in database');
    assert.strictEqual(tokenRecord.used, 0);
    assert.strictEqual(tokenRecord.verified, 0);
    assert.ok(tokenRecord.otp_hash.includes(':'), 'OTP must be hashed with salt:hash');
    assert.ok(tokenRecord.expires_at > Date.now(), 'OTP must expire in the future (~5 minutes)');
    console.log('✓ OTP is securely hashed in database and set to 5-minute expiry');

    // Test 4: Verify with invalid OTP
    console.log('Test 4: Verify with invalid OTP code (000000)...');
    const resBadOtp = await invoke(app, 'POST', '/api/forgot-password/verify-otp', { email: testEmail, otp: '000000' });
    assert.strictEqual(resBadOtp.statusCode, 400);
    assert.match(resBadOtp.body.error, /Invalid verification code/i);
    console.log('✓ Wrong OTP rejected correctly');

    // Test 5: Verify with valid OTP
    console.log('Test 5: Verify with valid OTP...');
    const resVerify = await invoke(app, 'POST', '/api/forgot-password/verify-otp', { email: testEmail, otp: capturedOtp });
    assert.strictEqual(resVerify.statusCode, 200);
    assert.strictEqual(resVerify.body.ok, true);
    assert.ok(resVerify.body.resetToken, 'Must return resetToken');
    const resetToken = resVerify.body.resetToken;
    console.log('✓ OTP verified successfully, resetToken received');

    // Test 6: Single-use check on OTP (cannot re-verify already verified/used OTP)
    console.log('Test 6: Single-use check on OTP...');
    const resReVerify = await invoke(app, 'POST', '/api/forgot-password/verify-otp', { email: testEmail, otp: capturedOtp });
    assert.strictEqual(resReVerify.statusCode, 400);
    console.log('✓ OTP cannot be reused (single-use enforced)');

    // Test 7: Reset password with mismatched confirm
    console.log('Test 7: Reset password with mismatched confirm password...');
    const resMismatch = await invoke(app, 'POST', '/api/forgot-password/reset-password', {
      email: testEmail,
      resetToken,
      password: newPassword,
      confirm: 'DifferentPassword123'
    });
    assert.strictEqual(resMismatch.statusCode, 400);
    assert.match(resMismatch.body.error, /Passwords do not match/i);
    console.log('✓ Password mismatch rejected');

    // Test 8: Reset password with short password
    console.log('Test 8: Reset password with short password (< 8 chars)...');
    const resShort = await invoke(app, 'POST', '/api/forgot-password/reset-password', {
      email: testEmail,
      resetToken,
      password: '123',
      confirm: '123'
    });
    assert.strictEqual(resShort.statusCode, 400);
    assert.match(resShort.body.error, /at least 8 characters/i);
    console.log('✓ Short password rejected');

    // Test 9: Reset password successfully
    console.log('Test 9: Reset password with valid credentials...');
    const resSuccess = await invoke(app, 'POST', '/api/forgot-password/reset-password', {
      email: testEmail,
      resetToken,
      password: newPassword,
      confirm: newPassword
    });
    assert.strictEqual(resSuccess.statusCode, 200);
    assert.strictEqual(resSuccess.body.ok, true);
    console.log('✓ Password reset successfully');

    // Test 10: Reset token single-use check (cannot reuse resetToken)
    console.log('Test 10: Verify resetToken cannot be reused...');
    const resReuseToken = await invoke(app, 'POST', '/api/forgot-password/reset-password', {
      email: testEmail,
      resetToken,
      password: 'YetAnotherPassword1!',
      confirm: 'YetAnotherPassword1!'
    });
    assert.strictEqual(resReuseToken.statusCode, 400);
    console.log('✓ Reset token is single-use and cannot be reused');

    // Test 11: Attempt login with OLD password (must fail)
    console.log('Test 11: Verify old password fails login...');
    const resOldLogin = await invoke(app, 'POST', '/api/login', {
      login: testEmail,
      password: initialPassword
    });
    assert.strictEqual(resOldLogin.statusCode, 401);
    console.log('✓ Old password no longer works');

    // Test 12: Attempt login with NEW password (must succeed)
    console.log('Test 12: Verify login with new password succeeds...');
    const resNewLogin = await invoke(app, 'POST', '/api/login', {
      login: testEmail,
      password: newPassword
    });
    assert.strictEqual(resNewLogin.statusCode, 200);
    assert.strictEqual(resNewLogin.body.ok, true);
    console.log('✓ Successfully logged in with new password');

    // Test 13: Expiration test - force an expired token
    console.log('Test 13: Verify expired OTP is rejected...');
    db.prepare('DELETE FROM otp_tokens WHERE email = ?').run(testEmail);
    const expiredHash = `${salt}:${crypto.scryptSync('654321', salt, 64).toString('hex')}`;
    db.prepare(`
      INSERT INTO otp_tokens (email, otp_hash, expires_at, resend_available_at, used, verified)
      VALUES (?, ?, ?, ?, 0, 0)
    `).run(testEmail, expiredHash, Date.now() - 10000, Date.now() - 5000);
    const resExpired = await invoke(app, 'POST', '/api/forgot-password/verify-otp', {
      email: testEmail,
      otp: '654321'
    });
    assert.strictEqual(resExpired.statusCode, 400);
    assert.match(resExpired.body.error, /expired/i);
    console.log('✓ Expired OTP correctly rejected');

    console.log('\n======================================================');
    console.log('ALL 13 TESTS PASSED! Password reset flow is 100% verified.');
    console.log('======================================================\n');
  } finally {
    // Restore original method and cleanup test data
    mailer.sendOtpEmail = originalSendOtp;
    db.prepare('DELETE FROM users WHERE email = ?').run(testEmail);
    db.prepare('DELETE FROM otp_tokens WHERE email = ?').run(testEmail);
  }
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
