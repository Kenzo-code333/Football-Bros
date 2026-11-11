// Playbook: offensive plays (routes) and defensive calls, plus route-diagram drawing.
// Route points are [forward, lateral] offsets from the player's formation spot.
// forward is toward the opponent's end zone; lateral is world Z (mirrored in diagrams for team 1).

export const FORMATION = {
  offense: { qb: [-4, 0], wr: [-0.6, -10], flex: [-1.2, 6] },
  defense: { lb: [5, 0], cb: [6, -10], s: [12, 4] },
};

// role order per slot
export const OFF_ROLES = ['qb', 'wr', 'flex'];
export const DEF_ROLES = ['lb', 'cb', 's'];

export const OFF_PLAYS = {
  bomb:   { id: 'bomb',   name: 'Deep Bomb',    tag: 'DEEP', type: 'pass', drop: 5, desc: 'Both receivers fly deep. Hold SPACE to lob it.',
            routes: { wr: [[3, 0], [34, 0]], flex: [[7, 0], [26, -9]] }, read: ['wr', 'flex'] },
  verts:  { id: 'verts',  name: 'Double Go',    tag: 'DEEP', type: 'pass', drop: 5, desc: 'Streaks up both seams with a late stutter.',
            routes: { wr: [[10, 0], [11, 1.5], [34, 1.5]], flex: [[6, 0], [7, -1.5], [32, -1.5]] }, read: ['flex', 'wr'] },
  slant:  { id: 'slant',  name: 'Quick Slant',  tag: 'SHORT', type: 'pass', drop: 2, desc: 'Fast inside slant with a flat option.',
            routes: { wr: [[3, 0], [10, 7], [16, 11]], flex: [[1, 0], [3, 5], [5, 9]] }, read: ['wr', 'flex'] },
  curl:   { id: 'curl',   name: 'Curl & Flat',  tag: 'SHORT', type: 'pass', drop: 3, desc: 'WR curls back to the QB, slot leaks to the flat.',
            routes: { wr: [[11, 0], [9, 1.5]], flex: [[2, 0], [4, 8], [8, 9]] }, read: ['wr', 'flex'] },
  mesh:   { id: 'mesh',   name: 'Mesh Cross',   tag: 'SHORT', type: 'pass', drop: 3, desc: 'Receivers cross underneath to rub defenders.',
            routes: { wr: [[4, 0], [6, 14], [8, 22]], flex: [[5, 0], [8, -12], [12, -20]] }, read: ['flex', 'wr'] },
  screen: { id: 'screen', name: 'Bubble Screen', tag: 'SHORT', type: 'pass', drop: 2, desc: 'Slot drifts back for a quick toss, WR blocks.',
            routes: { wr: 'block', flex: [[-2, 2], [-1, 7], [10, 9]] }, read: ['flex'] },
  qbrun:  { id: 'qbrun',  name: 'QB Run',       tag: 'RUN', type: 'run', carrier: 'qb', desc: 'QB keeps it. Receivers block. Juke your way through!',
            routes: { wr: 'block', flex: 'lead' }, runPath: [[3, 3], [25, 3]] },
  sweep:  { id: 'sweep',  name: 'Jet Sweep',    tag: 'RUN', type: 'run', carrier: 'flex', desc: 'Instant handoff to the slot, sprint for the edge.',
            routes: { wr: 'block', flex: [[-2.4, -5], [-2.2, -12], [4, -17], [26, -17]] }, runPath: [[-2.4, -5], [-2.2, -12], [4, -17], [26, -17]] },
};

const DEEP = ['bomb', 'verts'], SHORT = ['slant', 'curl', 'mesh', 'screen'], RUN = ['qbrun', 'sweep'];

// Offer three plays: one deep, one short, one run (first offer always the classic trio)
export function offerPlays(first = false) {
  if (first) return ['bomb', 'slant', 'qbrun'];
  const r = a => a[Math.floor(Math.random() * a.length)];
  return [r(DEEP), r(SHORT), r(RUN)];
}

export const DEF_PLAYS = {
  blitz: { id: 'blitz', name: 'Blitz', tag: 'PRESSURE', desc: 'Two rushers attack the QB. Risky vs deep balls.' },
  cover: { id: 'cover', name: 'Cover', tag: 'COVERAGE', desc: 'Man-to-man with a deep safety over the top.' },
  spy:   { id: 'spy',   name: 'Spy',   tag: 'CONTAIN', desc: 'One defender mirrors the QB. Stops scrambles.' },
};
export const DEF_LIST = ['blitz', 'cover', 'spy'];

