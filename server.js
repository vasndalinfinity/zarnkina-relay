// Zarnkina Model Relay & Admin Control Plane
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const routes = require('./lib/routes');
const {
  COOKIE_NAME,
  verifyAdminSecret,
  signAdminSession,
  isAdminRequest,
  normalizeEmail,
  signSessionToken,
  verifySessionToken,
} = require('./lib/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;
const store = new Store();

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (kept alive):', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (kept alive):', reason);
});

// Upstream endpoints are not in this file. Anything downstream of auth is
// resolved from the host-only routing table (lib/routes.js -> data/routes.json).
const keyPointers = new Map();

function nextPointer(clusterId) {
  const current = keyPointers.get(clusterId) || 0;
  keyPointers.set(clusterId, current + 1);
  return current;
}

function getNextKeys(clusterId, maxCount = 6) {
  const keys = store.getActivePoolKeys(clusterId);
  if (!keys.length) return [];
  const count = Math.min(keys.length, maxCount);
  const start = nextPointer(clusterId) % keys.length;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(keys[(start + i) % keys.length]);
  }
  return out;
}

function getNextBackupKeys(poolName, maxCount = 4) {
  const keys = store.getBackupPoolKeys(poolName);
  if (!keys.length) return [];
  const count = Math.min(keys.length, maxCount);
  const start = keyPointers[poolName] || 0;
  keyPointers[poolName] = start + 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(keys[(start + i) % keys.length]);
  }
  return out;
}

const startTime = Date.now();
let totalTokens = 0;
let totalRequests = 0;

function getMetricsJson() {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const tps = uptimeSec > 0 ? (totalTokens / uptimeSec).toFixed(2) : '0.00';
  const models = store.listModels();
  const activeModels = models.filter((m) => m.status === 'active').length;
  return {
    name: 'Zarnkina Model Relay Gateway',
    status: 'healthy',
    uptime_seconds: uptimeSec,
    total_requests: totalRequests,
    active_edge_nodes: store.getTotalActivePoolKeys(),
    models_available: activeModels,
    models_total: models.length,
    estimated_tps: tps,
    version: '3.0.0',
  };
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ ok: false, error: 'Yetkisiz erisim. Lutfen admin girisi yapin.' });
  }
  next();
}

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health-json', (_req, res) => res.json(getMetricsJson()));
app.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    active_nodes: store.getTotalActivePoolKeys(),
    models: store.listModels().length,
    catalog_version: store.state.catalogVersion || 0,
    routes_ready: routes.ready(),
  })
);

app.get('/', (req, res) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.json(getMetricsJson());
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/remote', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'remote.html'));
});

// Desktop release / auto-update manifest
app.get('/api/public/release', (_req, res) => {
  res.json({ ok: true, ...store.getRelease() });
});

// Public model roster (sanitized: never leaks routeCluster/upstreamModel)
app.get('/api/public/models', (_req, res) => {
  res.json({
    ok: true,
    models: store.getPublicModels(),
  });
});

// ---- Remote Control Bridge Relay ----
const remoteHosts = new Map(); // hostSecret -> { pairCode, codeExpiresAt, running, label, browsers: Map<id, session>, queue: [], events: [] }
const remoteBrowsers = new Map(); // browserId -> hostSecret

function makePairCode() {
  return String(crypto.randomInt(100000, 999999));
}

function getRemoteHost(req) {
  const secret = String(req.headers['x-remote-secret'] || req.query.hostSecret || req.body?.hostSecret || '').trim();
  if (!secret) return null;
  const host = remoteHosts.get(secret);
  return host ? { secret, host } : null;
}

