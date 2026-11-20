// Server-authoritative auction room. One instance per game; all state lives in memory.
const crypto = require('crypto');
const { PLAYERS } = require('../data/players');
const TEAMS = require('../data/teams');
const R = require('./rules');
const AI = require('./ai');

const ROLES = ['BAT', 'AR', 'WK', 'PACE', 'SPIN'];
const ROLE_NAMES = { BAT: 'Batters', AR: 'All-rounders', WK: 'Wicketkeepers', PACE: 'Fast bowlers', SPIN: 'Spinners' };

const DEFAULT_SETTINGS = {
  mode: 'mega',          // 'mega' (IPL 2025 replica, retentions + RTM) | 'mini' (IPL 2026, keep/release)
  lotSeconds: 12,        // countdown per lot, resets on every bid
  difficulty: 'normal',  // easy | normal | hard
  onDisconnect: 'ai',    // 'ai' = AI runs your team while you're away | 'pass' = your team auto-passes
  nominationSeconds: 60,
};

const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

class Room {
  constructor(code, { onChange = () => {}, onEvent = () => {}, timeScale = 1 } = {}) {
    this.code = code;
    this.players = PLAYERS;
    this.onChange = onChange;
    this.onEvent = onEvent;
    this.ts = timeScale;              // <1 speeds everything up (used by tests)
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby';             // lobby | retention | auction | nomination | complete
    this.round = 'main';              // main | accelerated | final
    this.paused = false;
    this.seats = new Map();           // token -> seat
    this.teams = {};
    for (const t of TEAMS) {
      this.teams[t.id] = { id: t.id, name: t.name, color: t.color, ink: t.ink, persona: t.persona, purse26: t.purse26,
        owner: null, controlledBy: 'ai', purse: R.RULES.PURSE, squad: [], rtm: { total: 0, capped: 0, uncapped: 0 },
        retentionSubmitted: false, nominations: [], nominationSubmitted: false, released: [] };
    }
    this.queue = [];
    this.unsold = [];
    this.lot = null;
    this.sales = [];
    this.log = [];
    this.chat = [];
    this.deadline = null;             // { at, fn }
    this.pausedRemaining = null;
    this.timers = { main: null, ai: null };
    this.aiPending = false;
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
  }

  // ---------------------------------------------------------------- helpers
  ms(x) { return Math.max(0, Math.round(x * this.ts)); }
  changed() { this.lastActivity = Date.now(); this.onChange(this); }
  addLog(text, kind = 'info') {
    this.log.push({ t: Date.now(), text, kind });
    if (this.log.length > 80) this.log.shift();
  }
  seatById(id) { for (const s of this.seats.values()) if (s.id === id) return s; return null; }
  humanTeams() { return Object.values(this.teams).filter((t) => t.owner); }

  setDeadline(delayMs, fn) {
    clearTimeout(this.timers.main);
    const d = this.ms(delayMs);
    this.deadline = { at: Date.now() + d, fn, total: d };
    this.timers.main = setTimeout(() => { this.deadline = null; fn(); }, d);
  }
  clearDeadline() { clearTimeout(this.timers.main); this.deadline = null; }
  clearAI() { clearTimeout(this.timers.ai); this.aiPending = false; }
  stopAllTimers() { this.clearDeadline(); this.clearAI(); }

  refreshControl() {
    for (const t of Object.values(this.teams)) {
      if (!t.owner) { t.controlledBy = 'ai'; continue; }
      const seat = this.seats.get(t.owner);
      if (seat && seat.connected) t.controlledBy = 'human';
      else t.controlledBy = this.settings.onDisconnect === 'ai' ? 'ai' : 'away';
    }
  }

  // ---------------------------------------------------------------- seats & lobby
  addSeat(name) {
    const token = crypto.randomBytes(16).toString('hex');
    const seat = { token, id: crypto.randomBytes(4).toString('hex'), name: String(name || 'Player').slice(0, 20).trim() || 'Player',
      teamId: null, connected: true, sockets: new Set(), isHost: this.seats.size === 0, autoPass: false };
    this.seats.set(token, seat);
    this.addLog(`${seat.name} joined the room`);
    this.changed();
    return seat;
  }

  connect(token, socketId) {
    const seat = this.seats.get(token);
    if (!seat) return null;
    seat.sockets.add(socketId);
    const wasAway = !seat.connected;
    seat.connected = true;
    if (!this.hostSeat()) seat.isHost = true;
    if (wasAway) {
      this.addLog(`${seat.name} reconnected`);
      this.refreshControl();
      this.reactToControlChange();
    }
    this.changed();
    return seat;
  }

