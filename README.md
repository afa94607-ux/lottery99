# ឆ្នោតសំណាង 1/99 — Lottery888 Game Page + Authoritative Backend

Runs the Player Game interface AND the single authoritative Express + SQLite backend on `http://127.0.0.1:3000`.

## 1. First-Time Setup (Windows PowerShell)

```powershell
npm install
npm run init-owner -- --username YOUR_OWNER_USERNAME --password YOUR_STRONG_PASSWORD
npm run dev
```

Open your browser at **http://127.0.0.1:3000**.

## 2. Start / Stop Commands (Windows PowerShell)

Start:
```powershell
npm run dev
```

Stop:
Press `Ctrl + C` in PowerShell, or run:
```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## 3. Production Build & Start

```powershell
npm run build
npm start
```

Data is stored permanently in `data/lottery888.sqlite` (SQLite 3). Never publish `data/lottery888.sqlite` or `.env`.
