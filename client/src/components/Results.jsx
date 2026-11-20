import React, { useMemo, useState } from 'react';
import { useGame, TopBar, TeamChip, SquadList, SquadStats, PlayerLine } from './ui.jsx';
import { fmt, cls } from '../util.js';

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Results() {
  const { game, catalog, myTeam, leave } = useGame();
  const players = catalog.players;
  const teams = Object.fromEntries(game.teams.map((t) => [t.id, t]));
  const ranked = useMemo(() => game.summary.slice().sort((a, b) => b.xiRating - a.xiRating), [game.summary]);
  const [sel, setSel] = useState(myTeam?.id || ranked[0]?.id);
  const top = game.sales.slice().sort((a, b) => b.price - a.price).slice(0, 10);
  const selSum = game.summary.find((s) => s.id === sel);

  const exportCSV = () => {
    const rows = [['Team', 'Player', 'Role', 'Nationality', 'Price (L)', 'How']];
    game.teams.forEach((t) => t.squad.forEach((s) => { const p = players[s.pid]; rows.push([t.id, p.name, p.role, p.nat, s.price, s.how]); }));
    download(`auction-${game.code}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  const exportJSON = () => download(`auction-${game.code}.json`, JSON.stringify({ code: game.code, mode: game.settings.mode, teams: game.teams.map((t) => ({ id: t.id, owner: t.ownerName, purse: t.purse, squad: t.squad.map((s) => ({ ...s, name: players[s.pid].name })) })) }, null, 2), 'application/json');

  return (
    <div className="page">
      <TopBar><span className="phase-pill">AUCTION COMPLETE</span></TopBar>
      <main className="results">
        <section className="card">
          <h2>🏆 Power rankings (best XI, max 4 overseas)</h2>
          <table className="rank">
            <thead><tr><th>#</th><th>Team</th><th>Manager</th><th>XI rating</th><th>Squad</th><th>Spent at auction</th><th>Purse left</th></tr></thead>
            <tbody>
              {ranked.map((s, i) => (
                <tr key={s.id} className={cls(sel === s.id && 'selected', teams[s.id].ownerId && 'human')} onClick={() => setSel(s.id)}>
                  <td>{i + 1}</td><td><TeamChip team={teams[s.id]} size="sm" /></td><td>{teams[s.id].ownerName || '🤖 AI'}</td>
                  <td className="mono"><b>{s.xiRating}</b></td><td className={cls('mono', s.size < 18 && 'low')}>{s.size}</td><td className="mono">{fmt(s.spent)}</td><td className="mono">{fmt(s.purseLeft)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            <button type="button" className="btn" onClick={exportCSV}>Download CSV</button>
            <button type="button" className="btn" onClick={exportJSON}>Download JSON</button>
            <button type="button" className="btn btn-primary" onClick={leave}>New game</button>
          </div>
        </section>
        <section className="card">
          <h2>Biggest buys</h2>
          {top.map((s, i) => <PlayerLine key={i} p={players[s.pid]} right={<><TeamChip team={teams[s.team]} size="sm" /> <b>{fmt(s.price)}</b>{s.how === 'rtm' && <em className="tag tag-rtm">RTM</em>}</>} />)}
        </section>
        {sel && (
          <section className="card wide">
            <h2><TeamChip team={teams[sel]} /> {teams[sel].name}</h2>
            <SquadStats team={teams[sel]} players={players} />
            <h3>Best XI</h3>
            <div className="xi">{selSum?.bestXI.map((id) => <span key={id} className="xi-chip">{players[id].name}</span>)}</div>
            <h3>Full squad</h3>
            <SquadList team={teams[sel]} players={players} />
          </section>
        )}
      </main>
    </div>
  );
}
