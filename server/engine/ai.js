// AI bidding brain. Pure functions over room state so it is easy to test and tune.
const { RULES, maxBid, hasRoomFor, increment, snapUp, overseasCount } = require('./rules');

const TARGET = { BAT: 5, WK: 2, AR: 5, PACE: 5, SPIN: 3 };

// Difficulty should improve judgement, not inflate prices heavily.
const DIFFICULTY = {
  easy:   { value: 0.94, noise: 0.10, push: 0.00, snipe: 0.00 },
  normal: { value: 1.00, noise: 0.06, push: 0.08, snipe: 0.10 },
  hard:   { value: 1.03, noise: 0.035, push: 0.12, snipe: 0.22 },
};

const MODE_LIMITS = {
  mega: {
    absoluteCap: 2700,       // 27 Cr. No normal mega-auction bid can reach 40 Cr.
    eliteCap: 2700,
    starCap: 2200,
    regularCap: 1500,
    purseShareEarly: 0.28,
    purseShareLate: 0.38,
  },
  mini: {
    absoluteCap: 3200,
    eliteCap: 3200,
    starCap: 2600,
    regularCap: 1900,
    purseShareEarly: 0.42,
    purseShareLate: 0.55,
  },
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Fair market value in lakhs before team-specific adjustments. */
function marketValue(p, mode) {
  // Softer curve than the old exponential model. Approx: r70=1.8 Cr, r80=6.2 Cr,
  // r85=11.4 Cr, r90=20.9 Cr before scarcity/age adjustments.
  let v = 38 * Math.exp((p.rating - 58) * 0.106);

  if (mode === 'mega') {
    v *= p.overseas ? 0.78 : p.capped ? 1.08 : 0.96;
  } else {
    v *= p.overseas ? 1.18 : 1.10;
  }

  if (!p.capped && p.age <= 23 && p.rating >= 66) v *= 1.12;
  if (p.age >= 34) v *= 0.90;

  const lim = MODE_LIMITS[mode] || MODE_LIMITS.mega;
  return clamp(Math.max(p.base, v), p.base, lim.absoluteCap);
}

function roleCounts(team, players) {
  const c = { BAT: 0, WK: 0, AR: 0, PACE: 0, SPIN: 0 };
  for (const s of team.squad) c[players[s.pid].role]++;
  return c;
}

function needMultiplier(team, p, players) {
  const have = roleCounts(team, players);
  const deficit = TARGET[p.role] - have[p.role];

  // Need matters, but cannot double a player's price.
  let m = deficit >= 3 ? 1.18 : deficit === 2 ? 1.12 : deficit === 1 ? 1.06 : deficit === 0 ? 0.88 : 0.68;
  if (p.role === 'WK' && have.WK === 0) m *= 1.10;

  if (p.overseas) {
    const os = overseasCount(team, players);
    if (os >= 7) m *= 0.58;
    else if (os >= 6) m *= 0.78;
    else if (os >= 4) m *= 0.92;
  }

  return clamp(m, 0.50, 1.28);
}

function personaMultiplier(persona, p) {
  // Personas add flavour, but are deliberately bounded so aggression cannot
  // turn an ordinary valuation into a 30-40 Cr bid.
  let m = 1;
  m += clamp((persona.aggression || 1) - 1, -0.12, 0.12);
  if (p.rating >= 85) m += clamp(persona.star || 0, -0.08, 0.12);
  if (p.age <= 24) m += clamp(persona.youth || 0, -0.06, 0.08);
  if (p.age >= 31) m += clamp(persona.experience || 0, -0.06, 0.06);
  if (p.overseas) m += clamp(persona.overseas || 0, -0.08, 0.08);
  if (p.rating < 75) m += clamp(persona.bargain || 0, -0.06, 0.08);
  if (p.role === 'SPIN') m += clamp(persona.spin || 0, -0.05, 0.06);
  return clamp(m, 0.82, 1.20);
}

function playerPriceCap(p, mode) {
  const lim = MODE_LIMITS[mode] || MODE_LIMITS.mega;
  if (p.rating >= 89) return lim.eliteCap;
  if (p.rating >= 84) return lim.starCap;
  return lim.regularCap;
}

function budgetState(team) {
  const slotsNeeded = Math.max(0, RULES.MIN_SQUAD - team.squad.length);
  const reservePerSlot = slotsNeeded > 8 ? 100 : slotsNeeded > 4 ? 80 : 60;
  const reserve = Math.max(0, slotsNeeded - 1) * reservePerSlot;
  const spendable = Math.max(0, team.purse - reserve);
  const avgPerRemainingSlot = slotsNeeded > 0 ? spendable / slotsNeeded : spendable;
  return { slotsNeeded, reserve, spendable, avgPerRemainingSlot };
}

function auctionPhase(room, team) {
  const initialOpenSlots = Math.max(1, RULES.MIN_SQUAD - (team.squad.length - room.sales.filter(s => s.team === team.id).length));
  const bought = room.sales.filter(s => s.team === team.id).length;
  return clamp(bought / initialOpenSlots, 0, 1);
}

/** How much this team truly values the player. */
function teamValue(room, team, p, opts = {}) {
  const players = room.players;
  if (!hasRoomFor(team, p, players)) return 0;

  const mode = room.settings.mode;
  const diff = DIFFICULTY[room.settings.difficulty] || DIFFICULTY.normal;
  const noise = clamp(opts.noise ?? 1, 0.90, 1.10);
  const budget = budgetState(team);

  let v = marketValue(p, mode);
  v *= needMultiplier(team, p, players);
  v *= personaMultiplier(team.persona, p);
  v *= noise * diff.value;

  // Opportunity cost: save money when a clearly better same-role player is near.
  const better = room.upcomingSameRoleBetter(p);
  if (better) {
    const betterValue = marketValue(better, mode);
    if (budget.spendable < betterValue * 1.7) v *= 0.80;
    else v *= 0.90;
  }

  // Replacement-level discipline. Paying many multiples of the remaining-slot
  // average is only allowed for genuine elite players.
  const qualityAllowance = p.rating >= 89 ? 3.4 : p.rating >= 84 ? 2.5 : p.rating >= 78 ? 1.8 : 1.25;
  const slotCap = budget.avgPerRemainingSlot * qualityAllowance;
  if (budget.slotsNeeded > 0) v = Math.min(v, slotCap);

  // Earlier in the auction, preserve more purse. Relax only after the core is built.
  const lim = MODE_LIMITS[mode] || MODE_LIMITS.mega;
  const progress = auctionPhase(room, team);
  const purseShare = lim.purseShareEarly + (lim.purseShareLate - lim.purseShareEarly) * progress;
  const eliteBonus = p.rating >= 89 && budget.slotsNeeded <= 8 ? 0.08 : 0;
  v = Math.min(v, team.purse * (purseShare + eliteBonus));

  // Hard category cap and strategic reserve are final safeguards.
  v = Math.min(v, playerPriceCap(p, mode));
  v = Math.min(v, budget.spendable);
  v = Math.min(v, maxBid(team));

  // Near the end, help the AI complete 18, but never override the price cap.
  if (budget.slotsNeeded > 0 && room.remainingLots() <= budget.slotsNeeded * 2.2) {
    v = Math.max(v, Math.min(p.base * 1.35, playerPriceCap(p, mode), maxBid(team)));
  }

  return Math.max(0, Math.floor(v));
}

/** Highest bid the AI is prepared to make on this lot now. */
function willingness(room, team, lot) {
  const p = room.players[lot.pid];
  const ctx = lot.ai[team.id] || { noise: 1, push: 1, quit: 1 };
  let w = teamValue(room, team, p, { noise: ctx.noise });
  const leader = lot.leader && room.teams[lot.leader];
  const diff = DIFFICULTY[room.settings.difficulty] || DIFFICULTY.normal;

  // Price-pushing is small, only below fair value, and never raises the valuation cap.
  if (leader && leader.controlledBy === 'human' && p.rating >= 80 && ctx.push < diff.push) {
    const fair = teamValue(room, team, p, { noise: 1 });
    const current = lot.bid || 0;
    if (current < fair * 0.78 && team.purse > current * 4) {
      w = Math.min(w, fair * 1.04);
    }
  }

  return Math.floor(w * ctx.quit);
}

/** Per-lot random context so each team behaves consistently within one lot. */
function lotContext(room) {
  const diff = DIFFICULTY[room.settings.difficulty] || DIFFICULTY.normal;
  const ctx = {};
  for (const t of Object.values(room.teams)) {
    ctx[t.id] = {
      noise: 1 + (Math.random() * 2 - 1) * diff.noise,
      push: Math.random(),
      quit: 0.91 + Math.random() * 0.07,
      snipe: Math.random() < diff.snipe,
    };
  }
  return ctx;
}

// ---------- RTM decisions ----------
function shouldUseRTM(room, team, p, price) {
  const v = teamValue(room, team, p);
  return price <= maxBid(team) && price <= playerPriceCap(p, room.settings.mode) && v >= price * 1.03;
}

function rtmRaise(room, team, p, price) {
  const v = teamValue(room, team, p);
  const minimum = price + increment(price);
  if (v < minimum) return null;

  // Raise close to value, not automatically 30% above the current bid.
  const target = Math.min(v, price * 1.10, playerPriceCap(p, room.settings.mode));
  const amt = snapUp(target, minimum);
  return amt <= v && amt <= maxBid(team) ? amt : null;
}

function shouldMatch(room, team, p, price) {
  const v = teamValue(room, team, p);
  return price <= maxBid(team) && price <= playerPriceCap(p, room.settings.mode) && v >= price * 1.02;
}

// ---------- Retention / nomination helpers ----------
function nominate(room, team, unsoldIds, max = 8) {
  return unsoldIds
    .map(id => ({ id, v: teamValue(room, team, room.players[id]) }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, max)
    .map(x => x.id);
}

module.exports = {
  marketValue,
  teamValue,
  willingness,
  lotContext,
  shouldUseRTM,
  rtmRaise,
  shouldMatch,
  nominate,
  DIFFICULTY,
  roleCounts,
  playerPriceCap,
  budgetState,
};