  disconnect(token, socketId) {
    const seat = this.seats.get(token);
    if (!seat) return;
    seat.sockets.delete(socketId);
    if (seat.sockets.size > 0) return;
    seat.connected = false;
    this.addLog(`${seat.name} disconnected${seat.teamId && this.phase !== 'lobby' ? (this.settings.onDisconnect === 'ai' ? ' — AI is running their team' : ' — their team will auto-pass') : ''}`, 'warn');
    if (seat.isHost) {
      const next = [...this.seats.values()].find((s) => s.connected);
      if (next) { seat.isHost = false; next.isHost = true; this.addLog(`${next.name} is now the host`); }
    }
    if (this.phase === 'lobby' && seat.teamId) { /* keep the claim; they may come back */ }
    this.refreshControl();
    this.reactToControlChange();
    this.changed();
  }

  hostSeat() { for (const s of this.seats.values()) if (s.isHost && s.connected) return s; return null; }
  isHost(token) { const s = this.seats.get(token); return !!(s && s.isHost); }
  hasConnected() { for (const s of this.seats.values()) if (s.connected) return true; return false; }

  claimTeam(token, teamId) {
    const seat = this.seats.get(token);
    if (!seat) return { error: 'Unknown player' };
    if (this.phase !== 'lobby') return { error: 'Teams can only be picked in the lobby' };
    const team = this.teams[teamId];
    if (!team) return { error: 'Unknown team' };
    if (team.owner && team.owner !== token) return { error: `${team.id} is already taken` };
    if (seat.teamId && this.teams[seat.teamId]) this.teams[seat.teamId].owner = null;
    team.owner = token;
    seat.teamId = teamId;
    this.refreshControl();
    this.addLog(`${seat.name} picked ${team.id}`);
    this.changed();
    return { ok: true };
  }

  releaseTeam(token) {
    const seat = this.seats.get(token);
    if (!seat || this.phase !== 'lobby' || !seat.teamId) return { error: 'Nothing to release' };
    this.teams[seat.teamId].owner = null;
    seat.teamId = null;
    this.refreshControl();
    this.changed();
    return { ok: true };
  }

  kick(token, seatId) {
    if (!this.isHost(token)) return { error: 'Only the host can do that' };
    if (this.phase !== 'lobby') return { error: 'Players can only be removed in the lobby' };
    const seat = this.seatById(seatId);
    if (!seat || seat.token === token) return { error: 'Cannot remove that player' };
    if (seat.teamId) this.teams[seat.teamId].owner = null;
    this.seats.delete(seat.token);
    this.refreshControl();
    this.addLog(`${seat.name} was removed by the host`, 'warn');
    this.changed();
    return { ok: true, removedToken: seat.token };
  }

  updateSettings(token, patch = {}) {
    if (!this.isHost(token)) return { error: 'Only the host can change settings' };
    if (this.phase !== 'lobby') return { error: 'Settings are locked once the game starts' };
    const s = this.settings;
    if (['mega', 'mini'].includes(patch.mode)) s.mode = patch.mode;
    if (['easy', 'normal', 'hard'].includes(patch.difficulty)) s.difficulty = patch.difficulty;
    if (['ai', 'pass'].includes(patch.onDisconnect)) s.onDisconnect = patch.onDisconnect;
    if (Number.isFinite(+patch.lotSeconds)) s.lotSeconds = Math.min(30, Math.max(5, Math.round(+patch.lotSeconds)));
    if (Number.isFinite(+patch.nominationSeconds)) s.nominationSeconds = Math.min(180, Math.max(20, Math.round(+patch.nominationSeconds)));
    this.changed();
    return { ok: true };
  }

  setAutoPass(token, on) {
    const seat = this.seats.get(token);
    if (!seat) return { error: 'Unknown player' };
    seat.autoPass = !!on;
    if (on && this.lot && this.lot.status === 'bidding' && seat.teamId && this.lot.leader !== seat.teamId) {
      this.lot.passed.add(seat.teamId);
      this.checkEarlyClose();
    }
    this.changed();
    return { ok: true };
  }

  // ---------------------------------------------------------------- game start & retention
  startGame(token) {
    if (!this.isHost(token)) return { error: 'Only the host can start' };
    if (this.phase !== 'lobby') return { error: 'Already started' };
    if (this.humanTeams().length === 0) return { error: 'At least one player must pick a team' };
    const mega = this.settings.mode === 'mega';
    for (const t of Object.values(this.teams)) {
      t.squad = []; t.released = []; t.retentionSubmitted = false;
      if (mega) {
        t.purse = R.RULES.PURSE;
        t.rtm = { total: 6, capped: 5, uncapped: 2 };
        if (!t.owner) this.applyMegaRetention(t, this.officialRetentions(t.id), true);
      } else {
        t.rtm = { total: 0, capped: 0, uncapped: 0 };
        this.applyMiniRelease(t, []);
        if (!t.owner) t.retentionSubmitted = true;
      }
    }
    this.phase = 'retention';
    this.addLog(mega ? 'Retention window open — pick up to 6 players to keep' : 'Retention window open — keep or release players from your 2026 squad');
    this.changed();
    return { ok: true };
  }

