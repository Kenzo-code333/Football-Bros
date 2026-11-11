// AI for teammates and opponents. Produces input-like commands consumed by the sim.
import { FIELD, clamp, rand } from './config.js';
import { ACT, dirOf } from './sim.js';

const ACTIVE = p => p.act !== ACT.DOWN && p.act !== ACT.TUMBLE && p.act !== ACT.GETUP;

function seek(p, tx, tz, arrive = 1.5) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return { mx: 0, mz: 0, d };
  const s = d < arrive ? d / arrive : 1;
  return { mx: dx / d * s, mz: dz / d * s, d };
}

function nearestOpp(sim, p, filter) {
  let best = null, bd = 1e9;
  for (const q of sim.players) {
    if (q.team === p.team || !ACTIVE(q) || (filter && !filter(q))) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) { bd = d; best = q; }
  }
  return [best, bd];
}

export function aiThink(sim, p, dt) {
  const cmd = { mx: 0, mz: 0, sprint: false, act: 0, throwTo: null };
  const b = sim.ball;
  const diff = sim.aiDiff(p);
  const d = dirOf(p.team);
  if (!ACTIVE(p) || p.act === ACT.DIVE || p.act === ACT.TDIVE) return cmd;

  // --- onside scramble / loose ball: everybody chases ---
  if (b.state === 'loose' || sim.phase === 'onside') {
    const lead = Math.min(0.6, Math.hypot(b.x - p.x, b.z - p.z) / 12);
    const s = seek(p, b.x + b.vx * lead, b.z + b.vz * lead, 0.2);
    cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = true;
    if (s.d < 2.6 && b.y < 0.8 && Math.random() < dt * 3 * diff.pursuit) cmd.act = ACT.DIVE;
    return cmd;
  }

  const carrier = sim.carrier();
  const ballTeam = sim.ballTeam();

  // --- ball in the air ---
  if (b.state === 'air') {
    const tgt = b.target || { x: b.x, z: b.z };
    const tLeft = Math.max(0, b.flightT - b.airT);
    if (p.team === b.lastTeam) {
      if (p.i === b.intended || Math.hypot(p.x - tgt.x, p.z - tgt.z) < 6) {
        const s = seek(p, tgt.x, tgt.z, 0.6);
        cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = s.d > 1.5;
        const hd = Math.hypot(b.x - p.x, b.z - p.z);
        if (hd < 2.2 && b.y > 2.7 && b.y < 4 && b.vy < 0) cmd.act = ACT.JUMP;
      } else return blockFor(sim, p, cmd, null);
      return cmd;
    }
    // defenders react after a delay
    if (b.airT < diff.react * (p.human == null ? 1 : 0)) return defendAssignment(sim, p, cmd, diff, d);
    const r = sim.players[b.intended];
    const aimX = tgt.x * 0.7 + (r ? r.x : tgt.x) * 0.3, aimZ = tgt.z * 0.7 + (r ? r.z : tgt.z) * 0.3;
    const s = seek(p, aimX, aimZ, 0.4);
    cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = true;
    const hd = Math.hypot(b.x - p.x, b.z - p.z);
    const apexT = 6.4 / 16;
    if (hd < 3.2 && tLeft < apexT + 0.15 && tLeft > apexT - 0.25 && Math.random() < diff.jumpTiming * 0.6 + 0.2 && p.cd.jump <= 0) {
      if (Math.random() < diff.jumpTiming) cmd.act = ACT.JUMP;
      else p.cd.jump = 0.6; // hesitated
    }
    return cmd;
  }

  if (!carrier) return cmd;

  // --- I have the ball ---
  if (carrier === p) return carrierAI(sim, p, cmd, diff, d, dt);

  // --- my team has the ball ---
  if (p.team === ballTeam) {
    const qbPhase = carrier.slot === 0 && carrier.team === sim.possession && sim.passAllowed;
    if (p.assign && p.assign.type === 'handoff') { cmd.mx = 0; cmd.mz = 0; return cmd; }
    if ((qbPhase || sim.handoffPending) && p.assign && p.assign.type === 'route' && p.route) return runRoute(sim, p, cmd, d);
    if (p.assign && p.assign.type === 'lead' && sim.liveT < 1.4) {
      const s = seek(p, carrier.x + d * 3, carrier.z + 1.5, 0.5); cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = true; return cmd;
    }
    return blockFor(sim, p, cmd, carrier);
  }

  // --- defense ---
  const qbPhase = carrier.slot === 0 && carrier.team === sim.possession && sim.passAllowed && dirOf(carrier.team) * (carrier.x - sim.los) < 0.5;
  if (qbPhase && p.assign && p.assign.type !== 'chase') return defendAssignment(sim, p, cmd, diff, d);
  return pursue(sim, p, carrier, cmd, diff);
}

