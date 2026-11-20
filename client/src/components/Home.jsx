import React, { useState } from 'react';
import { send, savedName } from '../socket.js';
import { useGame } from './ui.jsx';

export default function Home() {
  const { enterRoom, toast, connected, session } = useGame();
  const params = new URLSearchParams(window.location.search);
  const [name, setName] = useState(savedName.get());
  const [code, setCode] = useState((params.get('room') || '').toUpperCase());
  const [busy, setBusy] = useState(false);

  const go = async (kind) => {
    const n = name.trim();
    if (!n) return toast('Enter your name first', 'error');
    if (kind === 'join' && code.trim().length < 4) return toast('Enter the room code', 'error');
    savedName.set(n);
    setBusy(true);
    const res = await send(kind === 'create' ? 'room:create' : 'room:join', { name: n, code: code.trim().toUpperCase() });
    setBusy(false);
    if (res.error) return toast(res.error, 'error');
    enterRoom(res, n);
  };

  return (
    <main className="home">
      <section className="hero card">
        <div className="hero-badge">MULTIPLAYER · v4</div>
        <h1>IPL AUCTION<br /><span className="hl">ROOM</span></h1>
        <p className="lead">Grab a franchise, invite your friends, and fight it out paddle-for-paddle. Every franchise nobody picks is run by a cut-throat AI that bluffs, price-pushes and snipes.</p>
        <ul className="hero-points">
          <li>⚡ Live bidding with a shared server clock</li>
          <li>🧠 AI fills empty teams — and covers you if you drop</li>
          <li>🃏 Mega auction with retentions &amp; Right to Match, or the 2026 mini auction</li>
        </ul>
      </section>

      <section className="card join-card">
        {session && !connected && <p className="note">Reconnecting to room {session.code}…</p>}
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pratham" onKeyDown={(e) => e.key === 'Enter' && go(code ? 'join' : 'create')} />
        </label>
        <button type="button" className="btn btn-primary btn-lg" disabled={busy || !connected} onClick={() => go('create')}>Create a room</button>
        <div className="or"><span>or join one</span></div>
        <label className="field">
          <span>Room code</span>
          <input value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE" className="code-input" onKeyDown={(e) => e.key === 'Enter' && go('join')} />
        </label>
        <button type="button" className="btn btn-lg" disabled={busy || !connected} onClick={() => go('join')}>Join room</button>
        {!connected && <p className="note">Connecting to server…</p>}
      </section>
    </main>
  );
}
