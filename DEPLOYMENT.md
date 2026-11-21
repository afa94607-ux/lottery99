# Lottery888 (1/99) — Local Development & Production Deployment Guide

This platform consists of two separate applications sharing **one authoritative Express + SQLite backend**:

1. **Lottery888 Game Page + Authoritative Backend** (`http://127.0.0.1:3000`)
   - Serves the Player Game interface and the single authoritative `/api/*` backend + SQLite database (`data/lottery888.sqlite`).
2. **Lottery888 Owner Admin Panel** (`http://127.0.0.1:3001`)
   - Pure Owner management frontend that connects directly to `http://127.0.0.1:3000/api/*` (via Vite proxy in dev or `VITE_API_URL` in production).
   - Uses a dedicated Vite HMR port (`24679`) and runs **no duplicated backend server**, preventing port `24678` conflicts and split-state bugs.

---

## 1. One-Time Owner Initialization (Secure Setup)

Owner credentials are never hardcoded in source code. Before logging into the Admin Panel for the first time on a fresh server, initialize the Owner account directly into the local SQLite database inside the **Game Page** folder:

```powershell
npm run init-owner -- --username YOUR_OWNER_USERNAME --password YOUR_STRONG_PASSWORD
```

The password is stored as a salted `scrypt` hash inside `data/lottery888.sqlite`. You can change the owner password anytime inside the Admin Panel under **System Config**.

---

## 2. Local Development (Windows PowerShell)

### Start Game Page + Authoritative Backend (`http://127.0.0.1:3000`)
Open **PowerShell Window 1** inside `lottery888-game-page`:
```powershell
npm install
npm run dev
```

### Start Owner Admin Panel (`http://127.0.0.1:3001`)
Open **PowerShell Window 2** inside `lottery888-admin-panel`:
```powershell
npm install
npm run dev
```

### Stop Applications
Press `Ctrl + C` in each PowerShell window, or run:
```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## 3. Production Deployment Preparation

### Backend + Game Page (Node.js VPS / Render / Railway / DigitalOcean)
1. Copy `.env.example` to `.env` and configure `PORT=3000` (and optional `LOTTERY_DB_PATH`).
2. Run `npm install`, initialize the Owner account once with `npm run init-owner -- --username <user> --password <pass>`, then run:
   ```bash
   npm run build
   npm start
   ```
3. Keep `data/lottery888.sqlite` on a persistent disk volume and back it up regularly.

### Owner Admin Panel (Static Hosting / Cloudflare Pages / Nginx)
1. Set environment variable `VITE_API_URL=https://your-game-api-domain.com` (the URL of your deployed Game Page backend).
2. Build command: `npm run build`
3. Output directory: `dist`
4. Restrict CORS or add IP/Access protection on your Admin Panel domain in production.

---

## 4. Security Notes

- Player accounts are **Owner-created only** (no public self-registration).
- The Master role has been completely removed (`OWNER -> PLAYERS`).
- All passwords are stored as salted `scrypt` hashes in SQLite.
- Never upload `data/lottery888.sqlite`, `data/*.json`, or `.env` files to public repositories.