  officialRetentions(teamId) {
    return PLAYERS.filter((p) => p.t25 === teamId && p.r25).sort((a, b) => b.p25 - a.p25).map((p) => p.id);
  }

  /** Mega: ids in pick order. Official = real 2025 retention (actual salaries, BCCI slab deduction). */
  validateMegaRetention(teamId, ids) {
    if (!Array.isArray(ids)) return 'Invalid retention list';
    const uniq = [...new Set(ids.map(Number))];
    if (uniq.length > R.RULES.MAX_RETAIN_TOTAL) return 'You can retain at most 6 players';
    for (const id of uniq) {
      const p = PLAYERS[id];
      if (!p || p.t24 !== teamId || p.notInMega) return `${p ? p.name : 'Player'} is not eligible for ${teamId}`;
    }
    const capped = uniq.filter((id) => PLAYERS[id].capped).length;
    if (capped > R.RULES.MAX_RETAIN_CAPPED) return 'At most 5 capped players';
    if (uniq.length - capped > R.RULES.MAX_RETAIN_UNCAPPED) return 'At most 2 uncapped players';
    return null;
  }

  applyMegaRetention(team, ids, official = false) {
    const uniq = [...new Set(ids.map(Number))];
    const capped = uniq.filter((id) => PLAYERS[id].capped);
    const uncapped = uniq.filter((id) => !PLAYERS[id].capped);
    const slabs = R.RULES.RETAIN_CAPPED_SLABS;
    const slabSum = capped.reduce((s, _, i) => s + slabs[i], 0);
    let cost;
    team.squad = [];
    if (official) {
      const actualCapped = capped.reduce((s, id) => s + PLAYERS[id].p25, 0);
      cost = Math.max(slabSum, actualCapped) + uncapped.reduce((s, id) => s + Math.max(R.RULES.RETAIN_UNCAPPED, PLAYERS[id].p25), 0);
      for (const id of uniq) team.squad.push({ pid: id, price: PLAYERS[id].p25, salary: PLAYERS[id].p25, how: 'retained' });
    } else {
      cost = slabSum + uncapped.length * R.RULES.RETAIN_UNCAPPED;
      capped.forEach((id, i) => team.squad.push({ pid: id, price: slabs[i], salary: slabs[i], how: 'retained' }));
      uncapped.forEach((id) => team.squad.push({ pid: id, price: R.RULES.RETAIN_UNCAPPED, salary: R.RULES.RETAIN_UNCAPPED, how: 'retained' }));
    }
    team.purse = R.RULES.PURSE - cost;
    team.rtm = { total: 6 - uniq.length, capped: 5 - capped.length, uncapped: 2 - uncapped.length };
    team.retentionSubmitted = true;
  }

  applyMiniRelease(team, releaseIds) {
    const rel = new Set((releaseIds || []).map(Number));
    const base = PLAYERS.filter((p) => p.t26 === team.id);
    team.squad = base.filter((p) => !rel.has(p.id)).map((p) => ({ pid: p.id, price: p.p26, salary: p.p26, how: 'retained' }));
    team.released = base.filter((p) => rel.has(p.id)).map((p) => p.id);
    team.purse = team.purse26 + team.released.reduce((s, id) => s + PLAYERS[id].p26, 0);
  }

  submitRetention(token, payload = {}) {
    const seat = this.seats.get(token);
    if (!seat || !seat.teamId) return { error: 'You do not control a team' };
    if (this.phase !== 'retention') return { error: 'Retention window is closed' };
    const team = this.teams[seat.teamId];
    if (this.settings.mode === 'mega') {
      const err = this.validateMegaRetention(team.id, payload.retain || []);
      if (err) return { error: err };
      this.applyMegaRetention(team, payload.retain || [], false);
      this.addLog(`${team.id} locked in ${team.squad.length} retention${team.squad.length === 1 ? '' : 's'}`);
    } else {
      const release = (payload.release || []).map(Number);
      for (const id of release) if (!PLAYERS[id] || PLAYERS[id].t26 !== team.id) return { error: 'Invalid release list' };
      this.applyMiniRelease(team, release);
      team.retentionSubmitted = true;
      this.addLog(`${team.id} confirmed squad (${team.released.length} released)`);
    }
    this.changed();
    if (this.humanTeams().every((t) => t.retentionSubmitted)) this.startAuction();
    return { ok: true };
  }

