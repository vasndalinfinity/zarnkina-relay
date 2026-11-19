// Encrypts data/routes.json into lib/routes.vault.json so the routing table can
// live in the repository without exposing provider endpoints.
// Usage: VAULT_KEY=<key> node scripts/seal-routes.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const key = String(process.env.VAULT_KEY || '').trim();
if (!key) {
  console.error('VAULT_KEY yok');
  process.exit(2);
}

const src = path.join(__dirname, '..', 'data', 'routes.json');
const out = path.join(__dirname, '..', 'lib', 'routes.vault.json');
const plain = fs.readFileSync(src, 'utf8');
JSON.parse(plain); // fail fast on bad input

const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const derived = crypto.scryptSync(key, salt, 32);
const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

fs.writeFileSync(
  out,
  JSON.stringify(
    {
      v: 1,
      alg: 'aes-256-gcm',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('base64'),
    },
    null,
    2
  ) + '\n',
  'utf8'
);
console.log(`sealed ${plain.length} bytes -> ${out}`);
