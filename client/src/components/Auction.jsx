import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, TopBar, TeamChip, RoleTag, Countdown, PlayerLine, SquadList, SquadStats } from './ui.jsx';
import { fmt, stepsAbove, snapUp, ROLE_LABEL, FLAGS, cls } from '../util.js';

const EMOJIS = ['🔥', '😱', '😂', '👏', '💸', '🤯', '😤', '🙏'];

function useTeams() {
  const { game } = useGame();
  return useMemo(() => Object.fromEntries(game.teams.map((t) => [t.id, t])), [game.teams]);
}

function LotStage() {
  const { game, catalog } = useGame();
  const teams = useTeams();
  const lot = game.lot;
  if (!lot) {
    return (
      <section className="card stage stage-idle">
        <h2>{game.remaining ? 'Next player coming up…' : 'Wrapping up the round…'}</h2>
        <Countdown deadline={game.deadline} total={game.deadlineTotal} paused={game.paused} pausedRemaining={game.pausedRemaining} />
      </section>
    );
  }
  const p = catalog.players[lot.pid];
  const leader = lot.leader && teams[lot.leader];
  const mega = game.settings.mode === 'mega';
  const prev = mega ? p.t24 : p.t25;
  const prevTeam = prev && teams[prev];
  const rtmOk = mega && prevTeam && prevTeam.rtm.total > 0 && (p.capped ? prevTeam.rtm.capped > 0 : prevTeam.rtm.uncapped > 0);
  const res = lot.result;

  return (
    <section className={cls('card stage', lot.status === 'rtm' && 'stage-rtm')} style={leader ? { '--lead': leader.color } : undefined}>
      <div className="stage-head">
        <span className="set-pill">{lot.set}</span>
        <span className="muted">{game.remaining} left in queue</span>
      </div>
      <div className="stage-body">
        <div className="player-card">
          <div className="pc-top">
            <RoleTag role={p.role} />
            <span className="pc-flag">{FLAGS[p.nat] || p.nat} {p.nat}{p.overseas && ' · OVERSEAS'}</span>
          </div>
          <h1 className="pc-name">{p.name}</h1>
          <div className="pc-facts">
            <span>{ROLE_LABEL[p.role]}</span><span>{p.capped ? 'Capped' : 'Uncapped'}</span><span>Age {p.age}</span>
          </div>
          <div className="rating"><span>Rating</span><div className="rbar"><i style={{ width: `${p.rating}%` }} /></div><b>{p.rating}</b></div>
          <div className="pc-foot">
            <span>Base <b>{fmt(lot.base)}</b></span>
            {prevTeam && <span>{mega ? '2024' : '2025'}: <TeamChip team={prevTeam} size="sm" />{rtmOk && <em className="tag tag-rtm">RTM eligible</em>}</span>}
          </div>
        </div>

        <div className="bid-display">
          <span className="bd-label">{lot.bid == null ? 'Opening at' : 'Current bid'}</span>
          <div className="bd-amount">{fmt(lot.bid ?? lot.base)}</div>
          <div className="bd-leader">{leader ? <><TeamChip team={leader} size="lg" /><span>{leader.ownerName ? `👤 ${leader.ownerName}` : '🤖 AI'}</span></> : <span className="muted">No bids yet</span>}</div>
          {lot.status === 'bidding' && (
            <>
              <Countdown deadline={game.deadline} total={game.deadlineTotal} paused={game.paused} pausedRemaining={game.pausedRemaining} label={lot.closing ? (lot.leader ? 'Going once… going twice…' : 'No takers…') : null} />
              {!!lot.passed.length && <div className="passed">Passed: {lot.passed.join(' · ')}</div>}
            </>
          )}
          {lot.status === 'rtm' && <RtmBanner lot={lot} teams={teams} />}
        </div>
      </div>
      {res && (
        <div className={cls('stamp', res.type === 'sold' ? 'stamp-sold' : 'stamp-unsold')}>
          {res.type === 'sold' ? <>SOLD · {res.team} · {fmt(res.price)}{res.how === 'rtm' && ' · RTM'}</> : 'UNSOLD'}
          {res.bcci > 0 && <small>{fmt(res.bcci)} to BCCI (overseas cap)</small>}
        </div>
      )}
    </section>
  );
}