  forceStart(token) {
    if (!this.isHost(token)) return { error: 'Only the host can do that' };
    if (this.phase !== 'retention') return { error: 'Not in retention' };
    for (const t of this.humanTeams()) {
      if (t.retentionSubmitted) continue;
      if (this.settings.mode === 'mega') this.applyMegaRetention(t, this.officialRetentions(t.id), true);
      else { this.applyMiniRelease(t, []); t.retentionSubmitted = true; }
      this.addLog(`${t.id} did not submit — official retentions applied`, 'warn');
    }
    this.startAuction();
    return { ok: true };
  }

  // ---------------------------------------------------------------- auction setup
  startAuction() {
    const inSquad = new Set();
    const released = new Set();
    for (const t of Object.values(this.teams)) { t.squad.forEach((s) => inSquad.add(s.pid)); t.released.forEach((id) => released.add(id)); }
    const mega = this.settings.mode === 'mega';
    const pool = PLAYERS.filter((p) => !inSquad.has(p.id) && (mega ? !p.notInMega : !p.notIn26 && (p.t26 === '' || released.has(p.id))));
    this.queue = this.buildQueue(pool, mega);
    this.unsold = [];
    this.round = 'main';
    this.phase = 'auction';
    this.refreshControl();
    this.addLog(`Auction started — ${this.queue.length} players in the pool`, 'big');
    this.changed();
    this.setDeadline(1500, () => this.nextLot());
  }

  buildQueue(pool, mega) {
    const sorted = pool.slice().sort((a, b) => b.rating - a.rating);
    const sets = [];
    let rest = sorted;
    if (mega) {
      const marquee = sorted.filter((p) => p.capped).slice(0, 12);
      const ids = new Set(marquee.map((p) => p.id));
      rest = sorted.filter((p) => !ids.has(p.id));
      chunk(marquee, 6).forEach((c, i) => sets.push({ name: `Marquee ${i + 1}`, list: c, fast: false }));
    }
    for (const capped of [true, false]) {
      const byRole = {};
      for (const r of ROLES) byRole[r] = chunk(rest.filter((p) => p.capped === capped && p.role === r), capped ? 8 : 10);
      const rounds = Math.max(...ROLES.map((r) => byRole[r].length));
      for (let i = 0; i < rounds; i++) {
        for (const r of ROLES) {
          const c = byRole[r][i];
          if (!c) continue;
          const avg = c.reduce((s, p) => s + p.rating, 0) / c.length;
          sets.push({ name: `${capped ? 'Capped' : 'Uncapped'} ${ROLE_NAMES[r]} ${i + 1}`, list: c, fast: !capped || avg < 66 });
        }
      }
    }
    return sets.flatMap((s) => shuffle(s.list).map((p) => ({ pid: p.id, set: s.name, fast: s.fast })));
  }

  remainingLots() { return this.queue.length + (this.lot && this.lot.status === 'bidding' ? 1 : 0); }

  upcomingSameRoleBetter(p) {
    for (let i = 0; i < Math.min(this.queue.length, 40); i++) {
      const q = PLAYERS[this.queue[i].pid];
      if (q.role === p.role && q.rating >= p.rating + 4) return q;
    }
    return null;
  }

  anyTeamCanBuy(p) {
    return Object.values(this.teams).some((t) => R.hasRoomFor(t, p, PLAYERS) && R.maxBid(t) >= p.base);
  }

  // ---------------------------------------------------------------- lots
  nextLot() {
    this.clearAI();
    if (this.phase !== 'auction') return;
    if (this.round === 'final' && Object.values(this.teams).every((t) => t.squad.length >= R.RULES.MIN_SQUAD)) return this.finishRound();
    let item;
    while ((item = this.queue.shift())) {
      if (this.anyTeamCanBuy(PLAYERS[item.pid])) break;
      this.unsold.push(item.pid);
    }
    if (!item) return this.finishRound();
    const p = PLAYERS[item.pid];
    const lotMs = this.settings.lotSeconds * 1000 * (item.fast ? 0.6 : 1);
    this.lot = { pid: p.id, set: item.set, base: p.base, bid: null, leader: null, history: [], passed: new Set(),
      status: 'bidding', lotMs, fast: item.fast, ai: AI.lotContext(this), rtm: null, result: null, closing: false };
    for (const s of this.seats.values()) if (s.autoPass && s.teamId) this.lot.passed.add(s.teamId);
    this.setDeadline(lotMs, () => this.closeLot());
    this.planAI();
    this.checkEarlyClose();
    this.changed();
  }

  canTeamBidNow(team) {
    const lot = this.lot;
    if (!lot || lot.status !== 'bidding' || lot.leader === team.id) return false;
    const p = PLAYERS[lot.pid];
    return R.canBid(team, p, PLAYERS, R.nextBid(lot));
  }