function runRoute(sim, p, cmd, d) {
  const route = p.route;
  if (p.routeIdx < route.length) {
    const [tx, tz] = route[p.routeIdx];
    const s = seek(p, tx, tz, 0.1);
    cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = sim.liveT > 0.25;
    if (s.d < 0.9) p.routeIdx++;
    return cmd;
  }
  // route finished: find open grass
  const [opp, od] = nearestOpp(sim, p);
  let mx = d * 0.4, mz = 0;
  if (opp && od < 6) { mx += (p.x - opp.x) / od; mz += (p.z - opp.z) / od; }
  if (Math.abs(p.z) > FIELD.halfWid - 3) mz -= Math.sign(p.z) * 1.2;
  if (d * p.x > FIELD.endLine - 4) mx -= d;
  const l = Math.hypot(mx, mz) || 1;
  cmd.mx = mx / l * 0.75; cmd.mz = mz / l * 0.75; cmd.sprint = false;
  return cmd;
}

function blockFor(sim, p, cmd, carrier) {
  const ref = carrier || p;
  // pick the most dangerous defender to the carrier not already being blocked
  let best = null, bs = 1e9;
  for (const q of sim.players) {
    if (q.team === p.team || !ACTIVE(q)) continue;
    let score = Math.hypot(q.x - ref.x, q.z - ref.z) + Math.hypot(q.x - p.x, q.z - p.z) * 0.6;
    for (const o of sim.players) if (o !== p && o.team === p.team && o !== carrier && Math.hypot(o.x - q.x, o.z - q.z) < 1.4) score += 6;
    if (score < bs) { bs = score; best = q; }
  }
  if (!best) { const s = seek(p, ref.x + dirOf(p.team) * 4, ref.z, 1); cmd.mx = s.mx; cmd.mz = s.mz; return cmd; }
  // stand between defender and carrier
  const vx = ref.x - best.x, vz = ref.z - best.z, vl = Math.hypot(vx, vz) || 1;
  const tx = best.x + vx / vl * 0.9 + best.vx * 0.15, tz = best.z + vz / vl * 0.9 + best.vz * 0.15;
  const s = seek(p, tx, tz, 0.3);
  cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = s.d > 2;
  return cmd;
}

