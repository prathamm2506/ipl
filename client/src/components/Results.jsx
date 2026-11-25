import React, { useMemo, useState } from 'react';
import { useGame, TopBar, TeamChip, SquadList, SquadStats, PlayerLine } from './ui.jsx';
import { fmt, cls } from '../util.js';

/* ---------- XI rules (tweak to match your data) ---------- */
const XI_SIZE = 11;
const MAX_OVERSEAS = 4;
const MIN_BOWLERS = 5;
const isOverseas = (p) => p.overseas ?? p.nat !== 'IND';
const isKeeper = (p) => /wk|keeper/i.test(p.role);
const canBowl = (p) => /bowl|all/i.test(p.role);

function validateXI(ids, players) {
  const ps = ids.map((id) => players[id]);
  const errs = [];
  if (ps.length !== XI_SIZE) errs.push(`Pick exactly ${XI_SIZE} players (${ps.length} selected)`);
  const os = ps.filter(isOverseas).length;
  if (os > MAX_OVERSEAS) errs.push(`Max ${MAX_OVERSEAS} overseas (${os} selected)`);
  if (ps.length && !ps.some(isKeeper)) errs.push('Need at least 1 wicketkeeper');
  if (ps.filter(canBowl).length < MIN_BOWLERS) errs.push(`Need at least ${MIN_BOWLERS} bowling options`);
  return errs;
}