app.post('/api/remote/register', (req, res) => {
  const existing = String(req.body?.hostSecret || '').trim();
  const label = String(req.body?.label || 'Zarnkina PC').slice(0, 64);
  if (existing && remoteHosts.has(existing)) {
    const h = remoteHosts.get(existing);
    h.running = true;
    h.lastHeartbeat = Date.now();
    return res.json({
      ok: true,
      hostSecret: existing,
      running: h.running,
      code: h.codeExpiresAt > Date.now() ? h.pairCode : null,
      sessions: [...h.browsers.values()],
    });
  }
  const secret = 'rhost_' + crypto.randomBytes(18).toString('hex');
  const code = makePairCode();
  const host = {
    pairCode: code,
    codeExpiresAt: Date.now() + 10 * 60 * 1000,
    running: true,
    label,
    browsers: new Map(),
    queue: [],
    events: [],
    lastHeartbeat: Date.now(),
  };
  remoteHosts.set(secret, host);
  res.json({ ok: true, hostSecret: secret, running: true, code, sessions: [] });
});

app.get('/api/remote/status', (req, res) => {
  const hit = getRemoteHost(req);
  if (!hit) return res.json({ ok: true, running: false, code: null, sessions: [] });
  const { host } = hit;
  host.lastHeartbeat = Date.now();
  const codeValid = host.codeExpiresAt > Date.now();
  res.json({
    ok: true,
    running: host.running,
    code: codeValid ? host.pairCode : null,
    codeExpiresAt: codeValid ? host.codeExpiresAt : null,
    sessions: [...host.browsers.values()],
  });
});

app.post('/api/remote/new-code', (req, res) => {
  const hit = getRemoteHost(req);
  if (!hit) return res.status(404).json({ ok: false, error: 'Remote session not found.' });
  const { host } = hit;
  host.pairCode = makePairCode();
  host.codeExpiresAt = Date.now() + 10 * 60 * 1000;
  host.running = true;
  res.json({ ok: true, code: host.pairCode, expiresAt: host.codeExpiresAt });
});

app.post('/api/remote/disable', (req, res) => {
  const hit = getRemoteHost(req);
  if (!hit) return res.json({ ok: true, running: false });
  hit.host.running = false;
  res.json({ ok: true, running: false });
});

app.post('/api/remote/revoke', (req, res) => {
  const hit = getRemoteHost(req);
  if (!hit) return res.status(404).json({ ok: false, error: 'Session not found.' });
  const bid = String(req.body?.id || '');
  hit.host.browsers.delete(bid);
  remoteBrowsers.delete(bid);
  res.json({ ok: true, sessions: [...hit.host.browsers.values()] });
});

app.post('/api/remote/pair', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const label = String(req.body?.label || req.headers['user-agent']?.slice(0, 48) || 'Browser').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid 6-digit pairing code.' });
  }
  const now = Date.now();
  for (const [secret, host] of remoteHosts.entries()) {
    if (host.running && host.pairCode === code && host.codeExpiresAt > now) {
      host.pairCode = makePairCode();
      host.codeExpiresAt = 0; // single-use code
      const browserId = 'rb_' + crypto.randomBytes(12).toString('hex');
      const sess = {
        id: browserId,
        label,
        origin: req.headers.origin || req.ip || 'web',
        lastSeen: now,
      };
      host.browsers.set(browserId, sess);
      remoteBrowsers.set(browserId, secret);
      return res.json({ ok: true, browserId, hostLabel: host.label });
    }
  }
  return res.status(404).json({ ok: false, error: 'Invalid or expired pairing code.' });
});

app.post('/api/remote/command', (req, res) => {
  const browserId = String(req.body?.browserId || '').trim();
  const text = String(req.body?.text || '').trim();
  const secret = remoteBrowsers.get(browserId);
  const host = secret ? remoteHosts.get(secret) : null;
  if (!host || !host.running || !host.browsers.has(browserId)) {
    return res.status(401).json({ ok: false, error: 'Pairing closed or expired.' });
  }
  if (!text) return res.status(400).json({ ok: false, error: 'Command text is empty.' });
  host.browsers.get(browserId).lastSeen = Date.now();
  const cmdId = 'cmd_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  host.queue.push({ id: cmdId, browserId, text, at: Date.now() });
  res.json({ ok: true, commandId: cmdId });
});

