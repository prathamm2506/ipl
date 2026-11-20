import React from 'react';
import { useGame, TopBar } from './ui.jsx';
import { fmt, cls } from '../util.js';

export default function Lobby() {
  const { game, me, act, toast } = useGame();
  const isHost = !!me?.isHost;
  const s = game.settings;
  const link = `${window.location.origin}/?room=${game.code}`;
  const humans = game.teams.filter((t) => t.ownerId).length;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied', 'good'); }
    catch { toast(link); }
  };
  const set = (patch) => act('settings:update', patch);

  return (
    <div className="page">
      <TopBar><span className="phase-pill">LOBBY</span></TopBar>
      <main className="lobby">
        <section className="card invite">
          <h2>Invite your friends</h2>
          <div className="big-code">{game.code}</div>
          <div className="row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-primary" onClick={copy}>Copy link</button>
          </div>
          <h3>In the room ({game.seats.length})</h3>
          <ul className="seat-list">
            {game.seats.map((x) => (
              <li key={x.id}>
                <span className={cls('dot', x.connected ? 'dot-on' : 'dot-off')} />
                <b>{x.name}</b>{x.id === me?.id && ' (you)'}
                {x.isHost && <em className="tag tag-host">HOST</em>}
                <span className="seat-team">{x.teamId || 'spectating'}</span>
                {isHost && x.id !== me?.id && <button type="button" className="btn btn-xs" onClick={() => act('host:kick', { seatId: x.id })}>Remove</button>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card teams-pick">
          <h2>Pick your franchise</h2>
          <p className="sub">Unclaimed teams are played by the AI. Click your team again to give it back.</p>
          <div className="team-grid">
            {game.teams.map((t) => {
              const mine = t.ownerId === me?.id;
              const taken = t.ownerId && !mine;
              return (
                <button type="button" key={t.id} disabled={taken}
                  className={cls('team-card', mine && 'mine', taken && 'taken')}
                  style={{ '--tc': t.color, '--ti': t.ink }}
                  onClick={() => (mine ? act('team:release') : act('team:claim', { teamId: t.id }))}>
                  <span className="tc-stripe">{t.id}</span>
                  <span className="tc-name">{t.name}</span>
                  <span className="tc-persona">AI style: {t.persona}</span>
                  <span className="tc-owner">{mine ? '★ YOUR TEAM' : taken ? `👤 ${t.ownerName}` : '🤖 AI'}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card settings">
          <h2>Room settings {!isHost && <small>(host controls)</small>}</h2>
          <fieldset disabled={!isHost}>
            <div className="setting">
              <span>Auction type</span>
              <div className="seg">
                <button type="button" className={cls(s.mode === 'mega' && 'on')} onClick={() => set({ mode: 'mega' })}>Mega (IPL 2025)</button>
                <button type="button" className={cls(s.mode === 'mini' && 'on')} onClick={() => set({ mode: 'mini' })}>Mini (IPL 2026)</button>
              </div>
              <small>{s.mode === 'mega' ? '₹120 Cr purse, up to 6 retentions, Right to Match cards, marquee sets.' : 'Official 2026 squads & purses. Keep or release players. No RTM; overseas salary capped at ₹18 Cr.'}</small>
            </div>
            <div className="setting">
              <span>Bid timer: <b>{s.lotSeconds}s</b></span>
              <input type="range" min="5" max="30" value={s.lotSeconds} onChange={(e) => set({ lotSeconds: +e.target.value })} />
              <small>Resets after every bid. Lower-tier sets run 40% faster.</small>
            </div>
            <div className="setting">
              <span>AI difficulty</span>
              <div className="seg">
                {['easy', 'normal', 'hard'].map((d) => <button type="button" key={d} className={cls(s.difficulty === d && 'on')} onClick={() => set({ difficulty: d })}>{d}</button>)}
              </div>
              <small>Hard AI values players higher, price-pushes you more and snipes late.</small>
            </div>
            <div className="setting">
              <span>If a player disconnects</span>
              <div className="seg">
                <button type="button" className={cls(s.onDisconnect === 'ai' && 'on')} onClick={() => set({ onDisconnect: 'ai' })}>AI takes over</button>
                <button type="button" className={cls(s.onDisconnect === 'pass' && 'on')} onClick={() => set({ onDisconnect: 'pass' })}>Auto-pass</button>
              </div>
            </div>
            <div className="setting">
              <span>Nomination window: <b>{s.nominationSeconds}s</b></span>
              <input type="range" min="20" max="180" step="10" value={s.nominationSeconds} onChange={(e) => set({ nominationSeconds: +e.target.value })} />
            </div>
          </fieldset>
          {isHost ? (
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!humans} onClick={() => act('game:start')}>
              {humans ? `Start ${s.mode} auction → ${humans} human, ${10 - humans} AI` : 'Someone must pick a team'}
            </button>
          ) : <p className="note">Waiting for the host to start…</p>}
          <p className="sub">Purse: {s.mode === 'mega' ? fmt(12000) : 'official 2026 remaining purse'} · Squad 18–25 · Max 8 overseas</p>
        </section>
      </main>
    </div>
  );
}
