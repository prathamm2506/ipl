export const fmt = (l) => (l == null ? '—' : l >= 100 ? `₹${(l / 100).toFixed(2).replace(/\.?0+$/, '')} Cr` : `₹${l} L`);
export const increment = (a) => (a < 100 ? 5 : a < 200 ? 10 : a < 500 ? 20 : 25);
export const stepsAbove = (a, n) => { let x = a; for (let i = 0; i < n; i++) x += increment(x); return x; };
export const snapUp = (amount, min) => { let a = min; while (a < amount) a += increment(a); return a; };
export const ROLE_LABEL = { BAT: 'Batter', WK: 'Wicketkeeper', AR: 'All-rounder', PACE: 'Fast bowler', SPIN: 'Spinner' };
export const ROLE_SHORT = { BAT: 'BAT', WK: 'WK', AR: 'AR', PACE: 'PACE', SPIN: 'SPIN' };
export const FLAGS = { IND: '🇮🇳', AUS: '🇦🇺', ENG: '🏴', SA: '🇿🇦', NZ: '🇳🇿', WI: '🌴', AFG: '🇦🇫', SL: '🇱🇰', BAN: '🇧🇩' };
export const RETAIN_SLABS = [1800, 1400, 1100, 1800, 1400];
export const reserveNeeded = (squadLen) => Math.max(0, 18 - (squadLen + 1)) * 30;
export const cls = (...a) => a.filter(Boolean).join(' ');

let audioCtx;
export function beep(freq = 660, ms = 120, type = 'square', vol = 0.05) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* audio not available */ }
}