app.get('/api/remote/poll', (req, res) => {
  const hit = getRemoteHost(req);
  if (!hit || !hit.host.running) return res.json({ ok: true, commands: [] });
  hit.host.lastHeartbeat = Date.now();
  const commands = hit.host.queue.splice(0, 5);
  res.json({ ok: true, commands });
});

app.post('/api/remote/events', (req, res) => {
  const hit = getRemoteHost(req);
  if (!hit) return res.status(404).json({ ok: false });
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  for (const ev of events) {
    hit.host.events.push({ ...ev, ts: Date.now() });
  }
  if (hit.host.events.length > 250) {
    hit.host.events = hit.host.events.slice(-250);
  }
  res.json({ ok: true });
});

app.get('/api/remote/stream', (req, res) => {
  const browserId = String(req.query.browserId || '').trim();
  const since = Number(req.query.since || 0);
  const secret = remoteBrowsers.get(browserId);
  const host = secret ? remoteHosts.get(secret) : null;
  if (!host || !host.running || !host.browsers.has(browserId)) {
    return res.status(401).json({ ok: false, error: 'Disconnected.' });
  }
  host.browsers.get(browserId).lastSeen = Date.now();
  const items = host.events.filter((e) => e.ts > since);
  const latestTs = items.length ? items[items.length - 1].ts : since;
  res.json({ ok: true, events: items, latestTs });
});

// Client verification endpoint (for desktop/web whitelist + pro + account status checks)
app.post('/api/client/verify', (req, res) => {
  const settings = store.getSettings();
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bodyKey = String(req.body?.apiKey || '').trim();
  const rawKey = bodyKey || bearer;

  if (rawKey && rawKey.startsWith('zk_live_')) {
    const keyRec = store.findApiKeyByPlain(rawKey);
    if (!keyRec) return res.status(401).json({ ok: false, allowed: false, reason: 'key_invalid', error: 'Gecersiz API anahtari.' });
    if (!keyRec.active) return res.status(401).json({ ok: false, allowed: false, reason: 'key_disabled', error: 'API anahtari yonetici tarafindan kapatilmis.' });
    const owner = store.findUserById(keyRec.userId) || store.findUserByEmail(keyRec.userEmail);
    if (!owner) return res.status(403).json({ ok: false, allowed: false, reason: 'not_found', error: 'Hesap bulunamadi.' });
    if (owner.status === 'frozen') return res.status(403).json({ ok: false, allowed: false, reason: 'frozen', error: 'Hesabiniz yonetici tarafindan dondurulmustur.' });
    if (owner.status === 'closed') return res.status(403).json({ ok: false, allowed: false, reason: 'closed', error: 'Hesabiniz yonetici tarafindan kapatilmistir.' });
    if (!owner.whitelisted) return res.status(403).json({ ok: false, allowed: false, reason: 'not_whitelisted', error: 'Hesabiniz whitelistte yer almiyor.' });
    return res.json({
      ok: true,
      allowed: true,
      sessionToken: signSessionToken(owner.email),
      user: { email: owner.email, whitelisted: owner.whitelisted, pro: owner.pro, status: owner.status, quotaResetAt: Number(owner.quotaResetAt || 0) },
      models: store.getPublicModels(),
    });
  }

  const email = normalizeEmail(req.body?.email || '');
  if (!email) {
    return res.status(400).json({ ok: false, allowed: false, error: 'E-posta veya API anahtari gerekli.' });
  }
  const user = store.findUserByEmail(email);
  if (!user) {
    return res.json({
      ok: true,
      found: false,
      allowed: false,
      reason: 'not_whitelisted',
      error: `'${email}' hesabı yetkili kullanıcı listesinde (whitelist) yer almıyor.`,
      user: { email, whitelisted: false, pro: false, status: 'unregistered' },
      models: store.getPublicModels(),
    });
  }

  let allowed = Boolean(user.whitelisted) && user.status === 'active';
  let reason = 'ok';
  let errMsg = '';
  if (!user.whitelisted) {
    allowed = false;
    reason = 'not_whitelisted';
    errMsg = `'${email}' hesabı whitelistte yer almıyor.`;
  } else if (user.status === 'frozen') {
    allowed = false;
    reason = 'frozen';
    errMsg = `'${email}' hesabı yönetici tarafından geçici olarak dondurulmuştur.`;
  } else if (user.status === 'closed') {
    allowed = false;
    reason = 'closed';
    errMsg = `'${email}' hesabı yönetici tarafından kalıcı olarak kapatılmıştır.`;
  }

  return res.json({
    ok: true,
    found: true,
    allowed,
    reason,
    error: errMsg || undefined,
    // A bare email claim is not proof of identity, so no session token is
    // issued here unless the deployment opted into email-only auth.
    sessionToken: allowed && settings.allowEmailAuth === true ? signSessionToken(user.email) : undefined,
    user: { email: user.email, whitelisted: user.whitelisted, pro: user.pro, status: user.status, quotaResetAt: Number(user.quotaResetAt || 0) },
    models: store.getPublicModels(),
  });
});