function carrierAI(sim, p, cmd, diff, d, dt) {
  const isPasser = p.slot === 0 && p.team === sim.possession && sim.passAllowed && p.assign && p.assign.type === 'qb';
  const ai = p.ai;
  if (p.assign && p.assign.type === 'handoff' && sim.handoffPending) return cmd;
  if (isPasser) {
    const drop = sim.offPlay ? sim.offPlay.drop || 3 : 3;
    const dropX = sim.los - d * (4 + drop * 0.6);
    // pressure check
    const [rusher, rd] = nearestOpp(sim, p);
    const pressure = rd < 3.2;
    if (ai.readAt == null) ai.readAt = rand(0.75, 1.3) + (drop > 4 ? 0.6 : 0);
    if (sim.liveT > ai.readAt && (ai.nextRead == null || sim.liveT > ai.nextRead)) {
      ai.nextRead = sim.liveT + 0.15;
      let best = -1, bestScore = -1e9;
      const reads = sim.offPlay && sim.offPlay.read ? sim.offPlay.read : ['wr', 'flex'];
      reads.forEach((role, k) => {
        const r = sim.players[p.team * 3 + (role === 'wr' ? 1 : 2)];
        if (!ACTIVE(r)) return;
        const [, sep] = nearestOpp(sim, r);
        const depth = d * (r.x - sim.los);
        const score = sep * 1.4 + clamp(depth, -3, 25) * 0.12 - k * 0.6 - Math.max(0, Math.abs(r.z) - FIELD.halfWid + 2) * 2;
        if (score > bestScore) { bestScore = score; best = r.i; }
      });
      const late = sim.liveT > 3.4;
      if (best >= 0 && (bestScore > 3.6 - sim.liveT * 0.5 || late || (pressure && bestScore > 1.5))) {
        sim.target[p.team] = best;
        cmd.throwTo = best;
        const tr = sim.players[best];
        const far = Math.abs(tr.x - p.x) > 18;
        cmd.hold = far ? rand(0.45, 0.7) : rand(0.05, 0.25);
        return cmd;
      }
    }
    if (pressure && rusher) {
      // scramble away from pressure
      let mx = (p.x - rusher.x), mz = (p.z - rusher.z);
      const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
      mx = mx * 0.6 - d * 0.1; if (Math.abs(p.z) > FIELD.halfWid - 3) mz -= Math.sign(p.z);
      cmd.mx = mx; cmd.mz = mz; cmd.sprint = true;
      if (rd < 1.8 && Math.random() < diff.juke * 0.25) cmd.act = ACT.SPIN;
      if (sim.liveT > 2.6 && Math.random() < 0.02) { p.assign = { type: 'run' }; }
      return cmd;
    }
    const s = seek(p, dropX, p.z * 0.9, 0.8);
    cmd.mx = s.mx; cmd.mz = s.mz;
    return cmd;
  }
  // ---- ball carrier running ----
  let gx = d, gz = 0;
  if (p.route && p.assign && (p.assign.type === 'run' || p.slot === 2) && sim.liveT < 2.5 && sim.offPlay && sim.offPlay.type === 'run') {
    const route = p.route;
    if (p.routeIdx < route.length) {
      const [tx, tz] = route[p.routeIdx];
      const dx = tx - p.x, dz = tz - p.z, dl = Math.hypot(dx, dz);
      if (dl < 1.2) p.routeIdx++; else { gx = dx / dl; gz = dz / dl; }
    }
  }
  let ax = gx * 1.4, az = gz * 1.4;
  let threat = null, td = 1e9;
  for (const q of sim.players) {
    if (q.team === p.team || !ACTIVE(q)) continue;
    const dx = p.x - q.x, dz = p.z - q.z, dl = Math.hypot(dx, dz);
    const ahead = (q.x - p.x) * d > -2;
    if (dl < 8 && ahead) {
      const w = (8 - dl) / 8;
      ax += dx / dl * w * 1.2 * 0.6; az += dz / dl * w * 1.6;
    }
    if (dl < td) { td = dl; threat = q; }
  }
  // sidelines
  const edge = FIELD.halfWid - Math.abs(p.z);
  if (edge < 3) az -= Math.sign(p.z) * (3 - edge) * 0.8;
  const l = Math.hypot(ax, az) || 1;
  cmd.mx = ax / l; cmd.mz = az / l;
  cmd.sprint = p.stamina > 0.15 || td < 5;
  // moves
  if (threat && td < 2.8 && td > 1.0) {
    const r = Math.random();
    const k = diff.juke * dt * 9;
    if (r < k * 0.5 && p.cd.juke <= 0) { cmd.act = ACT.JUKE; cmd.side = (threat.z - p.z) > 0 ? -1 : 1; }
    else if (r < k * 0.75 && p.cd.spin <= 0) cmd.act = ACT.SPIN;
    else if (r < k && p.cd.stiff <= 0) cmd.act = ACT.STIFF;
  }
  // dive for the pylon / first down
  const toGoal = FIELD.goal - d * p.x;
  if (threat && td < 2.4 && ((toGoal > 0.5 && toGoal < 3.6) || (d * (sim.fdX - p.x) > 0.3 && d * (sim.fdX - p.x) < 2.5)) && Math.random() < 0.3) cmd.act = ACT.DIVE;
  return cmd;
}

