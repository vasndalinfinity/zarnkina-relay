# Kalıcı kurulum (VPS)

Hostless'ın build kuyruğu bize uygun değil: tek runner, 25 dakikaya varan stall.
Bu klasör aynı relay'i kendi VPS'inde, kuyruk olmadan çalıştırır.

## Gereken

- Ubuntu 22.04 / 24.04 VPS (2 vCPU, 2 GB RAM yeter) — Hetzner CX22 (~€4/ay),
  Contabo, DigitalOcean, Koyeb, Oracle Always Free.
- Domain için A kaydı: `zarnkina-relay` → VPS IP.

## 1. Sunucuda

```bash
apt update && apt install -y git curl
git clone https://github.com/vasndalinfinity/zarnkina-relay.git /opt/zarnkina-relay
cd /opt/zarnkina-relay
cp deploy/.env.example deploy/.env
nano deploy/.env          # VAULT_KEY, GOOGLE_CLIENT_SECRET, ADMIN_SECRET, DATABASE_URL
chmod 600 deploy/.env
bash deploy/bootstrap.sh
```

`VAULT_KEY` değeri geliştirici makinesindeki `D:\zarnkina-relay\.env` içinde.
Bu anahtar olmadan kasa açılmaz ve her chat `503 gateway_unconfigured` döner.
`data/routes.json` gerekmez — rota tablosu `lib/routes.vault.json` içinde aynı anahtarla şifreli.

## 2. Kontrol

```bash
curl -sS http://127.0.0.1:8080/health
# {"status":"ok","active_nodes":102,"models":25,"catalog_version":3,"routes_ready":true}
```

## 3. TLS

Caddy ilk açılışta Let's Encrypt sertifikasını kendi alır. `deploy/Caddyfile`
içindeki hostname'i kendi domainine çevir:

```
zarnkina-relay.ornek.com {
```

## 4. Güncelleme

```bash
bash /opt/zarnkina-relay/deploy/update.sh
```

GitHub'a push + tek komut. Build kuyruğu yok, süre ~40 saniye.

## 5. DNS geçişi

1. `zarnkina-relay` A kaydını VPS IP'sine çevir.
2. Hostless deployment'ı durdur.
3. `curl -sS https://zarnkina-relay.hostless.app/api/public/release` ile manifest'in
   yeni sunucudan geldiğini doğrula.

## Notlar

- `restart: unless-stopped` → sunucu yeniden başlarsa relay kendiliğinden kalkar.
- Log rotasyonu compose içinde tanımlı (relay 5×20 MB, caddy 3×10 MB).
- SSE için Caddy'de `flush_interval -1`, 30 dk read/write timeout var; reasoning
  akışları kopmuyor.
- Postgres (Neon) aynen kullanılır; state kaybı olmaz.
