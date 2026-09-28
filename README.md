# Resolve-X — Real-time incident operations

This version turns the original browser-only prototype into a small real-time web application.

## What changed

- **No login for reporters.** A person can open the site and report an incident.
- **Shared incidents.** Reports are stored on the server in `data/incidents.json`, so phones and computers see the same records.
- **Real-time updates.** Socket.IO pushes new incidents and status changes without refreshing.
- **Private admin alert channel.** Only a device opened with the configured `ADMIN_KEY` joins the admin alert room.
- **Browser notification.** The admin device can ask the browser for notification permission.
- **Optional push notifications.** With VAPID keys configured, the server can notify the admin even when the site is in the background/closed.
- **Live incident chat.** Each incident has a real-time message room shared between devices.
- **CSV/JSON export.**
- The existing Resolve-X visual style is retained and extended.

## Run on your computer

1. Install Node.js 18+.
2. Extract this folder.
3. Open a terminal in the extracted folder.
4. Run:
   ```bash
   npm install
   ```
5. Copy `.env.example` to `.env`.
6. Change `ADMIN_KEY` to a long random value.
7. Start:
   ```bash
   npm start
   ```
8. Open `http://localhost:3000`.

### Test with two phones on the same Wi-Fi

Find the computer's local IP address, for example `192.168.1.20`, then open:

`http://192.168.1.20:3000`

on both phones. The computer firewall must allow Node on the local network.

For the private admin phone, open:

`http://192.168.1.20:3000/?admin=YOUR_ADMIN_KEY`

The key is saved in that browser, so you do not need to log in. Reporters simply open the normal URL without `admin`.

## Enable alerts on your admin phone

Open the admin URL, tap the notification/bell button, and allow browser notifications.

This works while the browser is allowed to receive notifications. For reliable alerts when the web page is completely closed, configure Web Push.

### Optional Web Push setup

Run:

```bash
npx web-push generate-vapid-keys
```

Put the generated values in `.env`:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Restart the server. Open the admin URL over **HTTPS** (or localhost for development), enable notifications, and the browser can register a push subscription.

## Deploy for real-world use

This needs a server, not GitHub Pages alone. Use a Node-compatible host such as Render, Railway, Fly.io, or a VPS. Add the same environment variables in the host's settings.

For production, replace the JSON file with a real database such as PostgreSQL/Supabase and use HTTPS.

## Important security note

This project intentionally avoids user accounts because that was requested. The `ADMIN_KEY` protects the private admin alert channel, but it is not a complete identity system. For a public production service, add proper authentication, rate limiting, abuse protection, input validation, database backups, and HTTPS.

## Project structure

```text
resolve-x-realtime/
├─ server.js
├─ package.json
├─ .env.example
├─ README.md
├─ data/
│  ├─ incidents.json
│  └─ push-subscriptions.json
└─ public/
   ├─ index.html
   ├─ style.css
   ├─ script.js
   ├─ sw.js
   └─ icon.svg
```

