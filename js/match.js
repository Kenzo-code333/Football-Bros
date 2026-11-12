// Match controllers: LocalMatch runs the authoritative Sim (single player, local 2P,
// season, online host). ClientMatch renders host snapshots with interpolation and
// predicts the local player's movement.
import { Sim, movePlayer, ACT, emptyInput } from './sim.js';
import { PHYS, NET_SNAPSHOT_HZ, NET_INPUT_HZ, lerp, angleLerp } from './config.js';

const STEP = PHYS.dt;

export function decodeSnap(s) {
  const players = s.p.map(a => ({
    x: a[0], y: a[1], z: a[2], facing: a[3], act: a[4], actT: a[5], actVar: a[6], vx: a[7], vz: a[8], stamina: a[9], flags: a[10],
    tPitch: a[11], tRoll: a[12], human: a[13], cdJ: a[14], cdS: a[15], cdL: a[16], winding: (a[10] & 8) !== 0, hasBall: false,
  }));
  const b = s.b;
  const ball = { x: b[0], y: b[1], z: b[2], vx: b[3], vy: b[4], vz: b[5], state: b[6], holder: b[7], lob: b[8] };
  if (ball.state === 0 && ball.holder >= 0 && players[ball.holder]) players[ball.holder].hasBall = true;
  return { players, ball, g: s.g };
}

function lerpView(a, b, t) {
  if (!a) return b;
  const players = b.players.map((pb, i) => {
    const pa = a.players[i];
    // don't interpolate across big teleports
    if (Math.abs(pa.x - pb.x) > 4 || Math.abs(pa.z - pb.z) > 4) return pb;
    return { ...pb, x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), z: lerp(pa.z, pb.z, t), facing: angleLerp(pa.facing, pb.facing, t),
      tPitch: lerp(pa.tPitch, pb.tPitch, t), tRoll: lerp(pa.tRoll, pb.tRoll, t), vx: lerp(pa.vx, pb.vx, t), vz: lerp(pa.vz, pb.vz, t) };
  });
  const ba = a.ball, bb = b.ball;
  const tele = Math.abs(ba.x - bb.x) > 5 || ba.state !== bb.state;
  const ball = tele ? bb : { ...bb, x: lerp(ba.x, bb.x, t), y: lerp(ba.y, bb.y, t), z: lerp(ba.z, bb.z, t) };
  return { players, ball, g: b.g };
}

export class LocalMatch {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.isClient = false;
    this.localHumans = cfg.localHumans || [];
    this.sim = new Sim({ teams: cfg.teams, difficulty: cfg.difficulty, mode: cfg.mode, humans: cfg.humans });
    this.teams = cfg.teams;
    this.acc = 0;
    this.cur = decodeSnap(this.sim.snapshot());
    this.prev = this.cur;
    this.events = [];
    this.paused = false;
    this.net = cfg.net || null;
    this.netAcc = 0;
    this.netEvents = [];
    this.demo = !!cfg.demo;
    if (this.net) this.bindNet();
    this.sim.start();
  }

  bindNet() {
    const net = this.net;
    this.onMsg = (id, msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'in' && msg.i) this.sim.setInput(id, sanitizeInput(msg.i));
      else if (msg.t === 'cmd' && msg.c) this.sim.command(id, msg.c);
      else if (msg.t === 'ping') net.send(id, { t: 'pong', c: msg.c });
    };
    net.on('msg', this.onMsg);
  }

  humanLeft(id, name) {
    this.sim.removeHuman(id);
    this.sim.message(`${name || 'A player'} left`, 'AI takes over', '#aaaaaa');
  }

  update(dt) {
    if (this.paused) return;
    for (const h of this.localHumans) this.sim.setInput(h.id, this.app.input.get(h.pad));
    const scale = this.sim.slowmo > 0 ? 0.3 : 1;
    this.acc += dt * scale;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.sim.step(STEP);
      this.acc -= STEP; steps++;
      const ev = this.sim.drainEvents();
      if (ev.length) { this.events.push(...ev); if (this.net) this.netEvents.push(...ev); }
      this.prev = this.cur;
      this.cur = decodeSnap(this.sim.snapshot());
    }
    if (steps >= 6) this.acc = 0;
    if (this.net) {
      this.netAcc += dt;
      if (this.netAcc >= 1 / NET_SNAPSHOT_HZ) {
        this.netAcc = 0;
        const snap = this.sim.snapshot();
        this.net.broadcast({ t: 's', s: snap, ts: performance.now() / 1000, ev: this.netEvents.filter(e => e.type !== 'phase') });
        this.netEvents = [];
      }
    }
  }

  view() { return lerpView(this.prev, this.cur, Math.min(1, this.acc / STEP)); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  command(id, cmd) { this.sim.command(id, cmd); }
  get g() { return this.cur.g; }
  dispose() { if (this.net && this.onMsg) { const hs = this.net.h.msg; if (hs) this.net.h.msg = hs.filter(f => f !== this.onMsg); } }
}

