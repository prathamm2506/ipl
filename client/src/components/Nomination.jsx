import React, { useMemo, useState } from 'react';
import { useGame, TopBar, PlayerLine, TeamChip, Countdown } from './ui.jsx';
import { fmt, cls } from '../util.js';

export default function Nomination() {
  const { game, catalog, myTeam, act } = useGame();
  const players = catalog.players;
  const [picked, setPicked] = useState([]);
  const [role, setRole] = useState('ALL');
  const [q, setQ] = useState('');
  const pool = useMemo(() => game.nominationPool.map((id) => players[id]).sort((a, b) => b.rating - a.rating), [game.nominationPool, players]);
  const shown = pool.filter((p) => (role === 'ALL' || p.role === role) && p.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 8 ? [...p, id] : p));

  return (
    <div className="page">
      <TopBar><span className="phase-pill">NOMINATIONS · ACCELERATED ROUND</span></TopBar>
      <main className="retention">
        <section className="card">
          <h2>Bring back unsold players</h2>
          <p className="sub">Pick up to 8. Everything nominated by any team returns in the accelerated round (faster timer).</p>
          <Countdown deadline={game.deadline} total={game.deadlineTotal} paused={game.paused} pausedRemaining={game.pausedRemaining} label="Closes in" />
          {myTeam && !myTeam.nominationSubmitted ? (
            <>
              <div className="row gap wrap">
                <div className="seg">{['ALL', 'BAT', 'WK', 'AR', 'PACE', 'SPIN'].map((r) => <button type="button" key={r} className={cls(role === r && 'on')} onClick={() => setRole(r)}>{r}</button>)}</div>
                <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="option-list">
                {shown.map((p) => <PlayerLine key={p.id} p={p} active={picked.includes(p.id)} onClick={() => toggle(p.id)} right={fmt(p.base)} />)}
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={() => act('nomination:submit', { ids: picked })}>Submit {picked.length} nomination{picked.length === 1 ? '' : 's'}</button>
            </>
          ) : <p className="note">{myTeam ? `Submitted ${myTeam.nominations.length} nominations ✅` : 'Spectating'} — waiting for others…</p>}
        </section>
        <section className="card status-board">
          <h3>Status</h3>
          <ul>{game.teams.map((t) => <li key={t.id}><TeamChip team={t} size="sm" /> {t.ownerName || 'AI'} — {t.nominationSubmitted ? `✅ ${t.nominations.length}` : '⏳'}</li>)}</ul>
        </section>
      </main>
    </div>
  );
}
