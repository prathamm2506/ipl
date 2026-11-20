// All money is in LAKHS (integers). 100 L = 1 Cr.
const RULES = {
  PURSE: 12000,            // ₹120 Cr
  MIN_SQUAD: 18,
  MAX_SQUAD: 25,
  MAX_OVERSEAS: 8,
  MIN_SLOT_RESERVE: 30,    // ₹30 L must be kept for every empty slot below 18
  RETAIN_CAPPED_SLABS: [1800, 1400, 1100, 1800, 1400],
  RETAIN_UNCAPPED: 400,
  MAX_RETAIN_TOTAL: 6,     // retentions + RTMs (mega)
  MAX_RETAIN_CAPPED: 5,
  MAX_RETAIN_UNCAPPED: 2,
  MINI_OVERSEAS_SALARY_CAP: 1800, // mini auction: overseas paid max ₹18 Cr, excess to BCCI
};

function increment(amount) {
  if (amount < 100) return 5;
  if (amount < 200) return 10;
  if (amount < 500) return 20;
  return 25;
}

/** Next legal bid given the current lot. */
function nextBid(lot) {
  if (lot.bid == null) return lot.base;
  return lot.bid + increment(lot.bid);
}

/** Bid `steps` increments above the current bid. */
function stepsAbove(amount, steps) {
  let a = amount;
  for (let i = 0; i < steps; i++) a += increment(a);
  return a;
}

/** Snap an arbitrary amount up to a valid ladder value >= minimum. */
function snapUp(amount, minimum) {
  let a = minimum;
  while (a < amount) a += increment(a);
  return a;
}

function reserveNeeded(team, extraPlayers = 1) {
  const left = RULES.MIN_SQUAD - (team.squad.length + extraPlayers);
  return Math.max(0, left) * RULES.MIN_SLOT_RESERVE;
}

function overseasCount(team, players) {
  return team.squad.reduce((n, s) => n + (players[s.pid].overseas ? 1 : 0), 0);
}

/** Highest legal bid this team can make right now. */
function maxBid(team) {
  return team.purse - reserveNeeded(team, 1);
}

/** Can the team legally add this player at all (slots / overseas)? */
function hasRoomFor(team, player, players) {
  if (team.squad.length >= RULES.MAX_SQUAD) return false;
  if (player.overseas && overseasCount(team, players) >= RULES.MAX_OVERSEAS) return false;
  return true;
}

function canBid(team, player, players, amount) {
  return hasRoomFor(team, player, players) && amount <= maxBid(team);
}

const fmt = (l) => (l >= 100 ? `₹${(l / 100).toFixed(2).replace(/\.?0+$/, '')} Cr` : `₹${l} L`);

module.exports = { RULES, increment, nextBid, stepsAbove, snapUp, reserveNeeded, overseasCount, maxBid, hasRoomFor, canBid, fmt };