function RtmBanner({ lot, teams }) {
  const { game, myTeam, act } = useGame();
  const rt = lot.rtm;
  const [raise, setRaise] = useState('');
  const actor = rt.stage === 'raise' ? rt.winner : rt.team;
  const mine = myTeam && myTeam.id === actor;
  const text = rt.stage === 'offer' ? `${rt.team} can use Right to Match at ${fmt(rt.price)}`
    : rt.stage === 'raise' ? `${rt.team} used RTM! ${rt.winner} gets one final raise`
    : `${rt.winner} raised to ${fmt(rt.price)} — will ${rt.team} match?`;
  const minRaise = stepsAbove(rt.price, 1);
  return (
    <div className="rtm-box">
      <b>🃏 RIGHT TO MATCH</b>
      <p>{text}</p>
      <Countdown deadline={game.deadline} total={game.deadlineTotal} paused={game.paused} pausedRemaining={game.pausedRemaining} />
      {mine && rt.stage === 'offer' && (
        <div className="row gap">
          <button type="button" className="btn btn-primary" onClick={() => act('rtm:decide', { use: true })}>Use RTM card</button>
          <button type="button" className="btn" onClick={() => act('rtm:decide', { use: false })}>Let it go</button>
        </div>
      )}
      {mine && rt.stage === 'raise' && (
        <div className="rtm-raise">
          <div className="row gap">
            {[1, 3, 6].map((n) => <button type="button" key={n} className="btn btn-sm" onClick={() => setRaise(String(stepsAbove(rt.price, n)))}>{fmt(stepsAbove(rt.price, n))}</button>)}
          </div>
          <div className="row gap">
            <input type="number" min={minRaise} step="5" placeholder={`Lakhs, min ${minRaise}`} value={raise} onChange={(e) => setRaise(e.target.value)} />
            <button type="button" className="btn btn-primary" onClick={() => act('rtm:raise', { amount: snapUp(Math.max(minRaise, +raise || minRaise), minRaise) })}>Raise</button>
            <button type="button" className="btn" onClick={() => act('rtm:raise', { amount: null })}>No raise (they get him)</button>
          </div>
          <small>If you don't raise, {rt.team} gets the player at {fmt(rt.price)}.</small>
        </div>
      )}
      {mine && rt.stage === 'match' && (
        <div className="row gap">
          <button type="button" className="btn btn-primary" onClick={() => act('rtm:match', { match: true })}>Match {fmt(rt.price)}</button>
          <button type="button" className="btn" onClick={() => act('rtm:match', { match: false })}>Don't match</button>
        </div>
      )}
      {!mine && <small className="muted">Waiting for {teams[actor]?.ownerName || `${actor} (AI)`}…</small>}
    </div>
  );
}