// ---------- Diagram drawing ----------
export function drawPlayDiagram(canvas, playId, isDefense, color = '#ffd21f', mirror = false) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // turf
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#174d2a'); g.addColorStop(1, '#0e3a1e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 5); ctx.lineTo(W, H * i / 5); ctx.stroke(); }
  const losY = H * 0.72;
  ctx.strokeStyle = 'rgba(120,190,255,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, losY); ctx.lineTo(W, losY); ctx.stroke();
  const sx = W / 30, sy = H / 34;
  const P = (fwd, lat) => [W / 2 + (mirror ? -lat : lat) * sx, losY - fwd * sy];
  const arrow = (pts, col, dashed) => {
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    ctx.setLineDash([]);
    const a = pts[pts.length - 1], b = pts[pts.length - 2] || a;
    const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(a[0] + Math.cos(ang) * 7, a[1] + Math.sin(ang) * 7);
    ctx.lineTo(a[0] + Math.cos(ang + 2.4) * 7, a[1] + Math.sin(ang + 2.4) * 7);
    ctx.lineTo(a[0] + Math.cos(ang - 2.4) * 7, a[1] + Math.sin(ang - 2.4) * 7); ctx.fill();
  };
  const blockT = (p, col) => { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 12); ctx.moveTo(p[0] - 7, p[1] - 12); ctx.lineTo(p[0] + 7, p[1] - 12); ctx.stroke(); };
  const circ = (p, col, label) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    if (label) { ctx.fillStyle = '#000'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, p[0], p[1] + 0.5); } };
  const cross = (p, col) => { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p[0] - 6, p[1] - 6); ctx.lineTo(p[0] + 6, p[1] + 6); ctx.moveTo(p[0] + 6, p[1] - 6); ctx.lineTo(p[0] - 6, p[1] + 6); ctx.stroke(); };

  const off = FORMATION.offense, def = FORMATION.defense;
  if (!isDefense) {
    const play = OFF_PLAYS[playId];
    for (const role of ['wr', 'flex']) {
      const st = off[role], r = play.routes[role];
      const p0 = P(st[0], st[1]);
      if (r === 'block' || r === 'lead') blockT(p0, '#ffffff');
      else arrow([p0, ...r.map(q => P(st[0] + q[0], st[1] + q[1]))], color, play.type === 'run' && play.carrier === role);
    }
    const q0 = P(off.qb[0], off.qb[1]);
    if (play.type === 'run' && play.carrier === 'qb') arrow([q0, ...play.runPath.map(q => P(off.qb[0] + q[0], off.qb[1] + q[1]))], '#ffffff', true);
    else if (play.type === 'pass') arrow([q0, P(off.qb[0] - play.drop * 0.6, off.qb[1])], 'rgba(255,255,255,0.6)');
    circ(q0, '#fff', 'QB'); circ(P(off.wr[0], off.wr[1]), color, 'WR'); circ(P(off.flex[0], off.flex[1]), color, 'S');
  } else {
    const lb = P(def.lb[0] - 3, def.lb[1]), cb = P(def.cb[0] - 4, def.cb[1]), s = P(def.s[0] - 3, def.s[1]);
    const qb = P(off.qb[0], 0);
    ctx.globalAlpha = 0.45; circ(qb, '#fff'); circ(P(off.wr[0], off.wr[1]), '#aaa'); circ(P(off.flex[0], off.flex[1]), '#aaa'); ctx.globalAlpha = 1;
    if (playId === 'blitz') { arrow([lb, qb], color); arrow([s, P(4, 3), P(off.qb[0] + 1.5, 1)], color); arrow([cb, P(def.cb[0] + 6, def.cb[1] + 2)], '#fff', true); }
    else if (playId === 'cover') { arrow([cb, P(16, -10)], '#fff', true); arrow([lb, P(12, 6)], '#fff', true);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(s[0], P(22, 0)[1], 50, 14, 0, 0, 7); ctx.stroke(); arrow([s, P(20, 0)], color); }
    else { arrow([lb, P(def.lb[0] - 2, 6), P(def.lb[0] - 2, -6)], color, true); arrow([cb, P(16, -10)], '#fff', true); arrow([s, P(18, 6)], '#fff', true); }
    cross(lb, color); cross(cb, color); cross(s, color);
  }
}
