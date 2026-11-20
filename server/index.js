// HTTP + Socket.IO server. Serves the built React client from /dist and runs every auction room in memory.
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./engine/Room');
const { PLAYERS } = require('./data/players');
const TEAMS = require('./data/teams');

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN; // only needed if the client is hosted on a different domain
const ROOM_IDLE_MS = 30 * 60 * 1000;             // delete rooms with nobody connected for 30 min
const MAX_ROOMS = 200;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: CLIENT_ORIGIN ? { origin: CLIENT_ORIGIN.split(',') } : undefined,
  pingInterval: 20000,
  pingTimeout: 25000,
});

const rooms = new Map();
const CATALOG = {
  players: PLAYERS,
  teams: TEAMS.map(({ id, name, color, ink, purse26, persona }) => ({ id, name, color, ink, purse26, persona: persona.label })),
};

// ------------------------------------------------------------------ HTTP
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Server running. Build the client with "npm run build" or use "npm run dev".'));
}

// ------------------------------------------------------------------ rooms
function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

const pending = new Set();
function broadcast(room) {
  // Coalesce many changes in one tick into a single state push.
  if (pending.has(room.code)) return;
  pending.add(room.code);
  setImmediate(() => {
    pending.delete(room.code);
    if (rooms.has(room.code)) io.to(room.code).emit('state', room.publicState());
  });
}

function createRoom() {
  const code = newCode();
  const room = new Room(code, {
    onChange: broadcast,
    onEvent: (type, payload) => io.to(code).emit('event', { type, ...payload }),
  });
  rooms.set(code, room);
  return room;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.hasConnected() && now - room.lastActivity > ROOM_IDLE_MS) { room.destroy(); rooms.delete(code); }
  }
}, 60 * 1000).unref();

// ------------------------------------------------------------------ sockets
io.on('connection', (socket) => {
  const ack = (fn, res) => { if (typeof fn === 'function') fn(res); };

  function enter(room, seat) {
    socket.data.code = room.code;
    socket.data.token = seat.token;
    socket.join(room.code);
    room.connect(seat.token, socket.id);
    socket.emit('catalog', CATALOG);
    socket.emit('state', room.publicState());
    return { ok: true, code: room.code, token: seat.token, seatId: seat.id };
  }

  socket.on('room:create', (p = {}, cb) => {
    if (rooms.size >= MAX_ROOMS) return ack(cb, { error: 'Server is full, try again later' });
    const room = createRoom();
    const seat = room.addSeat(p.name);
    ack(cb, enter(room, seat));
  });

  socket.on('room:join', (p = {}, cb) => {
    const room = rooms.get(String(p.code || '').toUpperCase().trim());
    if (!room) return ack(cb, { error: 'Room not found. Check the code — rooms disappear if the server restarts.' });
    let seat = p.token && room.seats.get(p.token);
    if (!seat) {
      if (room.seats.size >= 30) return ack(cb, { error: 'Room is full' });
      seat = room.addSeat(p.name); // late joiners become spectators unless a team is free in the lobby
    }
    ack(cb, enter(room, seat));
  });

  // Every gameplay action goes through here: resolve room + seat, run, ack the result.
  const on = (event, handler) => socket.on(event, (payload = {}, cb) => {
    const room = rooms.get(socket.data.code);
    const seat = room && room.seats.get(socket.data.token);
    if (!room || !seat) return ack(cb, { error: 'Not in a room' });
    try { ack(cb, handler(room, seat, payload || {}) || { ok: true }); }
    catch (e) { console.error(event, e); ack(cb, { error: 'Server error' }); }
  });

  const myTeam = (room, seat) => (seat.teamId && room.teams[seat.teamId]) || null;
  const needTeam = (room, seat) => {
    const t = myTeam(room, seat);
    if (!t) return { error: 'You are spectating — no team to act for' };
    return t;
  };

  on('team:claim', (room, seat, p) => room.claimTeam(seat.token, p.teamId));
  on('team:release', (room, seat) => room.releaseTeam(seat.token));
  on('settings:update', (room, seat, p) => room.updateSettings(seat.token, p));
  on('game:start', (room, seat) => room.startGame(seat.token));
  on('retention:submit', (room, seat, p) => room.submitRetention(seat.token, p));
  on('retention:force', (room, seat) => room.forceStart(seat.token));
  on('nomination:submit', (room, seat, p) => room.submitNominations(seat.token, p.ids));
  on('host:pause', (room, seat) => room.pause(seat.token));
  on('host:resume', (room, seat) => room.resume(seat.token));
  on('host:kick', (room, seat, p) => {
    const res = room.kick(seat.token, p.seatId);
    if (res.ok) for (const s of io.sockets.adapter.rooms.get(room.code) || []) {
      const sock = io.sockets.sockets.get(s);
      if (sock && sock.data.token === res.removedToken) { sock.emit('kicked'); sock.leave(room.code); sock.data.code = null; }
    }
    return res.error ? res : { ok: true };
  });
  on('autopass', (room, seat, p) => room.setAutoPass(seat.token, p.on));
  on('chat', (room, seat, p) => room.addChat(seat.token, p.text));
  on('react', (room, seat, p) => {
    const emoji = ['🔥', '😱', '😂', '👏', '💸', '🤯', '😤', '🙏'].includes(p.emoji) ? p.emoji : null;
    if (emoji) io.to(room.code).emit('event', { type: 'reaction', emoji, from: seat.name });
    return { ok: true };
  });

  on('bid', (room, seat, p) => {
    const t = needTeam(room, seat); if (t.error) return t;
    return room.bid(t.id, p.amount == null ? null : Number(p.amount), 'human');
  });
  on('pass', (room, seat) => { const t = needTeam(room, seat); return t.error ? t : room.pass(t.id); });
  on('rtm:decide', (room, seat, p) => { const t = needTeam(room, seat); return t.error ? t : room.rtmDecide(t.id, !!p.use); });
  on('rtm:raise', (room, seat, p) => { const t = needTeam(room, seat); return t.error ? t : room.rtmRaise(t.id, p.amount == null ? null : Number(p.amount)); });
  on('rtm:match', (room, seat, p) => { const t = needTeam(room, seat); return t.error ? t : room.rtmMatch(t.id, !!p.match); });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (room && socket.data.token) room.disconnect(socket.data.token, socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`IPL Auction server on http://localhost:${PORT}`));