function sanitizeInput(i) {
  const inp = emptyInput();
  inp.mx = Math.max(-1, Math.min(1, +i.mx || 0)); inp.mz = Math.max(-1, Math.min(1, +i.mz || 0));
  inp.held = (i.held | 0) & 3;
  if (Array.isArray(i.cnt)) for (let k = 0; k < 8; k++) inp.cnt[k] = i.cnt[k] | 0;
  inp.rel = i.rel | 0; inp.hold = Math.max(0, Math.min(3, +i.hold || 0)); inp.seq = i.seq | 0;
  return inp;
}

export class ClientMatch {
  constructor(app, net, setup) {
    this.app = app;
    this.net = net;
    this.isClient = true;
    this.teams = setup.teams;
    this.myId = net.id;
    this.localHumans = [{ id: net.id, team: setup.myTeam, pad: 0 }];
    this.snaps = [];
    this.events = [];
    this.offset = null;
    this.inAcc = 0;
    this.pred = null;
    this.cur = null;
    this.onMsg = (msg) => {
      if (msg.t === 's') this.onSnap(msg);
    };
    net.on('msg', this.onMsg);
  }

  onSnap(msg) {
    const now = performance.now() / 1000;
    const off = msg.ts - now;
    if (this.offset == null) this.offset = off; else this.offset = off > this.offset ? this.offset * 0.9 + off * 0.1 : off * 0.3 + this.offset * 0.7;
    const v = decodeSnap(msg.s);
    v.ts = msg.ts; v.recv = now;
    this.snaps.push(v);
    if (this.snaps.length > 40) this.snaps.shift();
    this.cur = v;
    if (msg.ev) this.events.push(...msg.ev);
  }

  update(dt) {
    const inp = this.app.input.get(0);
    this.lastInput = inp;
    this.inAcc += dt;
    if (this.inAcc >= 1 / NET_INPUT_HZ) { this.inAcc = 0; this.net.send({ t: 'in', i: inp }); }
    this.predict(dt, inp);
  }

  myIndex() {
    if (!this.cur) return -1;
    const h = this.cur.g.humans.find(x => x.id === this.myId);
    return h ? h.pIdx : -1;
  }

  predict(dt, inp) {
    const idx = this.myIndex();
    if (idx < 0 || !this.cur) { this.pred = null; return; }
    const srv = this.cur.players[idx];
    const controllable = (this.cur.g.phase === 'live' || this.cur.g.phase === 'onside') && [ACT.NONE, ACT.FAKED, ACT.SPIN, ACT.STIFF, ACT.THROW, ACT.CATCH].includes(srv.act);
    if (!controllable || !this.pred || this.pred.idx !== idx) {
      this.pred = { idx, x: srv.x, z: srv.z, vx: srv.vx, vz: srv.vz, facing: srv.facing, stamina: srv.stamina, exhausted: false, sprinting: false, engaged: 0, act: 0, active: controllable };
      return;
    }
    const p = this.pred;
    p.act = srv.act; p.engaged = (srv.flags & 2) ? 1 : 0;
    movePlayer(p, inp.mx, inp.mz, (inp.held & 1) !== 0, dt, 1, srv.hasBall);
    // reconcile toward the server position extrapolated by latency
    const age = performance.now() / 1000 - this.cur.recv + this.net.rtt * 0.5;
    const ex = srv.x + srv.vx * age, ez = srv.z + srv.vz * age;
    const err = Math.hypot(ex - p.x, ez - p.z);
    if (err > 3.5) { p.x = ex; p.z = ez; }
    else { const k = Math.min(1, dt * 3.5); p.x += (ex - p.x) * k; p.z += (ez - p.z) * k; }
    p.stamina = srv.stamina;
    p.active = true;
  }

  view() {
    if (!this.snaps.length) return null;
    const now = performance.now() / 1000;
    const rt = now + (this.offset || 0) - 0.11;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) { if (this.snaps[i].ts <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] || a; break; } }
    let v;
    if (!a) v = this.snaps[0];
    else if (a === b) v = a;
    else v = lerpView(a, b, Math.max(0, Math.min(1, (rt - a.ts) / Math.max(0.001, b.ts - a.ts))));
    v = { players: v.players.map(p => ({ ...p })), ball: { ...v.ball }, g: this.cur.g };
    if (this.pred && this.pred.active) {
      const pl = v.players[this.pred.idx];
      pl.x = this.pred.x; pl.z = this.pred.z; pl.facing = this.pred.facing; pl.vx = this.pred.vx; pl.vz = this.pred.vz;
      if (v.ball.state === 0 && v.ball.holder === this.pred.idx) { v.ball.x = pl.x; v.ball.z = pl.z; }
    }
    return v;
  }

  get g() { return this.cur ? this.cur.g : null; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  command(id, cmd) { this.net.send({ t: 'cmd', c: cmd }); }
  dispose() { const hs = this.net.h.msg; if (hs) this.net.h.msg = hs.filter(f => f !== this.onMsg); }
}
