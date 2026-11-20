// AI bidding brain. Pure functions over room state so it's easy to test and tune.
const { RULES, maxBid, hasRoomFor, increment, snapUp, overseasCount } = require('./rules');

const TARGET = { BAT: 5, WK: 2, AR: 5, PACE: 5, SPIN: 3 };

const DIFFICULTY = {
  easy:   { value: 0.88, noise: 0.16, push: 0.0,  snipe: 0.0  },
  normal: { value: 1.0,  noise: 0.11, push: 0.25, snipe: 0.12 },
  hard:   { value: 1.08, noise: 0.08, push: 0.45, snipe: 0.25 },
};

/** Fair market value in lakhs, before team-specific adjustments. */
function marketValue(p, mode) {
  let v = 30 * Math.exp((p.rating - 55) * 0.125); // r90 ≈ ₹24 Cr, r80 ≈ ₹7 Cr, r70 ≈ ₹2 Cr
  if (mode === 'mega') v *= p.overseas ? 0.72 : p.capped ? 1.2 : 1; // Indian capped stars are scarce; overseas depth is huge
  if (mode === 'mini') v *= p.overseas ? 1.3 : 1.15;               // thin pool, purses concentrated
  if (!p.capped && p.age <= 23 && p.rating >= 66) v *= 1.25;       // young uncapped hype
  return Math.max(p.base, v);
}

function roleCounts(team, players) {
  const c = { BAT: 0, WK: 0, AR: 0, PACE: 0, SPIN: 0 };
  for (const s of team.squad) c[players[s.pid].role]++;
  return c;
}

function needMultiplier(team, p, players) {
  const have = roleCounts(team, players);
  const deficit = TARGET[p.role] - have[p.role];
  let m = deficit > 0 ? 1 + 0.12 * Math.min(deficit, 3) : deficit >= -1 ? 0.8 : 0.55;
  if (p.role === 'WK' && have.WK === 0) m *= 1.25;
  if (p.overseas) {
    const os = overseasCount(team, players);
    if (os >= 6) m *= 0.8;
  }
  return m;
}

function personaMultiplier(persona, p) {
  let m = persona.aggression;
  if (p.rating >= 85) m += persona.star;
  if (p.age <= 24) m += persona.youth;
  if (p.age >= 31) m += persona.experience;
  if (p.overseas) m += persona.overseas;
  if (p.rating < 75) m += persona.bargain;
  if (p.role === 'SPIN') m += persona.spin;
  return m;
}

/** How much this team truly values the player (no tricks). */
function teamValue(room, team, p, opts = {}) {
  const players = room.players;
  if (!hasRoomFor(team, p, players)) return 0;
  const diff = DIFFICULTY[room.settings.difficulty] || DIFFICULTY.normal;
  const noise = opts.noise ?? 1;
  let v = marketValue(p, room.settings.mode) * needMultiplier(team, p, players) * personaMultiplier(team.persona, p) * noise * diff.value;

  // Saving for a better target of the same role still to come.
  const better = room.upcomingSameRoleBetter(p);
  if (better && team.purse < marketValue(better, room.settings.mode) * 2) v *= 0.88;

  // Budget discipline: don't blow the purse on one player while many slots are empty.
  const slotsNeeded = Math.max(0, RULES.MIN_SQUAD - team.squad.length);
  const share = p.rating >= 88 ? (slotsNeeded > 6 ? 0.5 : 0.75) : (slotsNeeded > 6 ? 0.38 : 0.6);
  v = Math.min(v, team.purse * share);
  // AI keeps a safety margin (₹65 L per empty slot below 18) on top of the official ₹30 L rule.
  v = Math.min(v, team.purse - Math.max(0, RULES.MIN_SQUAD - team.squad.length - 1) * 65);

  // Must still fill the squad to 18 when lots are running out.
  if (slotsNeeded > 0 && room.remainingLots() <= slotsNeeded * 2.5) v = Math.max(v, Math.min(p.base * 2, maxBid(team)));
  return Math.max(0, Math.min(v, maxBid(team)));
}

/**
 * Highest bid the AI is prepared to make on this lot right now, including auction tricks:
 *  - price-pushing a human rival on a player they clearly want
 *  - a per-lot "walk-away" point so the AI doesn't always bid exactly to its limit
 */
function willingness(room, team, lot) {
  const p = room.players[lot.pid];
  const ctx = lot.ai[team.id] || { noise: 1, push: 1, quit: 1 };
  let w = teamValue(room, team, p, { noise: ctx.noise });
  const leader = lot.leader && room.teams[lot.leader];
  const diff = DIFFICULTY[room.settings.difficulty] || DIFFICULTY.normal;
  if (leader && leader.controlledBy === 'human' && p.rating >= 76 && ctx.push < diff.push && team.purse > (lot.bid || 0) * 3) {
    w = Math.max(w, Math.min(w * 1.18, maxBid(team))); // push the human to pay more
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
      quit: 0.9 + Math.random() * 0.1,
      snipe: Math.random() < diff.snipe,
    };
  }
  return ctx;
}

// ---------- RTM decisions ----------
function shouldUseRTM(room, team, p, price) {
  const v = teamValue(room, team, p);
  return v >= price * 0.95 && price <= maxBid(team);
}
function rtmRaise(room, team, p, price) {
  const v = teamValue(room, team, p);
  if (v <= price + increment(price)) return null;
  const target = Math.min(v, price * 1.3);
  const amt = snapUp(target, price + increment(price));
  return amt <= maxBid(team) ? amt : null;
}
function shouldMatch(room, team, p, price) {
  return price <= maxBid(team) && teamValue(room, team, p) >= price * 0.95;
}

// ---------- Retention / nomination helpers ----------
function nominate(room, team, unsoldIds, max = 8) {
  return unsoldIds
    .map((id) => ({ id, v: teamValue(room, team, room.players[id]) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, max)
    .map((x) => x.id);
}

module.exports = { marketValue, teamValue, willingness, lotContext, shouldUseRTM, rtmRaise, shouldMatch, nominate, DIFFICULTY, roleCounts };