// Google code exchange lives here so the client secret never ships in a binary.
app.post('/api/client/google-token', async (req, res) => {
  const secret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || req.body?.clientId || '').trim();
  const code = String(req.body?.code || '').trim();
  const redirectUri = String(req.body?.redirectUri || 'http://127.0.0.1:8765').trim();
  if (!secret || !clientId) {
    return res.status(501).json({ ok: false, error: 'Sign-in is not configured on this relay.' });
  }
  if (!code) {
    return res.status(400).json({ ok: false, error: 'Missing authorization code.' });
  }
  try {
    const form = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) {
      return res.status(401).json({ ok: false, error: tokenBody.error_description || 'Google token exchange failed.' });
    }
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const info = await infoRes.json().catch(() => ({}));
    const email = normalizeEmail(info.email || '');
    if (!email || info.email_verified === false) {
      return res.status(401).json({ ok: false, error: 'Google account email could not be verified.' });
    }
    const user = store.findUserByEmail(email);
    return res.json({
      ok: true,
      email,
      name: info.name || email,
      picture: info.picture || '',
      whitelisted: Boolean(user && user.whitelisted),
      pro: Boolean(user && user.pro),
      status: user ? user.status : 'unregistered',
      sessionToken: user && user.whitelisted && user.status === 'active' ? signSessionToken(email) : undefined,
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: `Google sign-in unreachable: ${error.message}` });
  }
});

// ---- Admin Authentication ----
app.get('/api/admin/session', (req, res) => {
  res.json({ ok: true, authenticated: isAdminRequest(req) });
});

app.post('/api/admin/login', (req, res) => {
  const secret = String(req.body?.secret || '');
  if (!verifyAdminSecret(secret)) {
    return res.status(401).json({ ok: false, error: 'Hatali yonetici sifresi.' });
  }
  const backupSpec = routes.backup();
  if (store.getTotalActivePoolKeys() === 0 || (backupSpec && store.getBackupPoolKeys(backupSpec.pool).length === 0)) {
    store.unlockVault(secret.trim());
  }
  const token = signAdminSession();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ---- Admin Control Suite Endpoints ----
app.get('/api/admin/clusters', requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    ready: routes.ready(),
    error: routes.ready() ? undefined : routes.error(),
    clusters: routes.clusterIds().map((id) => ({ id, label: routes.clusterLabel(id) })),
  });
});

