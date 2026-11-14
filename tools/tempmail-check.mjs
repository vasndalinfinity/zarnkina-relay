// Tempmail acceptance probe.
//
// Creates a throwaway mailbox and tries to register it with providers that
// expose a plain JSON signup endpoint. Answers one question per provider:
// does the signup path accept a disposable domain at all, or does it refuse
// the domain before any mail is sent?
//
// Usage: node tools/tempmail-check.mjs
const BASE_CANDIDATES = [
  ['SiliconFlow', 'https://api.siliconflow.cn/v1/user/register', { email: '{email}', password: '{password}', name: 'zrn' }],
  ['Novita', 'https://api.novita.ai/v1/user/register', { email: '{email}', password: '{password}' }],
  ['DeepInfra', 'https://api.deepinfra.com/v1/users/register', { email: '{email}', password: '{password}' }],
  ['SambaNova', 'https://api.sambanova.ai/api/v1/auth/register', { email: '{email}', password: '{password}' }],
  ['WaveSpeed', 'https://api.wavespeed.ai/api/v1/users/register', { email: '{email}', password: '{password}' }],
  ['Chutes', 'https://api.chutes.ai/api/v0/users/register', { email: '{email}', password: '{password}' }],
];

async function mailbox() {
  const domainRes = await fetch('https://api.mail.tm/domains?page=1');
  const domains = await domainRes.json();
  const domain = (domains['hydra:member'] || domains['member'] || [])[0]?.domain;
  if (!domain) throw new Error('mail.tm domain yok');
  const address = `zrn${Date.now().toString(36)}@${domain}`;
  const password = 'Zr!9' + Math.random().toString(36).slice(2, 10);
  const res = await fetch('https://api.mail.tm/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!res.ok) throw new Error(`mailbox kurulamadı: HTTP ${res.status}`);
  const token = (await res.json()).token;
  return { address, password, token };
}

function verdict(status, body) {
  const text = String(body).toLowerCase();
  if (status >= 200 && status < 300) return 'KABUL (doğrulama maili gönderildi)';
  if (/not allowed|disposable|temp mail|blocked|invalid email|not supported/.test(text)) return 'RED (domain/hesap reddi)';
  if (/already exists|registered|taken/.test(text)) return 'RED (hesap var)';
  if (/captcha|turnstile|recaptcha|challenge|bot/.test(text) || status === 403 || status === 429)
    return 'BOT KORUMASI (tarayıcıyla elle denemek gerek)';
  return `HTTP ${status}`;
}

(async () => {
  let box;
  try {
    box = await mailbox();
    console.log(`geçici kutu: ${box.address}\n`);
  } catch (error) {
    console.error('mailbox kurulamadı:', error.message);
    process.exit(1);
  }

  for (const [name, url, template] of BASE_CANDIDATES) {
    const payload = {};
    for (const [key, value] of Object.entries(template)) {
      payload[key] = value.replace('{email}', box.address).replace('{password}', box.password);
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      console.log(`${name.padEnd(12)} ${verdict(res.status, text)}  ${text.slice(0, 110).replace(/\s+/g, ' ')}`);
    } catch (error) {
      console.log(`${name.padEnd(12)} HATA ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log(`\nkutu: ${box.address} / ${box.password}`);
})();
