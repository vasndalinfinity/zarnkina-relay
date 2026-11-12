// One-off: re-encrypt the key vault under a fresh VAULT_KEY and add pools.
// Usage: node scripts/rekey-vault.cjs <oldVaultSecret> <newVaultKeyHex> [pool=key,key,...]
// Never commit the output key. It belongs in the host environment only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [oldSecret, newKeyHex, ...poolArgs] = process.argv.slice(2);
if (!oldSecret || !newKeyHex) {
  console.error('usage: rekey-vault.cjs <oldVaultSecret> <newVaultKeyHex> [POOL=k1,k2,...]');
  process.exit(2);
}

const vaultPath = path.join(__dirname, '..', 'lib', 'pools.vault.json');
const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));

function decrypt(secret) {
  const key = crypto.scryptSync(secret, Buffer.from(vault.salt, 'hex'), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(vault.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(vault.tag, 'hex'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(vault.data, 'base64')), decipher.final()]).toString('utf8')
  );
}

const pools = decrypt(oldSecret);
for (const arg of poolArgs) {
  const idx = arg.indexOf('=');
  if (idx <= 0) continue;
  const name = arg.slice(0, idx).trim().toUpperCase();
  const keys = arg
    .slice(idx + 1)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name || !keys.length) continue;
  pools[name] = [...new Set([...(pools[name] || []), ...keys])];
}

const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.scryptSync(newKeyHex, salt, 32);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(JSON.stringify(pools), 'utf8'), cipher.final()]);

fs.writeFileSync(
  vaultPath,
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

const summary = Object.fromEntries(Object.entries(pools).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
console.log('vault rekeyed:', JSON.stringify(summary));
