const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateApiKey, normalizeEmail, sha256 } = require('./auth');
const routes = require('./routes');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const VAULT_FILE = path.join(__dirname, 'pools.vault.json');
const VALID_USER_STATUSES = ['active', 'frozen', 'closed'];
const VALID_MODEL_STATUSES = ['active', 'disabled', 'working_on_it'];

const DEFAULT_MODELS = [
  {
    id: 'zarnkina-glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    family: 'GLM',
    tier: 'free',
    status: 'active',
    contextWindow: 1000000,
    maxOutputTokens: 32000,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Ultra Low',
    capabilities: ['tools', 'reasoning'],
    tag: 'Free · 1M',
    description: 'High-throughput 1M-context reasoning engine for fast multi-turn workflows and coding.',
  },
  {
    id: 'zarnkina-deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    family: 'DeepSeek',
    tier: 'free',
    status: 'active',
    contextWindow: 400000,
    maxOutputTokens: 32000,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Standard',
    capabilities: ['tools', 'reasoning'],
    tag: 'Fast Flash',
    description: 'High-throughput DeepSeek V4 Flash with 400K context for rapid repository analysis.',
  },
  {
    id: 'zarnkina-minimax-m3.1-flash',
    name: 'MiniMax M3.1 Flash',
    family: 'MiniMax',
    tier: 'free',
    status: 'active',
    contextWindow: 1000000,
    maxOutputTokens: 131072,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Low',
    capabilities: ['tools', 'reasoning', 'coding', 'fast'],
    tag: '1M Context',
    description: 'Massive 1,000,000-token context window with structured tool calling and long-horizon reasoning.',
  },
  {
    id: 'zarnkina-minimax-m2.7',
    name: 'MiniMax M2.7',
    family: 'MiniMax',
    tier: 'free',
    status: 'active',
    contextWindow: 256000,
    maxOutputTokens: 32000,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Ultra Low',
    capabilities: ['tools', 'reasoning'],
    tag: 'Efficient',
    description: 'Balanced reasoning and conversational model with steady tool calling stability.',
  },
  {
    id: 'zarnkina-qwen-3.8-27b',
    name: 'Qwen 3.8 27B',
    family: 'Qwen',
    tier: 'free',
    status: 'active',
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputs: 'text, image',
    reasoning: true,
    usageTier: 'Low',
    capabilities: ['tools', 'reasoning', 'vision'],
    tag: 'Vision & Code',
    description: 'High-density vision and benchmark coding model with 262K context.',
  },
  {
    id: 'zarnkina-nemotron-super-vl',
    name: 'Nvidia Nemotron 3.5 Super VL',
    family: 'Nvidia',
    tier: 'free',
    status: 'active',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    inputs: 'text, image',
    reasoning: true,
    usageTier: 'Moderate',
    capabilities: ['tools', 'vision', 'reasoning'],
    tag: 'Multimodal',
    description: 'Multimodal visual reasoning model capable of reading screenshots, diagrams, and charts.',
  },
  {
    id: 'zarnkina-nemotron-ultra',
    name: 'Nvidia Nemotron 3 Ultra 550B',
    family: 'Nvidia',
    tier: 'free',
    status: 'active',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'High',
    capabilities: ['tools', 'reasoning'],
    tag: 'Heavy AI',
    description: 'Large 550B MoE reasoning model for hard math, algorithms, and structured tool orchestration.',
  },
  {
    id: 'zarnkina-nemotron-lightning',
    name: 'Nvidia Nemotron 3.5 Lightning',
    family: 'Nvidia',
    tier: 'free',
    status: 'active',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Low',
    capabilities: ['tools', 'reasoning', 'fast'],
    tag: 'Instantaneous',
    description: 'Low-latency 1M context engine engineered for fast coding edits and interactive completions.',
  },
  {
    id: 'zarnkina-gpt-4o-mini',
    name: 'GPT-4o Mini',
    family: 'OpenAI',
    tier: 'free',
    status: 'active',
    contextWindow: 128000,
    maxOutputTokens: 16000,
    inputs: 'text, image',
    reasoning: false,
    usageTier: 'Standard',
    capabilities: ['general', 'reliable'],
    tag: 'General',
    description: 'Everyday coding, natural language explanations, and rapid utility tasks.',
  },
  {
    id: 'zarnkina-openai-fast',
    name: 'OpenAI Gateway',
    family: 'OpenAI',
    tier: 'free',
    status: 'active',
    contextWindow: 200000,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Standard',
    capabilities: ['reasoning', 'tools'],
    tag: 'Gateway',
    description: 'Low-latency OpenAI-compatible router with rapid response fallback.',
  },
  {
    id: 'deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash (Legacy)',
    family: 'DeepSeek',
    tier: 'free',
    status: 'active',
    contextWindow: 400000,
    maxOutputTokens: 65536,
    inputs: 'text, image',
    reasoning: true,
    usageTier: 'High',
    capabilities: ['tools', 'reasoning', 'vision', 'fast'],
    tag: 'Legacy Wire',
    description: 'Direct compatibility alias for existing scripts and custom endpoints.',
  },
  {
    id: 'zarnkina-beam-free',
    name: 'Beam Free',
    family: 'Zarnkina',
    tier: 'free',
    status: 'active',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Standard',
    capabilities: ['tools', 'reasoning'],
    tag: '1M Reasoning',
    description: 'Reflection-tuned 1M context reasoning model with chain-of-thought output.',
  },
  {
    id: 'zarnkina-crouton-alpha',
    name: 'Crouton Alpha',
    family: 'Zarnkina',
    tier: 'free',
    status: 'active',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Standard',
    capabilities: ['tools', 'reasoning'],
    tag: 'Experimental',
    description: 'Experimental reasoning cluster with a full 1M context window.',
  },
  {
    id: 'zarnkina-glyph-cluster',
    name: 'Glyph Cluster',
    family: 'Zarnkina',
    tier: 'free',
    status: 'active',
    contextWindow: 256000,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Standard',
    capabilities: ['tools', 'reasoning'],
    tag: 'Cluster',
    description: 'High-density reasoning cluster tuned for structured agent pipelines.',
  },
  {
    id: 'zarnkina-north-mini-code',
    name: 'North Mini Code',
    family: 'Cohere',
    tier: 'free',
    status: 'active',
    contextWindow: 256000,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: false,
    usageTier: 'Low',
    capabilities: ['tools', 'coding'],
    tag: 'Code Expert',
    description: 'Compact code intelligence model tuned for refactoring and debugging.',
  },
  {
    id: 'zarnkina-mercury-3',
    name: 'Mercury 3',
    family: 'Mercury',
    tier: 'pro',
    status: 'working_on_it',
    contextWindow: 1000000,
    maxOutputTokens: 131072,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Working on it',
    capabilities: ['tools', 'reasoning', 'coding', 'fast'],
    tag: 'Working on it',
    description: 'High-throughput diffusion model currently undergoing maintenance.',
  },
  {
    id: 'zarnkina-mercury-2.5',
    name: 'Mercury 2.5',
    family: 'Mercury',
    tier: 'free',
    status: 'working_on_it',
    contextWindow: 260000,
    maxOutputTokens: 65536,
    inputs: 'text',
    reasoning: true,
    usageTier: 'Working on it',
    capabilities: ['tools', 'reasoning'],
    tag: 'Working on it',
    description: 'Balanced diffusion pairing model currently undergoing maintenance.',
  },
  {
    id: 'zarnkina-mercury-2',
    name: 'Mercury 2',
    family: 'Mercury',
    tier: 'free',
    status: 'working_on_it',
    contextWindow: 128000,
    maxOutputTokens: 32000,
    inputs: 'text',
    reasoning: false,
    usageTier: 'Working on it',
    capabilities: ['tools'],
    tag: 'Working on it',
    description: 'Lightweight inline diffusion model currently undergoing maintenance.',
  },
  {
    id: 'zarnkina-deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash 1017',
    family: 'DeepSeek',
    tier: 'pro',
    status: 'active',
    contextWindow: 400000,
    maxOutputTokens: 65536,
    inputs: 'text, image',
    reasoning: true,
    usageTier: 'High',
    capabilities: ['tools', 'reasoning', 'vision', 'coding', 'fast'],
    tag: 'Pro Flagship',
    description: 'Dedicated DeepSeek V4.1 Flash (1017) checkpoint with flagship coding accuracy and high throughput.',
  },
];

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function maskKey(keyText) {
  const s = String(keyText || '');
  if (s.length <= 16) return s.slice(0, 4) + '••••';
  return `${s.slice(0, 10)}…${s.slice(-6)}`;
}