// Use the SAME formula that produces summary.xiRating so numbers stay comparable.
function rateXI(ids, players) {
  const total = ids.reduce((sum, id) => sum + (players[id].rating ?? 0), 0);
  return Math.round(total / XI_SIZE); // empty slots count as 0
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Results() {
  const { game, catalog, myTeam, leave, submitXI } = useGame(); // submitXI optional (multiplayer sync)
  const players = catalog.players;
  const teams = Object.fromEntries(game.teams.map((t) => [t.id, t]));

  /* ---------- XI selection state ---------- */
  const [picks, setPicks] = useState(() =>
    Object.fromEntries(game.summary.map((s) => [s.id, s.bestXI.slice()])));
  const [locked, setLocked] = useState(() =>
    Object.fromEntries(game.teams.map((t) => [t.id, !t.ownerName]))); // AI teams auto-locked

  // Server copy (if you sync) wins over local state
  const xiOf = (id) => game.xi?.[id] ?? picks[id] ?? [];
  const isLocked = (id) => !!game.xi?.[id] || !!locked[id];
  const canEdit = (id) => !isLocked(id) && (myTeam ? id === myTeam.id : !!teams[id].ownerName);

  const togglePlayer = (teamId, pid) => setPicks((prev) => {
    const cur = prev[teamId] ?? [];
    if (cur.includes(pid)) return { ...prev, [teamId]: cur.filter((x) => x !== pid) };
    if (cur.length >= XI_SIZE) return prev;
    return { ...prev, [teamId]: [...cur, pid] };
  });
  const setXI = (teamId, ids) => setPicks((prev) => ({ ...prev, [teamId]: ids }));
  const lockXI = (teamId) => {
    submitXI?.(teamId, xiOf(teamId));
    setLocked((prev) => ({ ...prev, [teamId]: true }));
  };

  /* ---------- Rankings based on picked XI ---------- */
  const ranked = useMemo(() => game.summary.map((s) => {
    const xi = xiOf(s.id);
    const errors = validateXI(xi, players);
    return {
      ...s, xi, errors,
      valid: errors.length === 0,
      locked: isLocked(s.id),
      rating: rateXI(xi, players),
    };
  }).sort((a, b) => (b.valid - a.valid) || (b.rating - a.rating)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [game.summary, game.xi, picks, locked, players]);

  const allLocked = ranked.every((r) => r.locked);
  const [sel, setSel] = useState(myTeam?.id || ranked[0]?.id);
  const selRow = ranked.find((r) => r.id === sel);
  const top = game.sales.slice().sort((a, b) => b.price - a.price).slice(0, 10);

  /* ---------- Exports ---------- */
  const exportCSV = () => {
    const rows = [['Team', 'Player', 'Role', 'Nationality', 'Price (L)', 'How', 'In XI']];
    game.teams.forEach((t) => {
      const xi = xiOf(t.id);
      t.squad.forEach((s) => {
        const p = players[s.pid];
        rows.push([t.id, p.name, p.role, p.nat, s.price, s.how, xi.includes(s.pid) ? 'Y' : '']);
      });
    });
    download(`auction-${game.code}.csv`,
      rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  const exportJSON = () => download(`auction-${game.code}.json`, JSON.stringify({
    code: game.code, mode: game.settings.mode,
    teams: game.teams.map((t) => ({
      id: t.id, owner: t.ownerName, purse: t.purse,
      playingXI: xiOf(t.id).map((id) => players[id].name),
      squad: t.squad.map((s) => ({ ...s, name: players[s.pid].name })),
    })),
  }, null, 2), 'application/json');

  /* ---------- Render ---------- */
  return (
    <div className="results">
      <TopBar title="AUCTION COMPLETE" onLeave={leave} />

      <section className="card">
        <h2>🏆 Power rankings {allLocked ? '(final)' : '(provisional – waiting for XIs)'}</h2>
        <table className="rank-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th><th>Manager</th><th>XI rating</th><th>XI status</th>
              <th>Squad</th><th>Spent at auction</th><th>Purse left</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.id} className={cls(sel === r.id && 'selected')} onClick={() => setSel(r.id)}>
                <td>{r.valid ? i + 1 : '—'}</td>
                <td><TeamChip team={teams[r.id]} /></td>
                <td>{teams[r.id].ownerName || '🤖 AI'}</td>
                <td><strong>{r.valid ? r.rating : '—'}</strong></td>
                <td>{r.locked ? (r.valid ? '✅ Locked' : '⚠️ Invalid') : '✏️ Picking…'}</td>
                <td>{r.size}</td>
                <td>{fmt(r.spent)}</td>
                <td>{fmt(r.purseLeft)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button type="button" onClick={exportCSV}>Download CSV</button>
          <button type="button" onClick={exportJSON}>Download JSON</button>
          <button type="button" onClick={leave}>New game</button>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Biggest buys</h3>
          {top.map((s, i) => (
            <PlayerLine
              key={i}
              p={players[s.pid]}
              right={<><strong>{fmt(s.price)}</strong>{s.how === 'rtm' && <em> RTM</em>}</>}
            />
          ))}
        </section>

        {sel && selRow && (
          <section className="card">
            <h3>{teams[sel].name}</h3>
            <SquadStats team={teams[sel]} />

            {canEdit(sel) ? (
              <XIPicker
                team={teams[sel]}
                players={players}
                xi={selRow.xi}
                errors={selRow.errors}
                rating={selRow.rating}
                onToggle={(pid) => togglePlayer(sel, pid)}
                onAuto={() => setXI(sel, selRow.bestXI.slice())}
                onClear={() => setXI(sel, [])}
                onLock={() => lockXI(sel)}
              />
            ) : (
              <>
                <h4>Playing XI {selRow.locked ? '🔒' : ''}</h4>
                <ol>{selRow.xi.map((id) => <li key={id}>{players[id].name}</li>)}</ol>
                <h4>Full squad</h4>
                <SquadList team={teams[sel]} />
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function XIPicker({ team, players, xi, errors, rating, onToggle, onAuto, onClear, onLock }) {
  const overseas = xi.filter((id) => isOverseas(players[id])).length;
  return (
    <div className="xi-picker">
      <h4>Pick your playing XI</h4>
      <p>
        <strong>{xi.length}/{XI_SIZE}</strong> selected · {overseas}/{MAX_OVERSEAS} overseas ·
        rating <strong>{rating}</strong>
      </p>

      <ul className="xi-list">
        {team.squad.map((s) => {
          const p = players[s.pid];
          const on = xi.includes(s.pid);
          const full = !on && xi.length >= XI_SIZE;
          const osBlocked = !on && isOverseas(p) && overseas >= MAX_OVERSEAS;
          return (
            <li key={s.pid} className={cls(on && 'in-xi')}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={full || osBlocked}
                  onChange={() => onToggle(s.pid)}
                />
                <PlayerLine p={p} right={isOverseas(p) ? '✈️' : ''} />
              </label>
            </li>
          );
        })}
      </ul>

      {errors.length > 0 && (
        <ul className="xi-errors" aria-live="polite">
          {errors.map((e) => <li key={e}>⚠️ {e}</li>)}
        </ul>
      )}

      <div className="actions">
        <button type="button" onClick={onAuto}>Use auto best XI</button>
        <button type="button" onClick={onClear}>Clear</button>
        <button type="button" onClick={onLock} disabled={errors.length > 0}>🔒 Lock in XI</button>
      </div>
    </div>
  );
}