  bid(teamId, amount, by = 'human') {
    const lot = this.lot;
    if (this.phase !== 'auction' || !lot || lot.status !== 'bidding') return { error: 'No lot open for bidding' };
    if (this.paused) return { error: 'Auction is paused' };
    const team = this.teams[teamId];
    if (!team) return { error: 'Unknown team' };
    if (lot.leader === teamId) return { error: 'You already hold the highest bid' };
    const p = PLAYERS[lot.pid];
    const min = R.nextBid(lot);
    let amt = amount == null ? min : Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt < min) amt = min;
    amt = R.snapUp(amt, min);
    if (!R.hasRoomFor(team, p, PLAYERS)) return { error: team.squad.length >= R.RULES.MAX_SQUAD ? 'Squad is full (25)' : 'Overseas limit reached (8)' };
    if (amt > R.maxBid(team)) return { error: `Max bid is ${R.fmt(R.maxBid(team))} (₹30 L kept per empty slot below 18)` };
    const prevLeader = lot.leader;
    lot.bid = amt;
    lot.leader = teamId;
    lot.closing = false;
    lot.passed.delete(teamId);
    lot.history.push({ team: teamId, amount: amt, t: Date.now(), by });
    this.setDeadline(lot.lotMs, () => this.closeLot());
    this.onEvent('bid', { team: teamId, amount: amt, outbid: prevLeader });
    this.planAI();
    this.checkEarlyClose();
    this.changed();
    return { ok: true, amount: amt };
  }

  pass(teamId) {
    const lot = this.lot;
    if (!lot || lot.status !== 'bidding') return { error: 'No lot open' };
    if (lot.leader === teamId) return { error: 'You hold the highest bid' };
    lot.passed.add(teamId);
    this.checkEarlyClose();
    this.changed();
    return { ok: true };
  }

  planAI() {
    this.clearAI();
    const lot = this.lot;
    if (this.paused || !lot || lot.status !== 'bidding') return;
    const next = R.nextBid(lot);
    const cands = [];
    for (const t of Object.values(this.teams)) {
      if (t.controlledBy !== 'ai' || !this.canTeamBidNow(t)) continue;
      const w = AI.willingness(this, t, lot);
      if (w >= next) cands.push({ t, weight: (w - next + 10) * t.persona.aggression });
    }
    if (!cands.length) return;
    let r = Math.random() * cands.reduce((s, c) => s + c.weight, 0);
    let pick = cands[0];
    for (const c of cands) { r -= c.weight; if (r <= 0) { pick = c; break; } }
    const timeLeft = (this.deadline ? this.deadline.at - Date.now() : 0) / Math.max(this.ts, 1e-6);
    let delay = lot.bid == null ? rand(700, 2000) : rand(450, 1500);
    const leader = lot.leader && this.teams[lot.leader];
    if (lot.ai[pick.t.id].snipe && leader && leader.owner) delay = timeLeft - rand(700, 1400); // late "sniping" bid against a human
    delay = Math.max(80, Math.min(delay, timeLeft - 350));
    this.aiPending = true;
    const teamId = pick.t.id;
    this.timers.ai = setTimeout(() => {
      this.aiPending = false;
      const res = this.bid(teamId, null, 'ai');
      if (res.error) { this.planAI(); this.checkEarlyClose(); }
    }, this.ms(delay));
  }

  /** If nobody else can or will bid, bring the hammer down quickly. */
  checkEarlyClose() {
    const lot = this.lot;
    if (!lot || lot.status !== 'bidding' || this.aiPending || this.paused) return;
    const waiting = Object.values(this.teams).filter((t) => t.controlledBy === 'human' && !lot.passed.has(t.id) && this.canTeamBidNow(t));
    if (waiting.length) return;
    const ms = lot.leader ? 2200 : 1400;
    if (!this.deadline || this.deadline.at - Date.now() > this.ms(ms)) {
      lot.closing = true;
      this.setDeadline(ms, () => this.closeLot());
      this.changed();
    }
  }

  closeLot() {
    const lot = this.lot;
    if (!lot || lot.status !== 'bidding') return;
    this.clearAI();
    const p = PLAYERS[lot.pid];
    if (!lot.leader) {
      this.unsold.push(p.id);
      lot.status = 'result';
      lot.result = { type: 'unsold' };
      this.addLog(`${p.name} — UNSOLD`, 'unsold');
      this.onEvent('unsold', { pid: p.id });
      this.setDeadline(1600, () => this.nextLot());
      return this.changed();
    }
    const former = this.teams[p.t24];
    if (this.settings.mode === 'mega' && former && former.id !== lot.leader && former.rtm.total > 0 &&
        (p.capped ? former.rtm.capped > 0 : former.rtm.uncapped > 0) && R.hasRoomFor(former, p, PLAYERS) && lot.bid <= R.maxBid(former)) {
      return this.startRTM(former);
    }
    this.sell(lot.leader, lot.bid, 'auction');
  }

  // ---------------------------------------------------------------- Right to Match (mega only)
  startRTM(former) {
    const lot = this.lot;
    lot.status = 'rtm';
    lot.rtm = { team: former.id, winner: lot.leader, price: lot.bid, stage: 'offer', raised: false };
    this.addLog(`${PLAYERS[lot.pid].name}: highest bid ${lot.leader} ${R.fmt(lot.bid)} — ${former.id} can use RTM`, 'rtm');
    this.setDeadline(15000, () => this.rtmTimeout());
    this.rtmTurn();
    this.changed();
  }

  rtmActor() {
    const rt = this.lot && this.lot.rtm;
    if (!rt) return null;
    return this.teams[rt.stage === 'raise' ? rt.winner : rt.team];
  }

  /** Let AI / away teams act when it's their RTM decision. */
  rtmTurn() {
    this.clearAI();
    const rt = this.lot && this.lot.rtm;
    if (!rt || this.paused) return;
    const actor = this.rtmActor();
    if (actor.controlledBy === 'human') return;
    const p = PLAYERS[this.lot.pid];
    const act = () => {
      if (actor.controlledBy === 'away') return this.rtmTimeout();
      if (rt.stage === 'offer') this.rtmDecide(actor.id, AI.shouldUseRTM(this, actor, p, rt.price));
      else if (rt.stage === 'raise') this.rtmRaise(actor.id, AI.rtmRaise(this, actor, p, rt.price));
      else this.rtmMatch(actor.id, AI.shouldMatch(this, actor, p, rt.price));
    };
    this.aiPending = true;
    this.timers.ai = setTimeout(() => { this.aiPending = false; act(); }, this.ms(rand(1200, 2200)));
  }

  rtmTimeout() {
    const rt = this.lot && this.lot.rtm;
    if (!rt) return;
    if (rt.stage === 'offer') this.rtmDecide(rt.team, false);
    else if (rt.stage === 'raise') this.rtmRaise(rt.winner, null);
    else this.rtmMatch(rt.team, false);
  }

  rtmDecide(teamId, use) {
    const rt = this.lot && this.lot.rtm;
    if (!rt || rt.stage !== 'offer' || rt.team !== teamId) return { error: 'Not your RTM decision' };
    if (!use) {
      this.addLog(`${teamId} declined RTM`, 'rtm');
      this.sell(rt.winner, rt.price, 'auction');
      return { ok: true };
    }
    rt.stage = 'raise';
    this.addLog(`${teamId} raised the RTM card! ${rt.winner} gets one final raise`, 'rtm');
    this.setDeadline(15000, () => this.rtmTimeout());
    this.rtmTurn();
    this.changed();
    return { ok: true };
  }

  rtmRaise(teamId, amount) {
    const rt = this.lot && this.lot.rtm;
    if (!rt || rt.stage !== 'raise' || rt.winner !== teamId) return { error: 'Not your decision' };
    const winner = this.teams[teamId];
    if (amount == null) {
      this.addLog(`${teamId} did not raise — ${rt.team} gets ${PLAYERS[this.lot.pid].name} via RTM at ${R.fmt(rt.price)}`, 'rtm');
      this.sell(rt.team, rt.price, 'rtm');
      return { ok: true };
    }
    const min = rt.price + R.increment(rt.price);
    const amt = R.snapUp(Math.max(min, Math.round(Number(amount)) || min), min);
    if (amt > R.maxBid(winner)) return { error: `Max you can raise to is ${R.fmt(R.maxBid(winner))}` };
    rt.price = amt;
    rt.raised = true;
    rt.stage = 'match';
    this.addLog(`${teamId} raised to ${R.fmt(amt)} — will ${rt.team} match?`, 'rtm');
    this.setDeadline(15000, () => this.rtmTimeout());
    this.rtmTurn();
    this.changed();
    return { ok: true };
  }

  rtmMatch(teamId, match) {
    const rt = this.lot && this.lot.rtm;
    if (!rt || rt.stage !== 'match' || rt.team !== teamId) return { error: 'Not your decision' };
    const former = this.teams[teamId];
    if (match && rt.price <= R.maxBid(former)) {
      this.addLog(`${teamId} matched ${R.fmt(rt.price)}!`, 'rtm');
      this.sell(teamId, rt.price, 'rtm');
    } else {
      this.addLog(`${teamId} did not match`, 'rtm');
      this.sell(rt.winner, rt.price, 'auction');
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- sale
  sell(teamId, price, how) {
    const lot = this.lot;
    const team = this.teams[teamId];
    const p = PLAYERS[lot.pid];
    const salary = this.settings.mode === 'mini' && p.overseas ? Math.min(price, R.RULES.MINI_OVERSEAS_SALARY_CAP) : price;
    team.purse -= price;
    team.squad.push({ pid: p.id, price, salary, how });
    if (how === 'rtm') { team.rtm.total--; if (p.capped) team.rtm.capped--; else team.rtm.uncapped--; }
    lot.status = 'result';
    lot.result = { type: 'sold', team: teamId, price, how, bcci: price - salary };
    this.sales.push({ pid: p.id, team: teamId, price, how, round: this.round });
    this.addLog(`${p.name} SOLD to ${teamId} for ${R.fmt(price)}${how === 'rtm' ? ' (RTM)' : ''}${price > salary ? ` — ${R.fmt(price - salary)} goes to BCCI` : ''}`, 'sold');
    this.onEvent('sold', { pid: p.id, team: teamId, price });
    this.setDeadline(2400, () => this.nextLot());
    this.changed();
  }

  // ---------------------------------------------------------------- rounds
  finishRound() {
    this.clearAI();
    this.lot = null;
    const anyRoom = Object.values(this.teams).some((t) => t.squad.length < R.RULES.MAX_SQUAD && R.maxBid(t) >= 30);
    const buyable = this.unsold.filter((id) => this.anyTeamCanBuy(PLAYERS[id]));
    if (this.round === 'main' && buyable.length && anyRoom) return this.startNomination(buyable);
    if (this.round !== 'final' && buyable.length && Object.values(this.teams).some((t) => t.squad.length < R.RULES.MIN_SQUAD)) {
      this.round = 'final';
      this.queue = buyable.sort((a, b) => PLAYERS[b].rating - PLAYERS[a].rating).map((pid) => ({ pid, set: 'Final call — fill to 18', fast: true }));
      this.unsold = this.unsold.filter((id) => !buyable.includes(id));
      this.addLog('Final call: remaining players return until every squad has 18', 'big');
      this.changed();
      return this.setDeadline(1500, () => this.nextLot());
    }
    this.complete();
  }

  startNomination(buyable) {
    this.phase = 'nomination';
    this.nominationPool = buyable;
    for (const t of Object.values(this.teams)) {
      t.nominations = [];
      t.nominationSubmitted = false;
      if (t.controlledBy !== 'human') { t.nominations = AI.nominate(this, t, buyable, 6); t.nominationSubmitted = true; }
    }
    this.addLog('Accelerated round: each team nominates up to 8 unsold players to bring back', 'big');
    this.setDeadline(this.settings.nominationSeconds * 1000, () => this.startAccelerated());
    this.changed();
    if (this.humanTeams().every((t) => t.nominationSubmitted)) this.startAccelerated();
  }

  submitNominations(token, ids) {
    const seat = this.seats.get(token);
    if (!seat || !seat.teamId) return { error: 'You do not control a team' };
    if (this.phase !== 'nomination') return { error: 'Nominations are closed' };
    const pool = new Set(this.nominationPool);
    const list = [...new Set((ids || []).map(Number))].filter((id) => pool.has(id)).slice(0, 8);
    const t = this.teams[seat.teamId];
    t.nominations = list;
    t.nominationSubmitted = true;
    this.changed();
    if (this.humanTeams().filter((x) => x.controlledBy === 'human').every((x) => x.nominationSubmitted)) this.startAccelerated();
    return { ok: true };
  }

  startAccelerated() {
    if (this.phase !== 'nomination') return;
    this.clearDeadline();
    const picked = new Set();
    for (const t of Object.values(this.teams)) t.nominations.forEach((id) => picked.add(id));
    const list = [...picked].sort((a, b) => PLAYERS[b].rating - PLAYERS[a].rating);
    this.unsold = this.unsold.filter((id) => !picked.has(id));
    this.queue = list.map((pid) => ({ pid, set: 'Accelerated round', fast: true }));
    this.round = 'accelerated';
    this.phase = 'auction';
    this.addLog(`Accelerated round — ${list.length} players nominated`, 'big');
    this.changed();
    this.setDeadline(1500, () => this.nextLot());
  }

  complete() {
    this.stopAllTimers();
    this.phase = 'complete';
    this.lot = null;
    this.addLog('Auction complete!', 'big');
    this.changed();
  }

  // ---------------------------------------------------------------- host controls
  pause(token) {
    if (!this.isHost(token)) return { error: 'Only the host can pause' };
    if (this.paused || !['auction', 'nomination'].includes(this.phase)) return { error: 'Nothing to pause' };
    this.paused = true;
    if (this.deadline) { this.pausedRemaining = { ms: Math.max(0, this.deadline.at - Date.now()), fn: this.deadline.fn }; }
    this.stopAllTimers();
    this.addLog('Auction paused by host', 'warn');
    this.changed();
    return { ok: true };
  }

  resume(token) {
    if (!this.isHost(token)) return { error: 'Only the host can resume' };
    if (!this.paused) return { error: 'Not paused' };
    this.paused = false;
    const pr = this.pausedRemaining;
    this.pausedRemaining = null;
    if (pr) this.setDeadline(Math.max(1500, pr.ms / this.ts), pr.fn);
    this.reactToControlChange();
    this.addLog('Auction resumed', 'warn');
    this.changed();
    return { ok: true };
  }

  reactToControlChange() {
    if (this.paused) return;
    const lot = this.lot;
    if (this.phase === 'auction' && lot) {
      if (lot.status === 'bidding') { this.planAI(); this.checkEarlyClose(); }
      else if (lot.status === 'rtm') this.rtmTurn();
    }
    if (this.phase === 'nomination') {
      for (const t of Object.values(this.teams)) {
        if (!t.nominationSubmitted && t.controlledBy !== 'human') { t.nominations = AI.nominate(this, t, this.nominationPool, 6); t.nominationSubmitted = true; }
      }
      if (Object.values(this.teams).every((t) => t.nominationSubmitted)) this.startAccelerated();
    }
  }

  // ---------------------------------------------------------------- chat
  addChat(token, text) {
    const seat = this.seats.get(token);
    const msg = String(text || '').trim().slice(0, 200);
    if (!seat || !msg) return { error: 'Empty message' };
    this.chat.push({ t: Date.now(), from: seat.name, team: seat.teamId, text: msg });
    if (this.chat.length > 60) this.chat.shift();
    this.changed();
    return { ok: true };
  }

  // ---------------------------------------------------------------- views
  summary() {
    return Object.values(this.teams).map((t) => {
      const sq = t.squad.map((s) => ({ ...s, p: PLAYERS[s.pid] }));
      const xi = sq.slice().sort((a, b) => b.p.rating - a.p.rating);
      const best = []; let os = 0;
      for (const s of xi) { if (best.length >= 11) break; if (s.p.overseas) { if (os >= 4) continue; os++; } best.push(s); }
      const spent = t.squad.filter((s) => s.how !== 'retained').reduce((a, s) => a + s.price, 0);
      return { id: t.id, xiRating: best.length ? Math.round(best.reduce((a, s) => a + s.p.rating, 0) / best.length * 10) / 10 : 0,
        bestXI: best.map((s) => s.pid), spent, purseLeft: t.purse, size: t.squad.length };
    });
  }

  publicState() {
    const lot = this.lot;
    const seatsById = {};
    for (const s of this.seats.values()) seatsById[s.token] = s;
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      paused: this.paused,
      settings: this.settings,
      serverNow: Date.now(),
      deadline: this.deadline ? this.deadline.at : null,
      deadlineTotal: this.deadline ? this.deadline.total : null,
      pausedRemaining: this.pausedRemaining ? this.pausedRemaining.ms : null,
      seats: [...this.seats.values()].map((s) => ({ id: s.id, name: s.name, teamId: s.teamId, connected: s.connected, isHost: s.isHost, autoPass: s.autoPass })),
      teams: Object.values(this.teams).map((t) => ({
        id: t.id, name: t.name, color: t.color, ink: t.ink, persona: t.persona.label,
        ownerId: t.owner ? seatsById[t.owner]?.id : null, ownerName: t.owner ? seatsById[t.owner]?.name : null,
        controlledBy: t.controlledBy, purse: t.purse, maxBid: R.maxBid(t), squad: t.squad, released: t.released,
        overseas: R.overseasCount(t, PLAYERS), rtm: t.rtm, retentionSubmitted: t.retentionSubmitted,
        nominations: t.nominations, nominationSubmitted: t.nominationSubmitted,
      })),
      lot: lot && {
        pid: lot.pid, set: lot.set, base: lot.base, bid: lot.bid, leader: lot.leader, next: R.nextBid(lot),
        history: lot.history.slice(-14), passed: [...lot.passed], status: lot.status, rtm: lot.rtm, result: lot.result,
        closing: lot.closing, fast: lot.fast,
      },
      upcoming: this.queue.slice(0, 6).map((q) => q.pid),
      remaining: this.queue.length,
      nominationPool: this.phase === 'nomination' ? this.nominationPool : [],
      unsoldCount: this.unsold.length,
      sales: this.sales.slice(-200),
      log: this.log.slice(-40),
      chat: this.chat.slice(-50),
      summary: this.phase === 'complete' ? this.summary() : null,
    };
  }

  destroy() { this.stopAllTimers(); }
}

module.exports = { Room, DEFAULT_SETTINGS };
