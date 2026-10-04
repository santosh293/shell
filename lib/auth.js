// Stateless signed-cookie admin session.
const crypto = require('crypto');

const COOKIE = 'admin_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const secret = () => process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function checkCredentials(username, password) {
  const u = process.env.ADMIN_USERNAME || 'admin';
  const p = process.env.ADMIN_PASSWORD || 'admin123';
  return safeEqual(username, u) && safeEqual(password, p);
}

function issue(res) {
  const payload = `${Date.now() + MAX_AGE_MS}`;
  const token = `${payload}.${sign(payload)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}`);
}

function clear(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function isAuthed(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const [expires, sig] = token.split('.');
  return Boolean(sig) && safeEqual(sig, sign(expires)) && Number(expires) > Date.now();
}

function requireAdmin(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { checkCredentials, issue, clear, isAuthed, requireAdmin };