app.get('/api/admin/state', requireAdmin, (_req, res) => {
  const users = store.listUsers();
  const apiKeys = store.listApiKeys();
  const upstreamKeys = store.listUpstreamKeys();
  const models = store.listModels();
  const settings = store.getSettings();
  const requestLogs = store.state.requestLogs || [];

  res.json({
    ok: true,
    users,
    apiKeys,
    upstreamKeys,
    models,
    settings,
    release: store.getRelease(),
    requestLogs,
    clusters: routes.clusterIds(),
    stats: {
      totalUsers: users.length,
      whitelistedUsers: users.filter((u) => u.whitelisted).length,
      proUsers: users.filter((u) => u.pro).length,
      frozenUsers: users.filter((u) => u.status === 'frozen').length,
      closedUsers: users.filter((u) => u.status === 'closed').length,
      activeApiKeys: apiKeys.filter((k) => k.active).length,
      totalApiKeys: apiKeys.length,
      activePoolKeys: upstreamKeys.filter((k) => k.active).length,
      totalPoolKeys: upstreamKeys.length,
      activeModels: models.filter((m) => m.status === 'active').length,
      totalModels: models.length,
    },
  });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = store.updateSettings(req.body || {});
  res.json({ ok: true, settings });
});

app.post('/api/admin/release', requireAdmin, (req, res) => {
  const release = store.updateRelease(req.body || {});
  res.json({ ok: true, release });
});

