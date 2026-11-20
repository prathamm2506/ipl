import React, { useMemo, useState } from 'react';
import { useGame, TopBar, PlayerLine, TeamChip } from './ui.jsx';
import { fmt, RETAIN_SLABS, cls } from '../util.js';

function StatusBoard() {
  const { game, me, act } = useGame();
  return (
    <section className="card status-board">
      <h3>Who's ready</h3>
      <ul>
        {game.teams.filter((t) => t.ownerId).map((t) => (
          <li key={t.id}><TeamChip team={t} size="sm" /> {t.ownerName} — {t.retentionSubmitted ? '✅ locked in' : '⏳ choosing'}</li>
        ))}
        <li className="muted">AI teams use their official retentions.</li>
      </ul>
      {me?.isHost && <button type="button" className="btn" onClick={() => { if (confirm('Start now? Anyone not locked in gets their official retentions.')) act('retention:force'); }}>Host: start auction now</button>}
    </section>
  );
}

function MegaRetention({ team }) {
  const { catalog, act } = useGame();
  const players = catalog.players;
  const options = useMemo(() => players.filter((p) => p.t24 === team.id && !p.notInMega).sort((a, b) => b.rating - a.rating), [players, team.id]);
  const official = useMemo(() => players.filter((p) => p.t25 === team.id && p.r25).sort((a, b) => b.p25 - a.p25).map((p) => p.id), [players, team.id]);
  const [picked, setPicked] = useState([]);

  const capped = picked.filter((id) => players[id].capped);
  const uncapped = picked.filter((id) => !players[id].capped);
  const costOf = (id) => (players[id].capped ? RETAIN_SLABS[capped.indexOf(id)] : 400);
  const total = picked.reduce((s, id) => s + costOf(id), 0);
  const err = picked.length > 6 ? 'Max 6 retentions' : capped.length > 5 ? 'Max 5 capped' : uncapped.length > 2 ? 'Max 2 uncapped' : null;

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const canAdd = (p) => picked.length < 6 && (p.capped ? capped.length < 5 : uncapped.length < 2);

  return (
    <div className="retention-grid">
      <section className="card">
        <h2>Retain from your 2024 squad</h2>
        <p className="sub">Capped players cost ₹18 / 14 / 11 / 18 / 14 Cr in the order you pick them; uncapped cost ₹4 Cr. Everyone you release goes into the auction — you can win them back with RTM.</p>
        <div className="row gap">
          <button type="button" className="btn btn-sm" onClick={() => setPicked(official)}>Use real 2025 retentions</button>
          <button type="button" className="btn btn-sm" onClick={() => setPicked([])}>Release everyone</button>
        </div>
        <div className="option-list">
          {options.map((p) => {
            const on = picked.includes(p.id);
            return (
              <PlayerLine key={p.id} p={p} active={on} muted={!on && !canAdd(p)} onClick={() => (on || canAdd(p)) && toggle(p.id)}
                right={on ? <b>{fmt(costOf(p.id))}</b> : official.includes(p.id) ? <em className="tag">real ret.</em> : null} />
            );
          })}
        </div>
      </section>
      <aside className="card sticky">
        <h3>Your retentions</h3>
        <ol className="picked">
          {picked.map((id) => <li key={id}>{players[id].name} <b>{fmt(costOf(id))}</b></li>)}
          {!picked.length && <li className="muted">None — full ₹120 Cr purse and 6 RTM cards</li>}
        </ol>
        <dl className="kv">
          <dt>Retention cost</dt><dd>{fmt(total)}</dd>
          <dt>Auction purse</dt><dd><b>{fmt(12000 - total)}</b></dd>
          <dt>RTM cards</dt><dd>{6 - picked.length} (capped {5 - capped.length}, uncapped {2 - uncapped.length})</dd>
        </dl>
        {err && <p className="error">{err}</p>}
        <button type="button" className="btn btn-primary btn-block" disabled={!!err} onClick={() => act('retention:submit', { retain: picked })}>Lock in retentions</button>
      </aside>
    </div>
  );
}

function MiniRetention({ team, teamMeta }) {
  const { catalog, act } = useGame();
  const players = catalog.players;
  const squad = useMemo(() => players.filter((p) => p.t26 === team.id).sort((a, b) => b.p26 - a.p26), [players, team.id]);
  const [released, setReleased] = useState([]);
  const kept = squad.filter((p) => !released.includes(p.id));
  const freed = squad.filter((p) => released.includes(p.id)).reduce((s, p) => s + p.p26, 0);
  const os = kept.filter((p) => p.overseas).length;
  const toggle = (id) => setReleased((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  return (
    <div className="retention-grid">
      <section className="card">
        <h2>Your 2026 squad — keep or release</h2>
        <p className="sub">Releasing a player adds their salary back to your purse and puts them in the auction pool, where anyone can buy them.</p>
        <div className="option-list">
          {squad.map((p) => {
            const rel = released.includes(p.id);
            return (
              <PlayerLine key={p.id} p={p} muted={rel} onClick={() => toggle(p.id)}
                right={<span className={cls('keep', rel ? 'is-rel' : 'is-keep')}>{rel ? 'RELEASE' : 'KEEP'} · {fmt(p.p26)}</span>} />
            );
          })}
        </div>
      </section>
      <aside className="card sticky">
        <h3>Summary</h3>
        <dl className="kv">
          <dt>Official purse</dt><dd>{fmt(teamMeta.purse26)}</dd>
          <dt>Freed by releases</dt><dd>+{fmt(freed)}</dd>
          <dt>Auction purse</dt><dd><b>{fmt(teamMeta.purse26 + freed)}</b></dd>
          <dt>Squad kept</dt><dd>{kept.length} / 25</dd>
          <dt>Overseas</dt><dd>{os} / 8</dd>
          <dt>Slots to fill (to 18)</dt><dd>{Math.max(0, 18 - kept.length)}</dd>
        </dl>
        <button type="button" className="btn btn-primary btn-block" onClick={() => act('retention:submit', { release: released })}>Confirm squad</button>
      </aside>
    </div>
  );
}

export default function Retention() {
  const { game, myTeam, catalog } = useGame();
  const mega = game.settings.mode === 'mega';
  const teamMeta = myTeam && catalog.teams.find((t) => t.id === myTeam.id);
  return (
    <div className="page">
      <TopBar><span className="phase-pill">RETENTION · {mega ? 'MEGA 2025' : 'MINI 2026'}</span></TopBar>
      <main className="retention">
        {!myTeam && <section className="card"><h2>You're spectating</h2><p>Waiting for players to lock in their squads…</p></section>}
        {myTeam && myTeam.retentionSubmitted && (
          <section className="card done-card">
            <h2><TeamChip team={myTeam} /> Locked in!</h2>
            <p>{myTeam.squad.length} players kept · purse {fmt(myTeam.purse)}{mega && ` · ${myTeam.rtm.total} RTM cards`}</p>
            <p className="sub">The auction starts as soon as everyone is ready.</p>
          </section>
        )}
        {myTeam && !myTeam.retentionSubmitted && (mega ? <MegaRetention team={myTeam} /> : <MiniRetention team={myTeam} teamMeta={teamMeta} />)}
        <StatusBoard />
      </main>
    </div>
  );
}
