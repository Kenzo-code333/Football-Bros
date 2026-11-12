// Global constants and tunables for Gridiron Blitz.
// Units: 1 world unit = 1 yard. Field runs along X, width along Z.
// The broadcast camera sits on the +Z sideline looking toward -Z.

export const FIELD = {
  goal: 30,          // goal lines at x = ±30 (60 yards of play)
  endLine: 40,       // end lines at x = ±40 (10-yard end zones)
  halfWid: 16,       // sidelines at z = ±16 (32 yards wide for 3v3)
};

export const RULES = {
  quarterLen: 120,       // seconds of live-play clock per quarter
  firstDownYards: 20,
  pickTime: 5,           // play-call timer
  pickTimeAssist: 12,    // longer timer when beginner assist is on
  deadTime: 1.7,         // pause after whistle
  tdCelebrate: 3.0,
  replayLen: 4.2,        // seconds of real time the replay plays back
  convOnePointYards: 5,  // distance from goal for 1-pt try
  convTwoPointYards: 12, // distance from goal for 2-pt try
  touchbackYards: 15,    // own yard line after a score
  onsideSpotYards: 22,   // kicking team's own yard line for onside kick
};

export const PHYS = {
  dt: 1 / 60,
  gravity: 16,           // yd/s^2 (arcade: snappier than real)
  runSpeed: 6.6,
  sprintSpeed: 9.0,
  carrierMul: 0.97,
  accel: 32,
  decel: 26,
  playerRadius: 0.48,
  tackleRange: 0.95,
  diveRange: 1.7,
  catchRadius: 1.25,
  jumpCatchRadius: 1.55,
  pickupRadius: 0.85,
  staminaDrain: 0.26,
  staminaRegen: 0.16,
};

export const COOLDOWNS = { juke: 1.4, spin: 2.4, stiff: 2.0, dive: 1.2, jump: 1.1, tackle: 1.3 };

export const DIFFICULTY = {
  beginner: { name: 'Beginner', speed: 0.8,  react: 0.55, tackle: 0.45, qbAcc: 0.55, catchSkill: 0.7, juke: 0.05, jumpTiming: 0.15, pursuit: 0.5 },
  rookie:  { name: 'Rookie',   speed: 0.86, react: 0.42, tackle: 0.55, qbAcc: 0.65, catchSkill: 0.78, juke: 0.15, jumpTiming: 0.35, pursuit: 0.6 },
  pro:     { name: 'Pro',      speed: 0.95, react: 0.25, tackle: 0.72, qbAcc: 0.8,  catchSkill: 0.86, juke: 0.35, jumpTiming: 0.6,  pursuit: 0.85 },
  allstar: { name: 'All-Star', speed: 1.02, react: 0.12, tackle: 0.86, qbAcc: 0.92, catchSkill: 0.92, juke: 0.6,  jumpTiming: 0.85, pursuit: 1.0 },
};

export const QUALITY = {
  low:    { name: 'Low',    pixelRatio: 0.85, post: false, bloom: false, shadows: false, crowd: 1400, grass: 0,     fieldTex: 2048, particles: 400,  outlines: true, decals: false, liveFeed: false, cones: true },
  medium: { name: 'Medium', pixelRatio: 1.25, post: true,  bloom: true,  shadows: false, crowd: 3600, grass: 14000, fieldTex: 2048, particles: 900,  outlines: true, decals: true,  liveFeed: false, cones: true },
  high:   { name: 'High',   pixelRatio: 2.0,  post: true,  bloom: true,  shadows: true,  crowd: 7000, grass: 36000, fieldTex: 4096, particles: 1600, outlines: true, decals: true,  liveFeed: true,  cones: true },
};

export const ROOM_PREFIX = 'gridiron-blitz-v1-';
export const NET_SNAPSHOT_HZ = 20;
export const NET_INPUT_HZ = 30;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const smoothDamp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

// localStorage helpers (wrapped – some school devices block storage)
export function storeGet(key, fallback) {
  try {
    const v = localStorage.getItem('gblitz.' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
export function storeSet(key, value) {
  try { localStorage.setItem('gblitz.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
}
export function storeDel(key) {
  try { localStorage.removeItem('gblitz.' + key); } catch (e) { /* ignore */ }
}