function defendAssignment(sim, p, cmd, diff, d) {
  // d is the defender's own attack direction; offense attacks -d
  const od = -d;
  const qb = sim.players[sim.possession * 3];
  const a = p.assign || { type: 'man', target: sim.possession * 3 + 1 };
  if (a.type === 'rush') {
    if (sim.liveT < (a.delay || 0)) { cmd.mx = 0; cmd.mz = 0; return cmd; }
    return pursue(sim, p, qb, cmd, diff);
  }
  if (a.type === 'spy') {
    const tx = sim.los + od * 4.5, tz = qb.z;
    const s = seek(p, tx, tz, 1.2); cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = Math.abs(qb.z - p.z) > 3;
    if (Math.hypot(qb.x - p.x, qb.z - p.z) < 3.5 && sim.liveT > 2.2) return pursue(sim, p, qb, cmd, diff);
    return cmd;
  }
  if (a.type === 'deep') {
    // deepest receiver
    let deep = null, dd = -1e9;
    for (const q of sim.players) if (q.team === sim.possession && q.slot !== 0) { const dep = od * q.x; if (dep > dd) { dd = dep; deep = q; } }
    const depthX = deep ? deep.x + od * 5 : sim.los + od * 12;
    let tx = od > 0 ? Math.max(depthX, sim.los + od * 8) : Math.min(depthX, sim.los + od * 8);
    if (Math.abs(tx) > FIELD.endLine - 1) tx = Math.sign(tx) * (FIELD.endLine - 1);
    const tz = deep ? deep.z * 0.7 : 0;
    const s = seek(p, tx, tz, 1); cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = s.d > 4;
    return cmd;
  }
  // man coverage
  const r = sim.players[a.target];
  if (!r) return cmd;
  const cushion = 1.3 + (1 - diff.pursuit) * 1.5;
  const lag = diff.react * 1.6;
  let tx = r.x - r.vx * lag + od * cushion, tz = r.z - r.vz * lag * 0.6;
  // trail closer when receiver is short
  const s = seek(p, tx, tz, 0.5);
  cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = s.d > 1.8;
  return cmd;
}

function pursue(sim, p, c, cmd, diff) {
  const dist = Math.hypot(c.x - p.x, c.z - p.z);
  const mySpeed = 8.5;
  const lead = clamp(dist / mySpeed, 0, 1.2) * diff.pursuit;
  let tx = c.x + c.vx * lead, tz = c.z + c.vz * lead;
  const s = seek(p, tx, tz, 0.1);
  cmd.mx = s.mx; cmd.mz = s.mz; cmd.sprint = true;
  if (dist < 2.3 && dist > 0.8 && p.cd.tackle <= 0) {
    // closing?
    const cl = ((c.x - p.x) * (p.vx - c.vx) + (c.z - p.z) * (p.vz - c.vz)) / dist;
    if (cl > 1.5 && Math.random() < sim.aiDiff(p).tackle * 0.35) cmd.act = ACT.TDIVE;
  }
  return cmd;
}

// ---------- play calling ----------
export function aiPickOffense(sim) {
  const toGo = Math.abs(sim.fdX - sim.los);
  const opts = sim.offOptions;
  const w = opts.map((id, k) => {
    const deep = k === 0, short = k === 1, run = k === 2;
    if (toGo > 15) return deep ? 3 : short ? 3 : 1.2;
    if (toGo < 6) return run ? 3 : short ? 2.4 : 1;
    return deep ? 2 : short ? 3 : 2;
  });
  return weighted(opts, w);
}

export function aiPickDefense(sim) {
  const toGo = Math.abs(sim.fdX - sim.los);
  const w = toGo > 15 ? [1, 4, 2] : toGo < 6 ? [3, 1.5, 2.5] : [2, 3, 2];
  return weighted(['blitz', 'cover', 'spy'], w);
}

function weighted(arr, w) {
  const tot = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}

export function aiConversion(sim, team) {
  const diff = sim.score[team] - sim.score[1 - team];
  if ([-2, -5, -10, 1, 5, -9, -13].includes(diff)) return 2;
  return Math.random() < 0.2 ? 2 : 1;
}

export function aiOnside(sim, team) {
  const diff = sim.score[team] - sim.score[1 - team];
  return diff < 0 && diff >= -16 && sim.quarter >= 4 && sim.clock < 70;
}
