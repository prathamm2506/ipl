import { io } from 'socket.io-client';

// Same origin in production (the Node server serves this app). Set VITE_SERVER_URL only if you host the client elsewhere.
export const socket = io(import.meta.env.VITE_SERVER_URL || undefined, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
});

/** Emit with an acknowledgement; always resolves to { ok } or { error }. */
export function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { error: 'Server did not respond' } : res || { ok: true }));
  });
}

const KEY = 'ipl-auction-session';
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
  set(v) { localStorage.setItem(KEY, JSON.stringify(v)); },
  clear() { localStorage.removeItem(KEY); },
};
export const savedName = {
  get: () => localStorage.getItem('ipl-auction-name') || '',
  set: (n) => localStorage.setItem('ipl-auction-name', n),
};
