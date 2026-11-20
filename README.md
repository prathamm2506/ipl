# IPL Auction Room — Multiplayer (v4)

Play the IPL auction with friends in real time. Each friend claims a franchise; every unclaimed franchise is run by the AI.

```
server/            Node + Express + Socket.IO (the "brain" — runs the auction, timer, AI, validation)
  index.js         HTTP + WebSocket entry point, room registry, serves /dist in production
  engine/Room.js   Auction state machine (lobby → retention → auction → nominations → accelerated → final → complete)
  engine/ai.js     AI valuation + tricks (price-pushing, late sniping, walk-away points, saving for targets)
  engine/rules.js  Purse, squad limits, bid ladder, retention slabs, RTM
  data/players.js  Player database (edit ratings / squads here)
  data/teams.js    Franchises, colours, AI personalities, 2026 purses
client/            React (Vite) UI — Neo Brutalism theme; a live view of server state
test/              Headless full-auction simulation + socket wiring checks
render.yaml        One-click Render deployment
```

## Run locally
```bash
npm install
npm run dev          # server on :3001 + client on :5173 (proxied)
```
Open http://localhost:5173. Friends on the same Wi-Fi can open `http://<your-PC-IP>:5173`.

Production-style run: `npm run build && npm start` → http://localhost:3001

Tests: `npm test`

## Deploy to Render (free)
1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → pick the repo (uses `render.yaml`), or **New → Web Service** with:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Health check path: `/health`
3. Share `https://<your-service>.onrender.com/?room=CODE` with friends.

Notes: free instances sleep after ~15 min idle (first visit takes ~1 min to wake), and rooms live in memory, so a restart/redeploy ends running auctions.

## How to play
- Host creates a room → shares the link/code → everyone picks a team → host chooses Mega/Mini, timer, AI difficulty → Start.
- Retention: Mega = pick up to 6 from your 2024 squad (slab costs, RTM cards = 6 − retained). Mini = keep/release from your 2026 squad.
- Bidding: `B` = bid next increment, `P` = pass, Jump buttons, custom amount. Turn on **Auto-pass** to fly through players you don't want.
- If you disconnect, the AI runs your team (or auto-passes — host setting) until you rejoin from the same browser.
