// Server-side routing table loader.
//
// Nothing about upstream providers lives in this file or in any committed
// source. The whole map (endpoints, pools, per-model upstream ids, fallback
// ladder) is read from `data/routes.json`, which is gitignored and lives only
// on the host. If that file is missing or unreadable the gateway reports
// `ready === false` and every chat request is refused instead of silently
// falling back to a hardcoded provider.

const fs = require('fs');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, '..', 'data', 'routes.json');

let cached = null;
let cachedMtime = 0;
let loadError = 'routes file missing';

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
    return cached;
  } catch (error) {
    loadError = error.code === 'ENOENT' ? 'routes file missing' : error.message;
    return null;
  }
}

function table() {
  return readFile();
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

module.exports = {
  ready,
  error,
  clusters,
  clusterIds,
  neutralForPool,
  clusterUrl,
  clusterLabel,
  modelRoute,
  fallbackRoute,
  backup,
};