function parseEnvList(val) {
  return String(val || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function hydrateState(parsed) {
  const base = defaultState();
  const hydrated = {
    settings: { ...base.settings, ...(parsed.settings || {}) },
    release: { ...base.release, ...(parsed.release || {}) },
    users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : base.users,
    apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
    upstreamKeys: Array.isArray(parsed.upstreamKeys) && parsed.upstreamKeys.length > 0 ? parsed.upstreamKeys : base.upstreamKeys,
    backupPools: (parsed.backupPools && typeof parsed.backupPools === 'object') ? parsed.backupPools : base.backupPools,
    models: Array.isArray(parsed.models) && parsed.models.length > 0 ? parsed.models : base.models,
    requestLogs: Array.isArray(parsed.requestLogs) ? parsed.requestLogs.slice(0, 100) : [],
  };

  // Fill any missing Desktop metadata fields on older model entries without clobbering user edits
  const defaultsMap = new Map(DEFAULT_MODELS.map((m) => [m.id, m]));
  for (const m of hydrated.models) {
    const def = defaultsMap.get(m.id);
    if (def) {
      if (!m.family) m.family = def.family;
      if (!m.inputs || (def.inputs && def.inputs.includes('image') && !String(m.inputs).includes('image'))) {
        m.inputs = def.inputs;
      }
      if (def.capabilities && def.capabilities.includes('vision')) {
        if (!Array.isArray(m.capabilities)) m.capabilities = [...def.capabilities];
        else if (!m.capabilities.includes('vision')) m.capabilities.push('vision');
      }
      if (typeof m.reasoning !== 'boolean') m.reasoning = def.reasoning;
      if (!m.usageTier) m.usageTier = def.usageTier;
    }
  }

  return hydrated;
}

function defaultState() {
  const now = nowIso();
  const state = {
    settings: {
      requireApiKey: false,
      enforceProModelGate: true,
      allowEmailAuth: false,
    },
    release: {
      version: process.env.DESKTOP_LATEST_VERSION || '0.2.0',
      notes: 'Realtime 3s sync, auto-update, Remote Control, Blender/Roblox connectors, Team multi-model & live context meter.',
      downloadUrl: process.env.DESKTOP_DOWNLOAD_URL || '',
      autoUpdate: true,
    },
    users: [
      {
        id: 'usr_owner',
        email: 'vasndalinfinity@gmail.com',
        name: 'Vasndal Infinity (Admin)',
        whitelisted: true,
        pro: true,
        status: 'active',
        note: 'Owner / Administrator',
        tokensUsed: 0,
        createdAt: now,
        updatedAt: now,
        frozenAt: null,
        closedAt: null,
      },
    ],
    apiKeys: [],
    upstreamKeys: [],
    backupPools: {},
    models: DEFAULT_MODELS.map((m) => ({ ...m, createdAt: now, updatedAt: now })),
    requestLogs: [],
  };

  const backupSpec = routes.backup();
  if (backupSpec) {
    state.backupPools[backupSpec.pool] = parseEnvList(process.env.BACKUP_KEYS);
  }

  const envPools = {};
  for (const clusterId of routes.clusterIds()) {
    envPools[clusterId] = parseEnvList(process.env[`UPSTREAM_KEYS_${clusterId.toUpperCase()}`]);
  }

  for (const [cluster, keys] of Object.entries(envPools)) {
    for (const keyText of keys) {
      state.upstreamKeys.push({
        id: makeId('uk'),
        cluster,
        keyText,
        masked: maskKey(keyText),
        active: true,
        createdAt: now,
        disabledAt: null,
      });
    }
  }

  return state;
}

class Store {
  constructor() {
    this.sql = null;
    this.dbReady = false;
    this.state = this.loadLocal();
    this.normalizeClusters();
    this.applyRoutes();
  }

  // Legacy rows stored cluster names; the gateway only speaks neutral ids.
  normalizeClusters() {
    if (!Array.isArray(this.state.upstreamKeys)) return;
    const alias = new Map();
    for (const id of routes.clusterIds()) {
      const pool = routes.poolOf(id);
      const label = routes.clusterLabel(id);
      if (pool) alias.set(pool, id);
      if (label) alias.set(String(label).toUpperCase(), id);
    }
    let changed = false;
    for (const key of this.state.upstreamKeys) {
      const upper = String(key.cluster || '').toUpperCase().trim();
      const id = alias.get(upper);
      if (id && id !== key.cluster) {
        key.cluster = id;
        changed = true;
      }
    }
    if (changed) this.saveLocal();
  }

  // The routing table lives on the host, not in source: model -> cluster and
  // cluster -> endpoint are re-applied on every boot so a stale state.json or a
  // database row can never resurrect a hardcoded provider. A catalog version
  // bump re-seeds the public model list; admin edits persist until then.
  applyRoutes() {
    const catalog = routes.catalog();
    const version = routes.catalogVersion();
    if (catalog.length && this.state.catalogVersion !== version) {
      const now = nowIso();
      this.state.models = catalog.map((entry) => ({
        id: String(entry.id),
        name: entry.name || entry.id,
        family: entry.family || 'Zarnkina',
        tier: entry.tier === 'pro' ? 'pro' : 'free',
        status: VALID_MODEL_STATUSES.includes(entry.status) ? entry.status : 'active',
        contextWindow: Math.max(4096, Number(entry.contextWindow) || 128000),
        maxOutputTokens: Math.max(1024, Number(entry.maxOutputTokens) || 32000),
        inputs: entry.inputs || 'text',
        reasoning: entry.reasoning !== false,
        usageTier: entry.usageTier || 'Standard',
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : ['tools'],
        tag: entry.tag || '',
        description: entry.description || '',
        createdAt: now,
        updatedAt: now,
      }));
      this.state.catalogVersion = version;
      this.saveLocal();
    }
    for (const model of this.state.models) {
      const route = routes.modelRoute(model.id) || routes.fallbackRoute(model.id);
      if (!route) continue;
      model.routeCluster = route.cluster;
      model.upstreamModel = route.upstream;
    }
  }

  loadLocal() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return hydrateState(parsed);
        }
      }
    } catch (err) {
      console.error('[Store] Failed to load local state.json:', err.message);
    }
    const fresh = defaultState();
    this.state = fresh;
    this.saveLocal();
    return fresh;
  }

  async initAsync() {
    const dbUrl = String(process.env.DATABASE_URL || '').trim();
    if (dbUrl) {
      try {
        const { neon } = require('@neondatabase/serverless');
        this.sql = neon(dbUrl);
        await Promise.race([
          this.sql`CREATE TABLE IF NOT EXISTS relay_state (
            id text PRIMARY KEY,
            data jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )`,
          new Promise((_, rej) => setTimeout(() => rej(new Error('DB init timeout')), 4500)),
        ]);
        const rows = await Promise.race([
          this.sql`SELECT data FROM relay_state WHERE id = 'main' LIMIT 1`,
          new Promise((_, rej) => setTimeout(() => rej(new Error('DB select timeout')), 4500)),
        ]);
        this.dbReady = true;
        if (rows && rows[0] && rows[0].data) {
          this.state = hydrateState(rows[0].data);
          this.saveLocal();
          // Postgres replaces the local state: routes, catalog and cluster ids
          // must be re-applied or the stored row wins over the host table.
          this.normalizeClusters();
          this.applyRoutes();
          console.log('[Store] Loaded persistent state from Postgres.');
        } else {
          const autoEnvKey = String(process.env.VAULT_KEY || '').trim();
          if (autoEnvKey && this.getTotalActivePoolKeys() === 0) {
            this.unlockVault(autoEnvKey);
          }
          await this.persistToDb();
          console.log('[Store] Seeded Postgres relay_state from initial store.');
        }
      } catch (err) {
        console.warn('[Store] Postgres unavailable, using local data/state.json:', err.message);
      }
    }

    const autoVaultSecret = String(process.env.VAULT_KEY || '').trim();
    if (autoVaultSecret) {
      // Always re-sync from the vault: a deployed vault may carry new pools or
      // renamed ones, and a stale local state must not skip them.
      const unlocked = this.unlockVault(autoVaultSecret);
      if (unlocked.ok) {
        this.normalizeClusters();
        console.log(`[Store] Auto-unlocked encrypted key vault (${unlocked.loaded} keys).`);
      } else {
        console.warn(`[Store] Vault unlock failed: ${unlocked.error}`);
      }
    }
  }

  unlockVault(secretPassword) {
    const pw = String(secretPassword || '').trim();
    if (!pw || !fs.existsSync(VAULT_FILE)) {
      return { ok: false, error: 'Kasa dosyasi veya sifre eksik.' };
    }
    try {
      const vault = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
      const key = crypto.scryptSync(pw, Buffer.from(vault.salt, 'hex'), 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(vault.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(vault.tag, 'hex'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(vault.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const pools = JSON.parse(plain);
      this.syncPoolFromApi(pools);
      const loaded = Object.values(pools).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
      return { ok: true, loaded };
    } catch {
      return { ok: false, error: 'Kasa sifresi eslesmedi.' };
    }
  }

  async persistToDb() {
    if (!this.dbReady || !this.sql) return;
    try {
      await this.sql`
        INSERT INTO relay_state (id, data, updated_at)
        VALUES ('main', ${JSON.stringify(this.state)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `;
    } catch (err) {
      console.warn('[Store] Failed Postgres sync:', err.message);
    }
  }

  saveLocal() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.error('[Store] Failed to persist state.json:', err.message);
    }
  }

  save() {
    this.saveLocal();
    this.persistToDb();
  }

  // ---- Users & Whitelist & Pro & Freeze/Close ----
  listUsers() {
    return this.state.users.map((u) => {
      const userKeys = this.state.apiKeys.filter((k) => k.userId === u.id || k.userEmail === u.email);
      return {
        ...u,
        activeKeys: userKeys.filter((k) => k.active).length,
        totalKeys: userKeys.length,
      };
    });
  }

  findUserByEmail(email) {
    const norm = normalizeEmail(email);
    if (!norm) return null;
    return this.state.users.find((u) => normalizeEmail(u.email) === norm) || null;
  }

  findUserById(id) {
    return this.state.users.find((u) => u.id === id) || null;
  }

  upsertUser({ email, name = '', note = '', whitelisted = true, pro = false, status = 'active' }) {
    const norm = normalizeEmail(email);
    if (!norm || !norm.includes('@')) {
      return { ok: false, error: 'Geçerli bir e-posta adresi girin.' };
    }
    const safeStatus = VALID_USER_STATUSES.includes(status) ? status : 'active';
    const now = nowIso();
    let user = this.findUserByEmail(norm);
    if (user) {
      if (name) user.name = String(name).trim();
      if (note !== undefined && note !== null) user.note = String(note).trim();
      user.whitelisted = Boolean(whitelisted);
      user.pro = Boolean(pro);
      user.status = safeStatus;
      user.updatedAt = now;
      if (safeStatus === 'frozen' && !user.frozenAt) user.frozenAt = now;
      if (safeStatus === 'active') {
        user.frozenAt = null;
        user.closedAt = null;
      }
      if (safeStatus === 'closed') user.closedAt = now;
    } else {
      user = {
        id: makeId('usr'),
        email: norm,
        name: String(name || '').trim(),
        whitelisted: Boolean(whitelisted),
        pro: Boolean(pro),
        status: safeStatus,
        note: String(note || '').trim(),
        tokensUsed: 0,
        createdAt: now,
        updatedAt: now,
        frozenAt: safeStatus === 'frozen' ? now : null,
        closedAt: safeStatus === 'closed' ? now : null,
      };
      this.state.users.unshift(user);
    }
    this.save();
    return { ok: true, user };
  }

  setUserFlags(id, patch) {
    const user = this.findUserById(id);
    if (!user) return { ok: false, error: 'Kullanıcı bulunamadı.' };
    const now = nowIso();

    if (typeof patch.whitelisted === 'boolean') user.whitelisted = patch.whitelisted;
    if (typeof patch.pro === 'boolean') user.pro = patch.pro;
    if (typeof patch.note === 'string') user.note = patch.note.trim();
    if (typeof patch.name === 'string') user.name = patch.name.trim();

    if (patch.status && VALID_USER_STATUSES.includes(patch.status)) {
      user.status = patch.status;
      if (patch.status === 'frozen') {
        user.frozenAt = now;
        user.closedAt = null;
      } else if (patch.status === 'closed') {
        user.closedAt = now;
        for (const k of this.state.apiKeys) {
          if (k.userId === user.id || k.userEmail === user.email) {
            k.active = false;
            k.disabledAt = now;
          }
        }
      } else if (patch.status === 'active') {
        user.frozenAt = null;
        user.closedAt = null;
      }
    }

    user.updatedAt = now;
    this.save();
    return { ok: true, user };
  }

  resetUserQuota(id) {
    const user = this.findUserById(id);
    if (!user) return { ok: false, error: 'Kullanıcı bulunamadı.' };
    user.quotaResetAt = Date.now();
    user.updatedAt = nowIso();
    this.save();
    return { ok: true, user };
  }

  deleteUser(id) {
    const idx = this.state.users.findIndex((u) => u.id === id);
    if (idx === -1) return { ok: false, error: 'Kullanıcı bulunamadı.' };
    const [removed] = this.state.users.splice(idx, 1);
    this.state.apiKeys = this.state.apiKeys.filter((k) => k.userId !== id && k.userEmail !== removed.email);
    this.save();
    return { ok: true };
  }

  // ---- Client API Keys (zk_live_...) ----
  listApiKeys() {
    return this.state.apiKeys.map((k) => {
      const owner = this.findUserById(k.userId) || this.findUserByEmail(k.userEmail);
      return {
        id: k.id,
        userId: k.userId,
        userEmail: owner ? owner.email : k.userEmail,
        userStatus: owner ? owner.status : 'unknown',
        userPro: owner ? owner.pro : false,
        userWhitelisted: owner ? owner.whitelisted : false,
        label: k.label,
        prefix: k.prefix,
        masked: k.masked,
        active: k.active,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        disabledAt: k.disabledAt,
      };
    });
  }

  createApiKey({ userEmail, label = 'default' }) {
    const norm = normalizeEmail(userEmail);
    if (!norm) return { ok: false, error: 'Kullanıcı e-postası gerekli.' };
    let owner = this.findUserByEmail(norm);
    if (!owner) {
      const created = this.upsertUser({ email: norm, whitelisted: true, pro: false, status: 'active' });
      if (!created.ok) return created;
      owner = created.user;
    }
    if (owner.status === 'closed') {
      return { ok: false, error: 'Kapatılmış hesaba yeni key oluşturulamaz.' };
    }

    const gen = generateApiKey();
    const now = nowIso();
    const rec = {
      id: makeId('key'),
      userId: owner.id,
      userEmail: owner.email,
      label: String(label || 'default').trim().slice(0, 48) || 'default',
      prefix: gen.prefix,
      masked: gen.masked,
      keyHash: gen.hash,
      active: true,
      createdAt: now,
      lastUsedAt: null,
      disabledAt: null,
    };
    this.state.apiKeys.unshift(rec);
    this.save();
    return { ok: true, key: rec, plainKey: gen.plain };
  }

  setApiKeyActive(id, active) {
    const rec = this.state.apiKeys.find((k) => k.id === id);
    if (!rec) return { ok: false, error: 'API key bulunamadı.' };
    rec.active = Boolean(active);
    rec.disabledAt = rec.active ? null : nowIso();
    this.save();
    return { ok: true, key: rec };
  }

  deleteApiKey(id) {
    const idx = this.state.apiKeys.findIndex((k) => k.id === id);
    if (idx === -1) return { ok: false, error: 'API key bulunamadı.' };
    this.state.apiKeys.splice(idx, 1);
    this.save();
    return { ok: true };
  }

  findApiKeyByPlain(plain) {
    const hash = sha256(plain);
    return this.state.apiKeys.find((k) => k.keyHash === hash) || null;
  }

  touchApiKey(keyId, userId, tokens = 0) {
    const rec = this.state.apiKeys.find((k) => k.id === keyId);
    if (rec) rec.lastUsedAt = nowIso();
    if (userId && tokens > 0) {
      const u = this.findUserById(userId);
      if (u) u.tokensUsed = (Number(u.tokensUsed) || 0) + tokens;
    }
    this.save();
  }

  // ---- Upstream Pool Keys (Admin visible pools) ----
  listUpstreamKeys() {
    return this.state.upstreamKeys.map((k) => ({
      id: k.id,
      cluster: k.cluster,
      masked: k.masked || maskKey(k.keyText),
      active: k.active,
      createdAt: k.createdAt,
      disabledAt: k.disabledAt,
    }));
  }

  addUpstreamKeys(cluster, rawKeys) {
    const upper = String(cluster || '').toLowerCase().trim();
    if (!routes.clusterIds().includes(upper)) {
      return { ok: false, error: 'Geçersiz cluster adı.' };
    }
    const list = Array.isArray(rawKeys)
      ? rawKeys.map((s) => String(s || '').trim()).filter(Boolean)
      : String(rawKeys || '').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);

    if (!list.length) {
      return { ok: false, error: 'En az bir geçerli key yapıştırın.' };
    }

    const now = nowIso();
    let added = 0;
    let reactivated = 0;

    for (const keyText of list) {
      const existing = this.state.upstreamKeys.find((k) => k.keyText === keyText && k.cluster === upper);
      if (existing) {
        if (!existing.active) {
          existing.active = true;
          existing.disabledAt = null;
          reactivated++;
        }
      } else {
        this.state.upstreamKeys.unshift({
          id: makeId('uk'),
          cluster: upper,
          keyText,
          masked: maskKey(keyText),
          active: true,
          createdAt: now,
          disabledAt: null,
        });
        added++;
      }
    }

    this.save();
    return { ok: true, added, reactivated };
  }

  setUpstreamKeyActive(id, active) {
    const rec = this.state.upstreamKeys.find((k) => k.id === id);
    if (!rec) return { ok: false, error: 'Havuz keyi bulunamadı.' };
    rec.active = Boolean(active);
    rec.disabledAt = rec.active ? null : nowIso();
    this.save();
    return { ok: true, key: { id: rec.id, cluster: rec.cluster, active: rec.active } };
  }

  deleteUpstreamKey(id) {
    const idx = this.state.upstreamKeys.findIndex((k) => k.id === id);
    if (idx === -1) return { ok: false, error: 'Havuz keyi bulunamadı.' };
    this.state.upstreamKeys.splice(idx, 1);
    this.save();
    return { ok: true };
  }

  // ---- Hidden Backup Pools (Never listed in Admin UI or public endpoints) ----
  setBackupPool(name, keys) {
    const upper = String(name || '').toUpperCase().trim();
    if (!upper) return;
    const list = Array.isArray(keys) ? keys.map((s) => String(s).trim()).filter(Boolean) : parseEnvList(keys);
    if (!this.state.backupPools || typeof this.state.backupPools !== 'object') {
      this.state.backupPools = {};
    }
    this.state.backupPools[upper] = [...new Set(list)];
    this.save();
  }

  getBackupPoolKeys(name) {
    const upper = String(name || '').toUpperCase().trim();
    const list = this.state.backupPools?.[upper];
    return Array.isArray(list) ? list : [];
  }

  syncPoolFromApi(pools) {
    if (!pools || typeof pools !== 'object') return;
    const now = nowIso();
    const backupSpec = routes.backup();
    for (const [poolName, keys] of Object.entries(pools)) {
      const upper = String(poolName).toUpperCase().trim();
      const list = Array.isArray(keys) ? keys.map((s) => String(s).trim()).filter(Boolean) : parseEnvList(keys);
      if (backupSpec && upper === backupSpec.pool) {
        this.setBackupPool(backupSpec.pool, list);
        continue;
      }
      const clusterId = routes.neutralForPool(upper);
      if (!clusterId) continue;
      this.state.upstreamKeys = this.state.upstreamKeys.filter((k) => k.cluster !== clusterId);
      for (const keyText of list) {
        this.state.upstreamKeys.push({
          id: makeId('uk'),
          cluster: clusterId,
          keyText,
          masked: maskKey(keyText),
          active: true,
          createdAt: now,
          disabledAt: null,
        });
      }
    }
    // The vault is re-synced on every boot; keep one row per key text so the
    // pool count cannot inflate across restarts.
    const seen = new Set();
    this.state.upstreamKeys = this.state.upstreamKeys.filter((k) => {
      const text = String(k.keyText || '');
      if (!text || seen.has(text)) return false;
      seen.add(text);
      return true;
    });
    this.save();
  }

  getActivePoolKeys(cluster) {
    const id = String(cluster || '').trim();
    return this.state.upstreamKeys
      .filter((k) => k.cluster === id && k.active && k.keyText)
      .map((k) => k.keyText);
  }

  getTotalActivePoolKeys() {
    return this.state.upstreamKeys.filter((k) => k.active && k.keyText).length;
  }

  // ---- Dynamic Models Catalog ----
  listModels() {
    return this.state.models;
  }

  getPublicModels() {
    return this.state.models.map((m) => {
      const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
      const hasVision = (m.inputs && m.inputs.includes('image')) || caps.includes('vision');
      const hasReasoning = typeof m.reasoning === 'boolean' ? m.reasoning : caps.includes('reasoning');
      const status = m.status || 'active';
      const usageTier = status === 'working_on_it'
        ? 'Working on it'
        : (status === 'disabled' ? 'Closed' : (m.usageTier || (m.tier === 'pro' ? 'High' : 'Standard')));
      return {
        id: m.id,
        name: m.name,
        family: m.family || 'Zarnkina',
        object: 'model',
        owned_by: 'zarnkina',
        tier: m.tier,
        status,
        disabled: status !== 'active',
        inputs: m.inputs || (hasVision ? 'text, image' : 'text'),
        reasoning: hasReasoning,
        contextWindow: m.contextWindow,
        context_window: m.contextWindow,
        max_output_tokens: m.maxOutputTokens,
        usageTier,
        capabilities: caps,
        tag: m.tag || '',
        description: m.description || '',
      };
    });
  }

  findModel(modelId) {
    const target = String(modelId || '').trim().toLowerCase();
    if (!target) return null;
    return this.state.models.find((m) => m.id.toLowerCase() === target) || null;
  }

  upsertModel(input) {
    const id = String(input.id || '').trim();
    if (!id || !/^[a-zA-Z0-9._:-]+$/.test(id)) {
      return { ok: false, error: 'Model ID geçersiz (sadece harf, rakam ve . _ : - kullanın).' };
    }
    const name = String(input.name || id).trim();
    const tier = input.tier === 'pro' ? 'pro' : 'free';
    const status = VALID_MODEL_STATUSES.includes(input.status) ? input.status : 'active';
    const contextWindow = Math.max(4096, Number(input.contextWindow) || 128000);
    const maxOutputTokens = Math.max(1024, Number(input.maxOutputTokens) || 32000);
    const capabilities = Array.isArray(input.capabilities)
      ? input.capabilities.map((s) => String(s).trim()).filter(Boolean)
      : String(input.capabilities || 'tools').split(',').map((s) => s.trim()).filter(Boolean);
    const requestedCluster = String(input.routeCluster || '').toLowerCase().trim();
    const routeCluster = routes.clusterIds().includes(requestedCluster)
      ? requestedCluster
      : routes.clusterIds()[0] || '';
    const upstreamModel = String(input.upstreamModel || '').trim();
    const tag = String(input.tag || (tier === 'pro' ? 'Pro' : 'Free')).trim();
    const description = String(input.description || '').trim();
    const family = String(input.family || name.split(' ')[0] || 'Zarnkina').trim();
    const hasVision = capabilities.includes('vision');
    const hasReasoning = capabilities.includes('reasoning');
    const usageTier = status === 'working_on_it' ? 'Working on it' : (tier === 'pro' ? 'High' : 'Standard');
    const now = nowIso();

    let model = this.findModel(id);
    if (model) {
      model.name = name;
      model.family = family;
      model.tier = tier;
      model.status = status;
      model.contextWindow = contextWindow;
      model.maxOutputTokens = maxOutputTokens;
      model.capabilities = capabilities;
      model.inputs = hasVision ? 'text, image' : 'text';
      model.reasoning = hasReasoning;
      model.usageTier = usageTier;
      model.tag = tag;
      model.description = description;
      model.routeCluster = routeCluster;
      model.upstreamModel = upstreamModel;
      model.updatedAt = now;
    } else {
      model = {
        id,
        name,
        family,
        tier,
        status,
        contextWindow,
        maxOutputTokens,
        capabilities,
        inputs: hasVision ? 'text, image' : 'text',
        reasoning: hasReasoning,
        usageTier,
        tag,
        description,
        routeCluster,
        upstreamModel,
        createdAt: now,
        updatedAt: now,
      };
      this.state.models.push(model);
    }

    this.save();
    return { ok: true, model };
  }

  setModelPatch(id, patch) {
    const model = this.findModel(id);
    if (!model) return { ok: false, error: 'Model bulunamadı.' };
    if (patch.status && VALID_MODEL_STATUSES.includes(patch.status)) {
      model.status = patch.status;
      if (patch.status === 'working_on_it') model.usageTier = 'Working on it';
      else if (model.usageTier === 'Working on it') model.usageTier = model.tier === 'pro' ? 'High' : 'Standard';
    }
    if (patch.tier && (patch.tier === 'free' || patch.tier === 'pro')) {
      model.tier = patch.tier;
    }
    if (typeof patch.tag === 'string') {
      model.tag = patch.tag.trim();
    }
    model.updatedAt = nowIso();
    this.save();
    return { ok: true, model };
  }

  deleteModel(id) {
    const target = String(id || '').toLowerCase();
    const idx = this.state.models.findIndex((m) => m.id.toLowerCase() === target);
    if (idx === -1) return { ok: false, error: 'Model bulunamadı.' };
    this.state.models.splice(idx, 1);
    this.save();
    return { ok: true };
  }

  // ---- Settings & Request Logs & Desktop Release ----
  getSettings() {
    return this.state.settings;
  }

  getRelease() {
    return this.state.release || {
      version: '0.2.0',
      notes: '',
      downloadUrl: '',
      autoUpdate: true,
    };
  }

  updateRelease(patch) {
    const cur = this.getRelease();
    if (typeof patch.version === 'string' && patch.version.trim()) {
      cur.version = patch.version.trim();
    }
    if (typeof patch.notes === 'string') {
      cur.notes = patch.notes.trim();
    }
    if (typeof patch.downloadUrl === 'string') {
      cur.downloadUrl = patch.downloadUrl.trim();
    }
    if (typeof patch.autoUpdate === 'boolean') {
      cur.autoUpdate = patch.autoUpdate;
    }
    this.state.release = cur;
    this.save();
    return cur;
  }

  updateSettings(patch) {
    if (typeof patch.requireApiKey === 'boolean') {
      this.state.settings.requireApiKey = patch.requireApiKey;
    }
    if (typeof patch.enforceProModelGate === 'boolean') {
      this.state.settings.enforceProModelGate = patch.enforceProModelGate;
    }
    this.save();
    return this.state.settings;
  }

  recordRequestLog({ email = 'Anonymous / Relay', keyPrefix = '—', model = '', status = 200, tokens = 0 }) {
    this.state.requestLogs.unshift({
      id: makeId('log'),
      at: nowIso(),
      email,
      keyPrefix,
      model,
      status,
      tokens,
    });
    if (this.state.requestLogs.length > 80) {
      this.state.requestLogs.length = 80;
    }
    this.save();
  }
}

module.exports = {
  Store,
  VALID_USER_STATUSES,
  VALID_MODEL_STATUSES,
};
