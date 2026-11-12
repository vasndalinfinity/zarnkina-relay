const crypto = require('crypto');

const ADMIN_HASH_SALT = 'zrk_admin_scrypt_2026_v2';
const ADMIN_PASSWORD_HASH = 'b309ffef96c8bf4fded1ed730d40f2dddc19a13a3c0c36fc77a1ad10d598d66594455cf5590737df8ec00e1e417ccc7372799f3b249fc44186cbde3da42121e1';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'zrk_admin_session';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyAdminSecret(candidate) {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) return false;
  if (process.env.ADMIN_SECRET) {
    return safeEqual(trimmed, String(process.env.ADMIN_SECRET).trim());
  }
  try {
    const derived = crypto.scryptSync(trimmed, ADMIN_HASH_SALT, 64);
    const expected = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function signAdminSession(ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({
    role: 'admin',
    exp: Date.now() + ttlMs,
    nonce: crypto.randomBytes(8).toString('hex')
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(sig, expectedSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed && parsed.role === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function isAdminRequest(req) {
  const headerSecret = req.headers['x-admin-secret'];
  if (headerSecret && verifyAdminSecret(headerSecret)) return true;

  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (verifyAdminSecret(token)) return true;
  }

  const cookies = parseCookies(req.headers['cookie']);
  return verifyAdminToken(cookies[COOKIE_NAME]);
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

// ---- Client session tokens -------------------------------------------------
// A bare `x-zarnkina-email` header is a claim, not proof, so the gateway issues
// a short-lived HMAC token from /api/client/verify and the client must present
// it on every chat request.
const CLIENT_TOKEN_SECRET =
  process.env.SESSION_SECRET ||
  process.env.VAULT_KEY ||
  crypto.randomBytes(32).toString('hex');

function signSessionToken(email, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const normalized = normalizeEmail(email);
  if (!normalized) return '';
  const payload = Buffer.from(
    JSON.stringify({ role: 'client', email: normalized, exp: Date.now() + ttlMs })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', CLIENT_TOKEN_SECRET).update(payload).digest('base64url');
  return `zk_sess_${payload}.${sig}`;
}

function verifySessionToken(token) {
  const raw = String(token || '').trim();
  if (!raw.startsWith('zk_sess_')) return null;
  const body = raw.slice('zk_sess_'.length);
  const parts = body.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', CLIENT_TOKEN_SECRET).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || parsed.role !== 'client') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
    return normalizeEmail(parsed.email) || null;
  } catch {
    return null;
  }
}

function generateApiKey() {
  const raw = 'zk_live_' + crypto.randomBytes(24).toString('base64url');
  const prefix = raw.slice(0, 14);
  const tail = raw.slice(-4);
  return {
    plain: raw,
    prefix,
    masked: `${prefix}...${tail}`,
    hash: sha256(raw)
  };
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

module.exports = {
  COOKIE_NAME,
  verifyAdminSecret,
  signAdminSession,
  isAdminRequest,
  sha256,
  generateApiKey,
  normalizeEmail,
  signSessionToken,
  verifySessionToken,
};