function BidPanel() {
  const { game, myTeam, me, act, catalog } = useGame();
  const [custom, setCustom] = useState('');
  const lot = game.lot;
  const inputRef = useRef(null);

  const p = lot && catalog.players[lot.pid];
  let reason = null;
  if (!myTeam) reason = 'You are spectating';
  else if (!lot || lot.status !== 'bidding') reason = lot?.status === 'rtm' ? 'RTM in progress' : 'Waiting for the next player';
  else if (game.paused) reason = 'Paused';
  else if (lot.leader === myTeam.id) reason = 'You hold the highest bid 🙌';
  else if (myTeam.squad.length >= 25) reason = 'Squad full (25)';
  else if (p.overseas && myTeam.overseas >= 8) reason = 'Overseas limit reached (8)';
  else if (lot.next > myTeam.maxBid) reason = `Can't afford — max bid ${fmt(myTeam.maxBid)}`;
  const can = !reason;
  const passed = myTeam && lot?.passed.includes(myTeam.id);

  const bid = (amount) => act('bid', { amount });
  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'b' || e.key === 'B') { if (can) bid(lot.next); }
      if (e.key === 'p' || e.key === 'P') { if (can && !passed) act('pass'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <section className="card bid-panel">
      {myTeam && (
        <div className="my-purse">
          <TeamChip team={myTeam} />
          <div><small>Purse</small><b>{fmt(myTeam.purse)}</b></div>
          <div><small>Max bid</small><b>{fmt(Math.max(0, myTeam.maxBid))}</b></div>
          <div><small>Squad</small><b>{myTeam.squad.length}/25</b></div>
          <div><small>Overseas</small><b>{myTeam.overseas}/8</b></div>
          {game.settings.mode === 'mega' && <div><small>RTM</small><b>{myTeam.rtm.total}</b></div>}
        </div>
      )}
      <button type="button" className="btn btn-bid" disabled={!can} onClick={() => bid(lot.next)}>
        {can ? <>BID {fmt(lot.next)} <kbd>B</kbd></> : reason}
      </button>
      <div className="row gap wrap">
        {[2, 4, 8].map((n) => {
          const amt = lot && (lot.bid == null ? stepsAbove(lot.base, n - 1) : stepsAbove(lot.bid, n));
          return <button type="button" key={n} className="btn btn-sm" disabled={!can || amt > myTeam?.maxBid} onClick={() => bid(amt)}>Jump {amt ? fmt(amt) : ''}</button>;
        })}
        <button type="button" className={cls('btn btn-sm', passed && 'on')} disabled={!can || passed} onClick={() => act('pass')}>{passed ? 'Passed' : 'Pass'} <kbd>P</kbd></button>
      </div>
      <form className="row gap" onSubmit={(e) => { e.preventDefault(); const v = Math.round(+custom); if (v > 0) { bid(v); setCustom(''); } }}>
        <input ref={inputRef} type="number" min="0" step="5" placeholder="Custom bid (lakhs)" value={custom} onChange={(e) => setCustom(e.target.value)} disabled={!can} />
        <button type="submit" className="btn btn-sm" disabled={!can || !custom}>Bid {custom ? fmt(+custom) : ''}</button>
      </form>
      {myTeam && (
        <label className="check">
          <input type="checkbox" checked={!!me?.autoPass} onChange={(e) => act('autopass', { on: e.target.checked })} />
          Auto-pass every new player (you can still bid any time) — speeds up lots you don't care about
        </label>
      )}
      {myTeam && myTeam.squad.length < 18 && <p className="warn-text">Need {18 - myTeam.squad.length} more to reach 18 · ₹30 L per empty slot is held back</p>}
      <div className="emoji-bar">
        {EMOJIS.map((em) => <button type="button" key={em} className="emoji" onClick={() => act('react', { emoji: em })}>{em}</button>)}
      </div>
    </section>
  );
}

