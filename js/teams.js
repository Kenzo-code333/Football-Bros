// Eight original teams, procedural logos and the team-editor overrides.
import { storeGet, storeSet } from './config.js';

const BASE_TEAMS = [
  { id: 'volts',    city: 'Neon City',  name: 'Volts',     abbr: 'NCV', primary: '#ffd21f', secondary: '#4b1d8f', accent: '#ffffff', emblem: 'bolt',   shape: 'shield',  helmet: 'stripe', jersey: 'sleeves', rating: 78 },
  { id: 'mammoths', city: 'Ironridge',  name: 'Mammoths',  abbr: 'IRM', primary: '#ff7a1a', secondary: '#3a4049', accent: '#e9e3d6', emblem: 'tusk',   shape: 'circle',  helmet: 'horns',  jersey: 'stripes', rating: 74 },
  { id: 'riptide',  city: 'Bayport',    name: 'Riptide',   abbr: 'BPR', primary: '#14d1c4', secondary: '#0c2a52', accent: '#f5f7fa', emblem: 'wave',   shape: 'hex',     helmet: 'double', jersey: 'split',   rating: 76 },
  { id: 'comets',   city: 'Desert',     name: 'Comets',    abbr: 'DSC', primary: '#ff4b2b', secondary: '#ffcf8a', accent: '#2a1408', emblem: 'star',   shape: 'diamond', helmet: 'stripe', jersey: 'solid',   rating: 72 },
  { id: 'yetis',    city: 'Northpeak',  name: 'Yetis',     abbr: 'NPY', primary: '#8fd8ff', secondary: '#ffffff', accent: '#1b3d6e', emblem: 'peak',   shape: 'circle',  helmet: 'none',   jersey: 'sleeves', rating: 70 },
  { id: 'foxes',    city: 'Crimson',    name: 'Foxes',     abbr: 'CRF', primary: '#d61f3c', secondary: '#141414', accent: '#f2f2f2', emblem: 'fox',    shape: 'shield',  helmet: 'mohawk', jersey: 'stripes', rating: 77 },
  { id: 'wardens',  city: 'Emerald',    name: 'Wardens',   abbr: 'EMW', primary: '#18b85c', secondary: '#f2c14e', accent: '#0b2414', emblem: 'crown',  shape: 'hex',     helmet: 'double', jersey: 'solid',   rating: 75 },
  { id: 'specters', city: 'Midnight',   name: 'Specters',  abbr: 'MNS', primary: '#c43cff', secondary: '#121225', accent: '#7af7ff', emblem: 'ghost',  shape: 'diamond', helmet: 'stripe', jersey: 'split',   rating: 79 },
];

export const HELMETS = ['none', 'stripe', 'double', 'horns', 'mohawk'];
export const JERSEYS = ['solid', 'sleeves', 'stripes', 'split'];

let overrides = storeGet('teamOverrides', {});

export function getTeams() {
  return BASE_TEAMS.map((t, i) => ({ ...t, ...(overrides[t.id] || {}), index: i }));
}
export function getTeam(i) { return getTeams()[((i % 8) + 8) % 8]; }
export function teamIndexById(id) { return BASE_TEAMS.findIndex(t => t.id === id); }
export function saveTeamOverride(id, data) {
  overrides[id] = { ...(overrides[id] || {}), ...data };
  storeSet('teamOverrides', overrides);
  logoCache.clear();
}
export function resetTeamOverride(id) {
  delete overrides[id];
  storeSet('teamOverrides', overrides);
  logoCache.clear();
}
export function baseTeam(id) { return BASE_TEAMS.find(t => t.id === id); }

export function playerNumber() { return storeGet('myNumber', 7); }
export function setPlayerNumber(n) { storeSet('myNumber', n); }

// Pseudo-random jersey numbers per team (stable)
export function rosterNumbers(team) {
  let h = 0; for (const c of team.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const nums = [];
  while (nums.length < 3) { h = (h * 1103515245 + 12345) >>> 0; const n = 1 + (h >>> 8) % 89; if (!nums.includes(n)) nums.push(n); }
  return nums;
}

// ---------------- Logos ----------------
const logoCache = new Map();

function shapePath(ctx, shape, s) {
  const c = s / 2, r = s * 0.46;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(c, c, r, 0, Math.PI * 2);
  else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); } ctx.closePath(); }
  else if (shape === 'diamond') { ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c); ctx.closePath(); }
  else { // shield
    ctx.moveTo(c - r * 0.85, c - r * 0.85); ctx.lineTo(c + r * 0.85, c - r * 0.85);
    ctx.lineTo(c + r * 0.85, c - r * 0.1); ctx.quadraticCurveTo(c + r * 0.8, c + r * 0.65, c, c + r);
    ctx.quadraticCurveTo(c - r * 0.8, c + r * 0.65, c - r * 0.85, c - r * 0.1); ctx.closePath();
  }
}

