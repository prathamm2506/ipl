import React, { useContext, useEffect, useState } from 'react';
import { GameContext } from '../context.js';
import { fmt, FLAGS, ROLE_SHORT, cls } from '../util.js';

export const useGame = () => useContext(GameContext);

export function TeamChip({ team, size = 'md', onClick }) {
  if (!team) return <span className="chip chip-empty">—</span>;
  return (
    <span className={cls('team-chip', `tc-${size}`, onClick && 'clickable')} style={{ background: team.color, color: team.ink }} onClick={onClick} title={team.name}>
      {team.id}
    </span>
  );
}

export function RoleTag({ role }) { return <span className={`role role-${role}`}>{ROLE_SHORT[role]}</span>; }

export function PlayerLine({ p, right, muted, onClick, active }) {
  return (
    <div className={cls('pline', muted && 'muted', onClick && 'clickable', active && 'active')} onClick={onClick}>
      <RoleTag role={p.role} />
      <span className="pname">{p.name}</span>
      <span className="pmeta">{FLAGS[p.nat] || p.nat}{p.overseas ? ' ✈' : ''} · {p.capped ? 'Capped' : 'Uncapped'} · {p.age}y</span>
      <span className="prating" title="AI rating">{p.rating}</span>
      {right != null && <span className="pright">{right}</span>}
    </div>
  );
}

/** Live countdown against the server clock. */
export function Countdown({ deadline, total, paused, pausedRemaining, label }) {
  const { offset } = useGame();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  if (!deadline && !paused) return null;
  const left = paused ? pausedRemaining || 0 : Math.max(0, deadline - (now + offset.current));
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  return (
    <div className={cls('countdown', left < 3000 && !paused && 'urgent')}>
      <div className="cd-bar" style={{ width: `${pct}%` }} />
      <span className="cd-text">{paused ? '⏸ PAUSED' : `${label ? label + ' · ' : ''}${(left / 1000).toFixed(1)}s`}</span>
    </div>
  );
}

export function Money({ v, big }) { return <span className={cls('money', big && 'money-big')}>{fmt(v)}</span>; }

export function Toasts({ toasts }) {
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}</div>;
}

export function Reactions({ items }) {
  return <div className="reactions" aria-hidden>{items.map((r) => <div key={r.id} className="float-emoji" style={{ left: `${r.x}%` }}><span>{r.emoji}</span><small>{r.from}</small></div>)}</div>;
}

export function TopBar({ children }) {
  const { game, leave, sound, setSound, connected } = useGame();
  return (
    <header className="topbar">
      <div className="brand">🏏 <b>AUCTION ROOM</b></div>
      {game && <div className="room-code" title="Room code">ROOM <b>{game.code}</b></div>}
      <div className="topbar-mid">{children}</div>
      <span className={cls('dot', connected ? 'dot-on' : 'dot-off')} title={connected ? 'Connected' : 'Reconnecting'} />
      <button type="button" className="btn btn-sm" onClick={() => setSound(!sound)} aria-label="Toggle sound">{sound ? '🔊' : '🔇'}</button>
      <button type="button" className="btn btn-sm" onClick={() => { if (confirm('Leave this room? You can rejoin with the same code from this browser.')) leave(); }}>Leave</button>
    </header>
  );
}

export function SquadList({ team, players, compact }) {
  const sq = team.squad.map((s) => ({ ...s, p: players[s.pid] })).sort((a, b) => b.price - a.price);
  if (!sq.length) return <p className="empty">No players yet.</p>;
  return (
    <div className={cls('squad-list', compact && 'compact')}>
      {sq.map((s) => (
        <PlayerLine key={s.pid} p={s.p} right={<>{fmt(s.price)}{s.how === 'rtm' && <em className="tag tag-rtm">RTM</em>}{s.how === 'retained' && <em className="tag">RET</em>}</>} />
      ))}
    </div>
  );
}

export function SquadStats({ team, players }) {
  const c = { BAT: 0, WK: 0, AR: 0, PACE: 0, SPIN: 0 };
  team.squad.forEach((s) => c[players[s.pid].role]++);
  return (
    <div className="squad-stats">
      {Object.entries(c).map(([k, v]) => <span key={k} className={`role role-${k}`}>{k} {v}</span>)}
      <span className="stat">✈ {team.overseas}/8</span>
      <span className="stat">👥 {team.squad.length}/25</span>
    </div>
  );
}
