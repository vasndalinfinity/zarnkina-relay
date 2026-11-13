// Server-side routing table loader.
//
// Nothing about upstream providers lives in this file or in any committed
// source. The whole map (endpoints, pools, per-model upstream ids, fallback
// ladder) is read from `data/routes.json`, which is gitignored and lives only
// on the host. If that file is missing or unreadable the gateway reports
// `ready === false` and every chat request is refused instead of silently
// falling back to a hardcoded provider.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, '..', 'data', 'routes.json');
const ROUTES_VAULT = path.join(__dirname, 'routes.vault.json');

let cached = null;
let cachedMtime = 0;
let loadError = 'routes file missing';

// Three sources, all outside public plaintext: an env blob, a host-local file,
// or the committed encrypted vault opened with VAULT_KEY.
function readEnv() {
  const raw = String(process.env.ROUTES_JSON || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.clusters) {
      loadError = 'ROUTES_JSON has no clusters';
      return null;
    }
    loadError = '';
    return parsed;
  } catch (error) {
    loadError = `ROUTES_JSON invalid: ${error.message}`;
    return null;
  }
}

function readVault() {
  const secret = String(process.env.VAULT_KEY || '').trim();
  if (!secret) {
    loadError = 'VAULT_KEY missing for routes.vault.json';
    return null;
  }
  try {
    const vault = JSON.parse(fs.readFileSync(ROUTES_VAULT, 'utf8'));
    const key = crypto.scryptSync(secret, Buffer.from(vault.salt, 'hex'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(vault.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(vault.tag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(vault.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plain);
    if (!parsed || typeof parsed !== 'object' || !parsed.clusters) {
      loadError = 'routes vault has no clusters';
      return null;
    }
    loadError = '';
    return parsed;
  } catch (error) {
    loadError = `routes vault unreadable: ${error.code === 'ENOENT' ? 'missing' : error.message}`;
    return null;
  }
}

function readFile() {
  try {
    const stat = fs.statSync(ROUTES_FILE);
    if (cached && stat.mtimeMs === cachedMtime) return cached;
    const parsed = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.clusters) {
      loadError = 'routes file has no clusters';
      return null;
    }
    cached = parsed;
    cachedMtime = stat.mtimeMs;
    loadError = '';
    return parsed;
  } catch (error) {
    loadError = error.code === 'ENOENT' ? 'routes file missing' : error.message;
    return null;
  }
}

function table() {
  const fromEnv = readEnv();
  if (fromEnv) return fromEnv;
  const fromFile = readFile();
  if (fromFile) return fromFile;
  return readVault();
}

function ready() {
  return Boolean(table());
}

function error() {
  return loadError;
}

function clusters() {
  const t = table();
  return t && t.clusters && typeof t.clusters === 'object' ? t.clusters : {};
}

function clusterIds() {
  return Object.keys(clusters());
}

// Pool names inside the encrypted vault are historic and never appear in
// source; the neutral id is what the rest of the server uses.
function neutralForPool(poolName) {
  const upper = String(poolName || '').toUpperCase().trim();
  if (!upper) return null;
  for (const [id, entry] of Object.entries(clusters())) {
    if (String(entry && entry.pool || '').toUpperCase() === upper) return id;
  }
  return null;
}

function clusterUrl(id) {
  const entry = clusters()[id];
  return entry && typeof entry.url === 'string' ? entry.url.replace(/\/+$/, '') : '';
}

function clusterLabel(id) {
  const entry = clusters()[id];
  return entry && (entry.label || entry.pool) ? String(entry.label || entry.pool) : String(id || '');
}

function modelRoute(modelId) {
  const t = table();
  if (!t || !t.models) return null;
  const route = t.models[String(modelId || '').trim().toLowerCase()];
  if (!route || !route.cluster) return null;
  return {
    cluster: route.cluster,
    upstream: route.upstream || modelId,
    alt: Array.isArray(route.alt) ? route.alt.filter((a) => a && a.cluster) : [],
  };
}

function fallbackRoute(modelId) {
  const t = table();
  if (!t || !Array.isArray(t.fallback)) return null;
  const lower = String(modelId || '').toLowerCase();
  for (const rule of t.fallback) {
    const needles = Array.isArray(rule.match) ? rule.match : [];
    if (needles.some((needle) => lower.includes(String(needle).toLowerCase()))) {
      if (!rule.cluster) continue;
      return { cluster: rule.cluster, upstream: rule.upstream || modelId, alt: [] };
    }
  }
  return null;
}

function backup() {
  const t = table();
  if (!t || !t.backup || !t.backup.pool || !t.backup.url) return null;
  return {
    pool: String(t.backup.pool).toUpperCase(),
    url: String(t.backup.url).replace(/\/+$/, ''),
    match: Array.isArray(t.backup.match) ? t.backup.match : [],
    upstream: t.backup.upstream || '',
  };
}

// Some upstreams do not accept tool definitions. The capability lives in the
// host routing table so no provider name ever appears in public source.
function supportsTools(clusterId) {
  const entry = clusters()[clusterId];
  if (!entry) return true;
  return entry.supportsTools !== false;
}

function poolOf(clusterId) {
  const entry = clusters()[clusterId];
  return entry && entry.pool ? String(entry.pool).toUpperCase() : '';
}

function catalog() {
  const t = table();
  return t && Array.isArray(t.catalog) ? t.catalog : [];
}

function catalogVersion() {
  const t = table();
  return t && typeof t.catalogVersion === 'number' ? t.catalogVersion : 0;
}

module.exports = {
  ready,
  error,
  clusters,
  clusterIds,
  neutralForPool,
  clusterUrl,
  clusterLabel,
  poolOf,
  supportsTools,
  catalog,
  catalogVersion,
  modelRoute,
  fallbackRoute,
  backup,
};
