# Best Weather — Native Edge Push Worker (Cloudflare Workers + KV)

Kostenloses (100.000 Requests/Tag Free Tier), zero-dependency Push-Backend für echte iOS 16.4+ / iPadOS / macOS Sperrbildschirm-Push-Benachrichtigungen über Apple APNs — komplett ohne Tokens im Browser und mit rein anonymer UUID v4 pro Gerät.

## Einrichtung in 60 Sekunden

1. **KV Namespace erstellen:**
   ```bash
   cd cloudflare-worker
   npx wrangler login
   npx wrangler kv namespace create PUSH_KV
   ```
   Die ausgegebene `id` in `cloudflare-worker/wrangler.toml` bei `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` eintragen.

2. **VAPID Private Key als verschlüsseltes Worker-Secret setzen:**
   ```bash
   npx wrangler secret put VAPID_PRIVATE_KEY
   ```
   (Den zugehörigen VAPID Private Key eingeben.)

3. **Worker deployen:**
   ```bash
   npx wrangler deploy
   ```
   Die ausgegebene Worker-URL (z. B. `https://best-weather-push.<dein-name>.workers.dev`) in `features/notifications.js` bei `DEFAULT_PUSH_WORKER_URL` (oder direkt in den App-Einstellungen) hinterlegen.

Danach funktioniert jedes iPhone, iPad und jeder Mac vollautomatisch mit 1 Klick — alle 15 Minuten prüft der Cloudflare Cron Trigger die Wetterlage und sendet individuelle Pushes direkt über Apple APNs.