// 1 & 2 & 4. Whitelist, Pro Privilege, Freeze & Close Account
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const result = store.upsertUser(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const result = store.setUserFlags(req.params.id, req.body || {});
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

app.post('/api/admin/users/:id/reset-quota', requireAdmin, (req, res) => {
  const result = store.resetUserQuota(req.params.id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const result = store.deleteUser(req.params.id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// 3a. Client API Keys (Ekle / Kapat / Ac / Sil)
app.post('/api/admin/keys', requireAdmin, (req, res) => {
  const result = store.createApiKey(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.patch('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const active = Boolean(req.body?.active);
  const result = store.setApiKeyActive(req.params.id, active);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  const result = store.deleteApiKey(req.params.id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// 3b. Upstream Pool Keys (Ekle / Kapat / Ac / Sil)
app.post('/api/admin/upstream-keys', requireAdmin, (req, res) => {
  const { cluster, keys } = req.body || {};
  const result = store.addUpstreamKeys(cluster, keys);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.patch('/api/admin/upstream-keys/:id', requireAdmin, (req, res) => {
  const active = Boolean(req.body?.active);
  const result = store.setUpstreamKeyActive(req.params.id, active);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

app.delete('/api/admin/upstream-keys/:id', requireAdmin, (req, res) => {
  const result = store.deleteUpstreamKey(req.params.id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// Pool & hidden backup key sync endpoint (for sync-pools.cjs)
app.post('/api/keys/update', (req, res) => {
  const { secret, pools, backupPools } = req.body || {};
  if (!verifyAdminSecret(secret) && !isAdminRequest(req)) {
    return res.status(403).json({ ok: false, error: 'Unauthorized access (Invalid secret)' });
  }
  if (pools) store.syncPoolFromApi(pools);
  if (backupPools && typeof backupPools === 'object') {
    for (const [bName, bKeys] of Object.entries(backupPools)) {
      store.setBackupPool(bName, bKeys);
    }
  }
  res.json({
    ok: true,
    active_nodes: store.getTotalActivePoolKeys(),
    message: 'All node pools updated successfully!',
  });
});

// 5. Model Management (Ekle / Kapat / Ac / Working on it / Tier / Sil)
app.post('/api/admin/models', requireAdmin, (req, res) => {
  const result = store.upsertModel(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.patch('/api/admin/models/:id', requireAdmin, (req, res) => {
  const result = store.setModelPatch(decodeURIComponent(req.params.id), req.body || {});
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

app.delete('/api/admin/models/:id', requireAdmin, (req, res) => {
  const result = store.deleteModel(decodeURIComponent(req.params.id));
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// OpenAI-compatible Models list endpoint (only active models exposed to SDKs)
app.get('/v1/models', (_req, res) => {
  const active = store.getPublicModels().filter((m) => m.status === 'active');
  res.json({
    object: 'list',
    data: active,
  });
});


// Smart Router: ordered routes from the host-only table (cluster rotation +
// silent backup). Nothing here names a provider.
function pushClusterRoutes(candidates, clusterId, targetModel) {
  const base = routes.clusterUrl(clusterId);
  if (!base) return;
  const keys = getNextKeys(clusterId, 6);
  if (!keys.length) return;
  for (const key of keys) {
    candidates.push({
      url: `${base}/chat/completions`,
      headers: { Authorization: `Bearer ${key}` },
      targetModel,
    });
  }
}

function resolveUpstreams(askedModel, modelEntry) {
  const candidates = [];
  const asked = String(askedModel || '').toLowerCase();

  const route = (modelEntry && modelEntry.routeCluster && routes.clusterUrl(modelEntry.routeCluster)
    ? { cluster: modelEntry.routeCluster, upstream: modelEntry.upstreamModel || askedModel, alt: [] }
    : (routes.modelRoute(askedModel) || routes.fallbackRoute(askedModel)));

  if (route && routes.clusterUrl(route.cluster)) {
    pushClusterRoutes(candidates, route.cluster, route.upstream || askedModel);
    for (const alt of route.alt || []) {
      if (alt && alt.cluster) pushClusterRoutes(candidates, alt.cluster, alt.upstream || askedModel);
    }
  }

  const backup = routes.backup();
  if (backup && backup.match.some((needle) => asked.includes(String(needle).toLowerCase()))) {
    const target = backup.upstream || askedModel;
    for (const key of getNextBackupKeys(backup.pool, 4)) {
      candidates.push({
        url: `${backup.url}/chat/completions`,
        headers: { Authorization: `Bearer ${key}` },
        targetModel: target,
      });
    }
  }

  return candidates;
}

// Chat completions endpoint: key or signed session token, whitelist, pro,
// freeze/close, model status, then cluster failover from the host table.
app.post('/v1/chat/completions', async (req, res) => {
  totalRequests++;
  const settings = store.getSettings();
  // Fail closed: without a host routing table this node must not invent an
  // upstream out of hardcoded defaults.
  if (!routes.ready()) {
    return res.status(503).json({
      error: { message: 'Gateway routing is not configured on this node.', type: 'gateway_unconfigured' },
    });
  }
  const {
    model,
    messages,
    stream,
    temperature,
    max_tokens,
    reasoning_effort,
    tools,
    tool_choice,
    parallel_tool_calls,
    response_format,
    stop,
    top_p,
    frequency_penalty,
    presence_penalty,
    stream_options,
    seed,
  } = req.body || {};
  const askedModel = String(model || 'zarnkina-glm-5.3-flash');

  // 1. Identity: API key, or a signed session token issued by /api/client/verify.
  // A bare email header is a claim, not proof, and is refused unless the
  // deployment explicitly re-enables it.
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerToken = String(req.headers['x-zarnkina-token'] || '').trim();
  const claimedEmail = normalizeEmail(req.headers['x-zarnkina-email'] || '');
  const sessionEmail = verifySessionToken(
    headerToken || (bearer.startsWith('zk_sess_') ? bearer : '')
  );
  let keyRec = null;
  let owner = null;

  if (bearer && bearer.startsWith('zk_live_')) {
    keyRec = store.findApiKeyByPlain(bearer);
    if (!keyRec) {
      return res.status(401).json({ error: { message: 'Invalid API key', type: 'invalid_auth' } });
    }
    if (!keyRec.active) {
      return res.status(401).json({ error: { message: 'API key has been disabled by administrator', type: 'invalid_auth' } });
    }
    owner = store.findUserById(keyRec.userId) || store.findUserByEmail(keyRec.userEmail);
    if (!owner) {
      return res.status(403).json({ error: { message: 'Account not found', type: 'invalid_auth' } });
    }
  } else if (sessionEmail) {
    owner = store.findUserByEmail(sessionEmail);
    if (!owner) {
      return res.status(403).json({ error: { message: 'Account not found', type: 'invalid_auth' } });
    }
  } else if (claimedEmail && settings.allowEmailAuth === true) {
    owner = store.findUserByEmail(claimedEmail);
    if (!owner) {
      return res.status(403).json({
        error: { message: `Account '${claimedEmail}' is not whitelisted. Access denied.`, type: 'not_whitelisted' },
      });
    }
  } else if (settings.requireApiKey) {
    return res.status(401).json({ error: { message: 'Valid Zarnkina API key (zk_live_...) is required', type: 'invalid_auth' } });
  } else {
    return res.status(401).json({
      error: {
        message: 'Authentication required. Sign in to obtain a session token or provide a valid zk_live_ API key.',
        type: 'auth_required',
      },
    });
  }

  if (owner.status === 'frozen') {
    return res.status(403).json({ error: { message: 'Account is frozen by administrator', type: 'account_frozen' } });
  }
  if (owner.status === 'closed') {
    return res.status(403).json({ error: { message: 'Account is closed by administrator', type: 'account_closed' } });
  }
  if (!owner.whitelisted) {
    return res.status(403).json({ error: { message: 'Account is not whitelisted', type: 'not_whitelisted' } });
  }

  // 2. Check model catalog status & Pro privilege
  const modelEntry = store.findModel(askedModel);
  if (modelEntry && modelEntry.status !== 'active') {
    const reason = modelEntry.status === 'working_on_it'
      ? `Model '${modelEntry.id}' is currently under maintenance (Working on it).`
      : `Model '${modelEntry.id}' is currently disabled by administrator.`;
    return res.status(503).json({ error: { message: reason, type: 'model_unavailable' } });
  }

  if (owner && modelEntry && modelEntry.tier === 'pro' && settings.enforceProModelGate && !owner.pro) {
    return res.status(403).json({
      error: { message: `Model '${modelEntry.id}' requires Pro privilege.`, type: 'pro_required' },
    });
  }

  req.setTimeout(0);
  res.setTimeout(0);

  const upstreamRoutes = resolveUpstreams(askedModel, modelEntry);
  let chosenRes = null;
  let chosenReader = null;
  let chosenFirstChunk = null;
  let chosenJsonData = null;
  let lastStatus = 502;

  const defaultOutTokens = Math.min(modelEntry?.maxOutputTokens || 32768, 65536);

  for (const route of upstreamRoutes) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const routeMaxTokens = route.url.includes('pollinations')
        ? Math.min(max_tokens ?? 8192, 16000)
        : (max_tokens ?? defaultOutTokens);
      const upstreamPayload = {
        model: route.targetModel,
        messages: messages || [],
        stream: Boolean(stream),
        temperature: temperature ?? 0.7,
        max_tokens: routeMaxTokens,
      };
      if (reasoning_effort !== undefined) upstreamPayload.reasoning_effort = reasoning_effort;
      if (tools !== undefined && !route.url.includes('pollinations')) upstreamPayload.tools = tools;
      if (tool_choice !== undefined && !route.url.includes('pollinations')) upstreamPayload.tool_choice = tool_choice;
      if (parallel_tool_calls !== undefined && !route.url.includes('pollinations')) upstreamPayload.parallel_tool_calls = parallel_tool_calls;
      if (response_format !== undefined) upstreamPayload.response_format = response_format;
      if (stop !== undefined) upstreamPayload.stop = stop;
      if (top_p !== undefined) upstreamPayload.top_p = top_p;
      if (frequency_penalty !== undefined) upstreamPayload.frequency_penalty = frequency_penalty;
      if (presence_penalty !== undefined) upstreamPayload.presence_penalty = presence_penalty;
      if (stream_options !== undefined) upstreamPayload.stream_options = stream_options;
      if (seed !== undefined) upstreamPayload.seed = seed;
      const upstreamRes = await fetch(route.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...route.headers },
        body: JSON.stringify(upstreamPayload),
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (upstreamRes.ok) {
        if (stream) {
          if (!upstreamRes.body) {
            lastStatus = 502;
            continue;
          }
          const reader = upstreamRes.body.getReader();
          const first = await reader.read();
          if (first.done && (!first.value || first.value.length === 0)) {
            lastStatus = 502;
            continue;
          }
          chosenRes = upstreamRes;
          chosenReader = reader;
          chosenFirstChunk = first.done ? null : first.value;
          break;
        } else {
          chosenJsonData = await upstreamRes.json();
          chosenRes = upstreamRes;
          break;
        }
      }
      lastStatus = upstreamRes.status;
    } catch (err) {
      clearTimeout(timer);
      lastStatus = 502;
    }
  }

  const logEmail = owner ? owner.email : (clientEmail || 'Relay Client');
  if (!chosenRes) {
    store.recordRequestLog({
      email: logEmail,
      keyPrefix: keyRec ? keyRec.prefix : '—',
      model: askedModel,
      status: lastStatus,
      tokens: 0,
    });
    if (!res.headersSent) {
      return res.status(lastStatus).json({
        error: { message: `Gateway upstream error (HTTP ${lastStatus})`, type: 'upstream_error' },
      });
    }
    return;
  }

  let hb = null;
  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
        try { chosenReader?.cancel(); } catch {}
      });

      hb = setInterval(() => {
        if (!clientClosed && !res.writableEnded) {
          try { res.write(': ping\n\n'); } catch {}
        }
      }, 12000);

      const decoder = new TextDecoder();
      let approxTokens = 0;

      if (chosenFirstChunk && !clientClosed && !res.writableEnded) {
        const firstText = decoder.decode(chosenFirstChunk, { stream: true });
        if (firstText) {
          const step = Math.max(1, Math.floor(firstText.length / 4));
          approxTokens += step;
          totalTokens += step;
          res.write(firstText);
        }
      }

      while (!clientClosed && !res.writableEnded) {
        const { done, value } = await chosenReader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          const step = Math.max(1, Math.floor(chunk.length / 4));
          approxTokens += step;
          totalTokens += step;
          res.write(chunk);
        }
      }
      clearInterval(hb);
      hb = null;
      if (!res.writableEnded) res.end();

      if (keyRec) store.touchApiKey(keyRec.id, owner?.id, approxTokens);
      store.recordRequestLog({
        email: logEmail,
        keyPrefix: keyRec ? keyRec.prefix : '—',
        model: askedModel,
        status: 200,
        tokens: approxTokens,
      });
    } else {
      const data = chosenJsonData;
      const usedTokens = data.usage?.total_tokens || 50;
      totalTokens += usedTokens;
      if (keyRec) store.touchApiKey(keyRec.id, owner?.id, usedTokens);
      store.recordRequestLog({
        email: logEmail,
        keyPrefix: keyRec ? keyRec.prefix : '—',
        model: askedModel,
        status: 200,
        tokens: usedTokens,
      });
      res.json(data);
    }
  } catch (err) {
    if (hb) clearInterval(hb);
    console.error('Relay stream error:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: 'Relay gateway connection failed', type: 'gateway_error' } });
    } else if (!res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({ error: { message: 'Upstream stream interrupted' } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {}
    }
  }
});

(async () => {
  await store.initAsync();
  const srv = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zarnkina Relay listening on port ${PORT} - Active pool keys: ${store.getTotalActivePoolKeys()}`);
  });
  srv.requestTimeout = 0;
  srv.headersTimeout = 120000;
  srv.keepAliveTimeout = 65000;
})();