function emblemPath(ctx, emblem, s) {
  const u = s / 100;
  ctx.save(); ctx.translate(s / 2, s / 2); ctx.scale(u, u);
  ctx.beginPath();
  switch (emblem) {
    case 'bolt':
      ctx.moveTo(6, -34); ctx.lineTo(-18, 4); ctx.lineTo(-2, 4); ctx.lineTo(-8, 34); ctx.lineTo(18, -6); ctx.lineTo(2, -6); ctx.lineTo(10, -34); ctx.closePath(); break;
    case 'tusk':
      ctx.moveTo(-26, -20); ctx.quadraticCurveTo(-30, 18, 4, 28); ctx.quadraticCurveTo(-14, 10, -12, -20); ctx.closePath();
      ctx.moveTo(26, -20); ctx.quadraticCurveTo(30, 18, -4, 28); ctx.quadraticCurveTo(14, 10, 12, -20); ctx.closePath(); break;
    case 'wave':
      ctx.moveTo(-32, 18); ctx.bezierCurveTo(-30, -20, 10, -34, 26, -10); ctx.bezierCurveTo(10, -18, -4, -8, 2, 6);
      ctx.bezierCurveTo(10, 0, 22, 6, 32, 18); ctx.closePath(); break;
    case 'star':
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 13 : 32; const a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(a) * r - 4, Math.sin(a) * r); }
      ctx.closePath(); ctx.moveTo(18, -6); ctx.lineTo(36, -16); ctx.lineTo(20, 4); ctx.closePath(); break;
    case 'peak':
      ctx.moveTo(-34, 26); ctx.lineTo(-8, -26); ctx.lineTo(4, -6); ctx.lineTo(12, -16); ctx.lineTo(34, 26); ctx.closePath(); break;
    case 'fox':
      ctx.moveTo(-28, -30); ctx.lineTo(-10, -12); ctx.lineTo(10, -12); ctx.lineTo(28, -30); ctx.lineTo(24, 2); ctx.lineTo(0, 30); ctx.lineTo(-24, 2); ctx.closePath(); break;
    case 'crown':
      ctx.moveTo(-30, 22); ctx.lineTo(-32, -18); ctx.lineTo(-14, 0); ctx.lineTo(0, -28); ctx.lineTo(14, 0); ctx.lineTo(32, -18); ctx.lineTo(30, 22); ctx.closePath(); break;
    case 'ghost':
      ctx.moveTo(-24, 28); ctx.lineTo(-24, -6); ctx.bezierCurveTo(-24, -40, 24, -40, 24, -6); ctx.lineTo(24, 28);
      ctx.lineTo(12, 18); ctx.lineTo(0, 28); ctx.lineTo(-12, 18); ctx.closePath(); break;
  }
  ctx.restore();
}

function emblemDetails(ctx, emblem, s, col) {
  const u = s / 100; ctx.save(); ctx.translate(s / 2, s / 2); ctx.scale(u, u); ctx.fillStyle = col;
  if (emblem === 'fox') { ctx.beginPath(); ctx.arc(-9, 0, 4, 0, 7); ctx.arc(9, 0, 4, 0, 7); ctx.fill(); }
  if (emblem === 'ghost') { ctx.beginPath(); ctx.ellipse(-9, -6, 4, 7, 0, 0, 7); ctx.ellipse(9, -6, 4, 7, 0, 0, 7); ctx.fill(); }
  if (emblem === 'peak') { ctx.beginPath(); ctx.moveTo(-8, -26); ctx.lineTo(-17, -8); ctx.lineTo(-8, -13); ctx.lineTo(0, -10); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

export function drawLogo(team, size = 256) {
  const key = team.id + size + team.primary + team.secondary + team.accent;
  if (logoCache.has(key)) return logoCache.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.lineJoin = 'round';
  // outer badge
  shapePath(ctx, team.shape, size);
  ctx.fillStyle = team.secondary; ctx.fill();
  ctx.lineWidth = size * 0.05; ctx.strokeStyle = team.accent; ctx.stroke();
  ctx.save(); ctx.translate(size * 0.09, size * 0.09); ctx.scale(0.82, 0.82); shapePath(ctx, team.shape, size);
  ctx.lineWidth = size * 0.025; ctx.strokeStyle = team.primary; ctx.stroke(); ctx.restore();
  // emblem with shadow
  ctx.save(); ctx.translate(size * 0.02, size * 0.025); emblemPath(ctx, team.emblem, size);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(); ctx.restore();
  emblemPath(ctx, team.emblem, size);
  const g = ctx.createLinearGradient(0, size * 0.2, 0, size * 0.8);
  g.addColorStop(0, team.primary); g.addColorStop(1, shade(team.primary, -0.25));
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = size * 0.022; ctx.strokeStyle = team.accent; ctx.stroke();
  emblemDetails(ctx, team.emblem, size, team.secondary);
  logoCache.set(key, cv);
  return cv;
}

export function logoDataURL(team, size = 128) { return drawLogo(team, size).toDataURL(); }

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((f - r) * p + r); g = Math.round((f - g) * p + g); b = Math.round((f - b) * p + b);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// pick a contrasting team color for the away team if both are too similar
export function colorDistance(a, b) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const dr = ((pa >> 16) & 255) - ((pb >> 16) & 255), dg = ((pa >> 8) & 255) - ((pb >> 8) & 255), db = (pa & 255) - (pb & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