function TeamsBoard({ onSelect, selected }) {
  const { game, me } = useGame();
  const lot = game.lot;
  return (
    <section className="card teams-board">
      <h3>Franchises</h3>
      <table>
        <thead><tr><th>Team</th><th>Purse</th><th>Sq</th><th>OS</th>{game.settings.mode === 'mega' && <th>RTM</th>}</tr></thead>
        <tbody>
          {game.teams.map((t) => (
            <tr key={t.id} className={cls(lot?.leader === t.id && 'leading', selected === t.id && 'selected', t.ownerId === me?.id && 'mine')} onClick={() => onSelect(t.id)}>
              <td><TeamChip team={t} size="sm" /> <span className="owner">{t.controlledBy === 'human' ? `👤 ${t.ownerName}` : t.ownerName ? (t.controlledBy === 'ai' ? `🤖 for ${t.ownerName}` : `💤 ${t.ownerName}`) : '🤖'}</span></td>
              <td className="mono">{fmt(t.purse)}</td>
              <td className={cls('mono', t.squad.length < 18 && 'low')}>{t.squad.length}</td>
              <td className="mono">{t.overseas}</td>
              {game.settings.mode === 'mega' && <td className="mono">{t.rtm.total}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <small className="muted">Tap a team to see its squad</small>
    </section>
  );
}

function Chat() {
  const { game, act } = useGame();
  const [text, setText] = useState('');
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [game.chat.length]);
  return (
    <div className="chat">
      <div className="chat-msgs" ref={box}>
        {game.chat.map((m, i) => <div key={i} className="msg"><b>{m.from}{m.team && ` (${m.team})`}:</b> {m.text}</div>)}
        {!game.chat.length && <p className="empty">Trash talk goes here 😈</p>}
      </div>
      <form className="row gap" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { act('chat', { text }); setText(''); } }}>
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Say something…" />
        <button type="submit" className="btn btn-sm">Send</button>
      </form>
    </div>
  );
}

function SidePanel({ selected }) {
  const { game, catalog, myTeam } = useGame();
  const teams = useTeams();
  const [tab, setTab] = useState('log');
  useEffect(() => { if (selected) setTab('squad'); }, [selected]);
  const players = catalog.players;
  const sel = selected ? teams[selected] : myTeam;
  const tabs = [['log', 'Log'], ['chat', `Chat${game.chat.length ? ` (${game.chat.length})` : ''}`], ['squad', sel ? `${sel.id} squad` : 'Squads'], ['next', 'Up next']];
  return (
    <section className="card side">
      <div className="tabs">{tabs.map(([k, l]) => <button type="button" key={k} className={cls(tab === k && 'on')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'log' && (
        <div className="log">
          {game.lot?.history.slice().reverse().map((h, i) => <div key={`h${i}`} className="log-bid"><TeamChip team={teams[h.team]} size="sm" /> {fmt(h.amount)}</div>)}
          {game.log.slice().reverse().map((l, i) => <div key={i} className={`log-${l.kind}`}>{l.text}</div>)}
        </div>
      )}
      {tab === 'chat' && <Chat />}
      {tab === 'squad' && (sel ? <><h3><TeamChip team={sel} /> {sel.name}</h3><SquadStats team={sel} players={players} /><SquadList team={sel} players={players} /></> : <p className="empty">Tap a team in the table.</p>)}
      {tab === 'next' && <div>{game.upcoming.map((id) => <PlayerLine key={id} p={players[id]} right={fmt(players[id].base)} />)}{!game.upcoming.length && <p className="empty">Nothing queued.</p>}</div>}
    </section>
  );
}

export default function Auction() {
  const { game, me, act } = useGame();
  const [selected, setSelected] = useState(null);
  const roundLabel = { main: 'MAIN ROUND', accelerated: 'ACCELERATED', final: 'FINAL CALL' }[game.round];
  return (
    <div className="page">
      <TopBar>
        <span className="phase-pill">{game.settings.mode.toUpperCase()} · {roundLabel}</span>
        {me?.isHost && (game.paused
          ? <button type="button" className="btn btn-sm btn-primary" onClick={() => act('host:resume')}>▶ Resume</button>
          : <button type="button" className="btn btn-sm" onClick={() => act('host:pause')}>⏸ Pause</button>)}
      </TopBar>
      <main className="auction">
        <div className="col-main">
          <LotStage />
          <BidPanel />
        </div>
        <div className="col-side">
          <TeamsBoard onSelect={(id) => setSelected(id === selected ? null : id)} selected={selected} />
          <SidePanel selected={selected} />
        </div>
      </main>
    </div>
  );
}
