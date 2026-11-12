// Authoritative game simulation: rules, players, ball physics.
// Runs at a fixed 60Hz. Rendering / networking only read snapshots from here.
import { FIELD, RULES, PHYS, COOLDOWNS, DIFFICULTY, clamp, lerp, rand, randInt, pick } from './config.js';
import { OFF_PLAYS, DEF_PLAYS, FORMATION, OFF_ROLES, DEF_ROLES, offerPlays, DEF_LIST } from './plays.js';
import { aiThink, aiPickOffense, aiPickDefense, aiConversion, aiOnside } from './ai.js';

export const ACT = {
  NONE: 0, JUKE: 1, SPIN: 2, STIFF: 3, DIVE: 4, TDIVE: 5, JUMP: 6, THROW: 7, CATCH: 8,
  DOWN: 9, TUMBLE: 10, GETUP: 11, CELEB: 12, BLOCK: 13, STANCE: 14, CHEER: 15, FAKED: 16, SAD: 17,
};
const ACT_DUR = { 1: 0.32, 2: 0.48, 3: 0.5, 4: 0.55, 5: 0.5, 6: 0.62, 7: 0.35, 8: 0.4, 11: 0.55, 16: 0.5 };

// Button indices for press counters
export const BTN = { A: 0, J: 1, K: 2, L: 3, DIVE: 4, SWITCH: 5, CYCL: 6, CYCR: 7 };
export const HELD = { SPRINT: 1, A: 2 };
export const emptyInput = () => ({ mx: 0, mz: 0, held: 0, cnt: [0, 0, 0, 0, 0, 0, 0, 0], rel: 0, hold: 0, seq: 0 });

export const dirOf = team => (team === 0 ? 1 : -1);
export const yardToX = (team, yd) => -dirOf(team) * FIELD.goal + dirOf(team) * yd;
export const xToYard = (team, x) => (x + dirOf(team) * FIELD.goal) * dirOf(team);

const BALL_R = 0.17;

// Movement step, shared with client-side prediction.
export function movePlayer(p, mx, mz, sprint, dt, speedMul = 1, hasBall = false) {
  let len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; len = 1; }
  if (p.exhausted && p.stamina > 0.25) p.exhausted = false;
  const canSprint = sprint && !p.exhausted && p.stamina > 0.01 && len > 0.1;
  p.sprinting = canSprint;
  let speed = (canSprint ? PHYS.sprintSpeed : PHYS.runSpeed) * speedMul * (hasBall ? PHYS.carrierMul : 1);
  if (p.engaged > 0) speed *= 0.28;
  if (p.act === ACT.FAKED) speed *= 0.3;
  if (p.act === ACT.SPIN) speed *= 0.9;
  if (p.act === ACT.THROW) speed *= 0.6;
  const tx = mx * speed, tz = mz * speed;
  const dvx = tx - p.vx, dvz = tz - p.vz;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = (len > 0.1 ? PHYS.accel : PHYS.decel) * dt;
  if (dl > maxDv) { p.vx += dvx / dl * maxDv; p.vz += dvz / dl * maxDv; } else { p.vx = tx; p.vz = tz; }
  if (canSprint) { p.stamina -= PHYS.staminaDrain * dt; if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; } }
  else p.stamina = Math.min(1, p.stamina + PHYS.staminaRegen * dt * (len < 0.1 ? 1.6 : 1));
  p.x += p.vx * dt; p.z += p.vz * dt;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > 0.6) {
    const target = Math.atan2(p.vz, p.vx);
    let d = target - p.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    p.facing += d * Math.min(1, dt * 14);
  }
}

function makePlayer(i) {
  return {
    i, team: i < 3 ? 0 : 1, slot: i % 3, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 0,
    stamina: 1, exhausted: false, sprinting: false, act: ACT.NONE, actT: 0, actVar: 0, actDur: 0,
    cd: { juke: 0, spin: 0, stiff: 0, dive: 0, jump: 0, tackle: 0 },
    invuln: 0, engaged: 0, tackleCd: 0, downT: 0, tPitch: 0, tRoll: 0, tvp: 0, tvr: 0,
    human: null, role: '', assign: null, route: null, routeIdx: 0, triedCatch: false,
    jukeX: 0, jukeZ: 0, aiT: 0, ai: {},
  };
}

export class Sim {
  constructor(opts) {
    this.teams = opts.teams;                 // [teamObj, teamObj]
    this.diff = DIFFICULTY[opts.difficulty || 'pro'];
    this.diffKey = opts.difficulty || 'pro';
    this.mode = opts.mode || 'ai';
    this.assist = !!opts.assist;            // beginner assist for human teams
    this.pickLen = this.assist ? RULES.pickTimeAssist : RULES.pickTime;
    this.players = [];
    for (let i = 0; i < 6; i++) this.players.push(makePlayer(i));
    this.ball = { state: 'held', holder: 0, x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, passer: -1, intended: -1,
      target: null, lob: 0, airT: 0, flightT: 1, deflected: false, lastTeam: 0, kick: false, kickX: 0, touchedR: false };
    this.humans = [];
    for (const h of opts.humans || []) this.addHuman(h);
    this.events = [];
    this.t = 0;
    this.score = [0, 0];
    this.quarter = 1; this.clock = RULES.quarterLen; this.ot = false;
    this.possession = 0; this.los = 0; this.down = 1; this.fdX = 0; this.goalToGo = false;
    this.phase = 'pregame'; this.phaseT = 0; this.phaseDur = 0;
    this.offOptions = offerPlays(true); this.offPlay = null; this.defPlay = null;
    this.picks = { off: null, def: null }; this.pickTimer = this.pickLen;
    this.target = [1, 4];
    this.aim = null;
    this.passAllowed = true;
    this.conversion = null; this.choice = null;
    this.slowmo = 0; this.shake = 0;
    this.msg = null;
    this.stats = [this.blankStats(), this.blankStats()];
    this.firstPossession = 0;
    this.winner = -1;
    this.playStartX = 0; this.gainTeamX = 0; this.gainedInOwnEZ = false;
    this.pending = null;
    this.lastHit = 0;
    this.celebrator = -1;
    this.firstOffer = true;
    this.liveT = 0;
  }

  blankStats() { return { passYds: 0, rushYds: 0, tds: 0, ints: 0, fumbles: 0, bigHits: 0, sacks: 0, comp: 0, att: 0 }; }

  // ---------- humans ----------
  addHuman(h) {
    const hum = { id: h.id, team: h.team, name: h.name || 'Player', pIdx: -1, input: emptyInput(), seen: [0, 0, 0, 0, 0, 0, 0, 0], seenRel: 0, holdT: 0, ack: 0 };
    this.humans.push(hum);
    this.assignHumans();
    return hum;
  }
  removeHuman(id) {
    const h = this.humans.find(x => x.id === id);
    if (!h) return;
    if (h.pIdx >= 0 && this.players[h.pIdx].human === id) this.players[h.pIdx].human = null;
    this.humans = this.humans.filter(x => x !== h);
  }
  humanOf(id) { return this.humans.find(h => h.id === id); }
  setInput(id, input) {
    const h = this.humanOf(id);
    if (h) { h.input = input; h.ack = input.seq || 0; }
  }
  setControl(h, pIdx) {
    if (h.pIdx >= 0 && this.players[h.pIdx].human === h.id) this.players[h.pIdx].human = null;
    const other = this.players[pIdx].human;
    if (other != null && other !== h.id) {
      const oh = this.humanOf(other);
      if (oh) { oh.pIdx = h.pIdx; if (h.pIdx >= 0) this.players[h.pIdx].human = oh.id; }
    }
    h.pIdx = pIdx; this.players[pIdx].human = h.id;
  }
  // Default assignment: team humans fill slots in order (QB first on offense)
  assignHumans() {
    for (const p of this.players) p.human = null;
    for (let team = 0; team < 2; team++) {
      const hs = this.humans.filter(h => h.team === team);
      hs.forEach((h, k) => { const idx = team * 3 + (k % 3); h.pIdx = idx; this.players[idx].human = h.id; });
    }
  }
  teamHumans(team) { return this.humans.filter(h => h.team === team); }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  message(text, sub = '', color = '') { this.msg = { text, sub, color, id: (this.msg ? this.msg.id : 0) + 1 }; this.emit('msg', { text, sub, color }); }

  // ---------- game flow ----------
  start() {
    this.score = [0, 0]; this.quarter = 1; this.clock = RULES.quarterLen;
    this.firstPossession = Math.random() < 0.5 ? 0 : 1;
    this.startSeries(this.firstPossession, RULES.touchbackYards);
    this.placeFormation(true);
    this.setPhase('cine', 3.2);
    this.message('KICKOFF', `${this.teams[this.firstPossession].name} get the ball`);
    this.emit('kickoff');
  }

  setPhase(ph, dur = 0) { this.phase = ph; this.phaseT = 0; this.phaseDur = dur; this.emit('phase', { phase: ph }); }

  startSeries(team, yardLine) {
    this.possession = team;
    const d = dirOf(team);
    this.los = clamp(yardToX(team, yardLine), -FIELD.goal + 1, FIELD.goal - 1);
    this.down = 1;
    const fd = this.los + d * RULES.firstDownYards;
    this.goalToGo = d * fd >= FIELD.goal;
    this.fdX = this.goalToGo ? d * FIELD.goal : fd;
  }

  ballTeam() {
    const b = this.ball;
    if (b.state === 'held' && b.holder >= 0) return this.players[b.holder].team;
    return this.possession;
  }
  defTeam() { return 1 - this.possession; }
  carrier() { const b = this.ball; return b.state === 'held' && b.holder >= 0 ? this.players[b.holder] : null; }

  enterSelect() {
    this.offOptions = offerPlays(this.firstOffer); this.firstOffer = false;
    this.picks = { off: null, def: null };
    this.pickTimer = this.pickLen;
    this.aiPickDelay = [rand(0.5, 1.4), rand(0.5, 1.4)];
    this.setPhase('select');
    for (const p of this.players) { if (p.act !== ACT.DOWN && p.act !== ACT.TUMBLE && p.act !== ACT.GETUP) this.setAct(p, ACT.NONE); p.engaged = 0; }
    this.ball.state = 'held'; this.ball.holder = this.possession * 3; this.ball.kick = false;
    this.target[this.possession] = this.possession * 3 + 1;
  }

  formationSpot(p) {
    const off = p.team === this.possession;
    const d = dirOf(this.possession);
    if (off) { const f = FORMATION.offense[OFF_ROLES[p.slot]]; return [this.los + d * f[0], f[1]]; }
    const f = FORMATION.defense[DEF_ROLES[p.slot]];
    let fx = f[0];
    // keep defenders out of the end zone depth
    const goal = d * FIELD.goal;
    let x = this.los + d * fx;
    if (d * x > FIELD.endLine - 1) x = d * (FIELD.endLine - 1);
    if (d * this.los > FIELD.goal - 8 && p.slot === 2) x = this.los + d * Math.max(3, Math.min(fx, Math.abs(goal + d * 8 - this.los)));
    return [x, f[1]];
  }

  placeFormation(exact) {
    const d = dirOf(this.possession);
    for (const p of this.players) {
      const [x, z] = this.formationSpot(p);
      if (exact) { p.x = x; p.z = z; p.vx = p.vz = 0; p.y = 0; }
      p.facing = p.team === this.possession ? (d > 0 ? 0 : Math.PI) : (d > 0 ? Math.PI : 0);
    }
  }

  command(humanId, cmd) {
    const h = this.humanOf(humanId);
    if (!h) return;
    const team = h.team;
    if (cmd.type === 'pick' && this.phase === 'select') {
      if (team === this.possession && !this.picks.off && this.offOptions.includes(cmd.id)) { this.picks.off = cmd.id; this.emit('picked', { team }); }
      if (team !== this.possession && !this.picks.def && DEF_LIST.includes(cmd.id)) { this.picks.def = cmd.id; this.emit('picked', { team }); }
    } else if (cmd.type === 'conv' && this.phase === 'convChoice' && this.choice && this.choice.team === team) {
      this.choice.value = cmd.pts === 2 ? 2 : 1;
    } else if (cmd.type === 'kick' && this.phase === 'kickChoice' && this.choice && this.choice.team === team) {
      this.choice.value = cmd.onside ? 'onside' : 'normal';
    } else if (cmd.type === 'skip' && (this.phase === 'replay' || this.phase === 'cine' || this.phase === 'td')) {
      if (this.phase === 'td' && this.phaseT < 1.2) return;
      this.phaseT = this.phaseDur;
    } else if (cmd.type === 'snap' && this.phase === 'presnap' && team === this.possession && this.phaseT > 0.35) {
      this.phaseT = this.phaseDur;
    }
  }

  // ---------- main step ----------
  step(dt) {
    this.t += dt;
    this.phaseT += dt;
    if (this.msg) this.msg.age = (this.msg.age || 0) + dt;
    switch (this.phase) {
      case 'pregame': break;
      case 'cine':
        this.idlePlayers(dt, true);
        if (this.phaseT >= this.phaseDur) this.enterSelect();
        break;
      case 'select': this.stepSelect(dt); break;
      case 'presnap':
        this.idlePlayers(dt, false);
        for (const h of this.humans) this.consumeHumanPresses(h, (b) => { if (b === BTN.A) this.command(h.id, { type: 'snap' }); });
        if (this.phaseT >= this.phaseDur) this.snap();
        break;
      case 'live': this.stepLive(dt); break;
      case 'onsideSet':
        this.idlePlayers(dt, false);
        if (this.phaseT >= this.phaseDur) this.kickOnside();
        break;
      case 'onside': this.stepLive(dt); if (this.phase === 'onside' && this.phaseT > 7) this.endOnside(null); break;
      case 'dead':
        this.stepDead(dt);
        if (this.phaseT >= RULES.deadTime) this.resolvePending();
        break;
      case 'td':
        this.stepCelebrate(dt);
        if (this.phaseT >= RULES.tdCelebrate) {
          if (this.convDone) this.afterTouchdown();
          else { this.setPhase('replay', RULES.replayLen); this.emit('replay'); }
        }
        break;
      case 'replay':
        this.stepCelebrate(dt);
        if (this.phaseT >= this.phaseDur) this.afterTouchdown();
        break;
      case 'convChoice':
      case 'kickChoice':
        this.stepChoice(dt); break;
      case 'quarterBreak':
        this.idlePlayers(dt, true);
        if (this.phaseT >= this.phaseDur) {
          this.placeFormation(true);
          this.setPhase('cine', 2.6); this.emit('kickoff');
        }
        break;
      case 'gameover':
        this.stepCelebrate(dt); break;
    }
    if (this.slowmo > 0) this.slowmo -= dt;
  }

  consumeHumanPresses(h, fn) {
    const inp = h.input;
    for (let b = 0; b < 8; b++) {
      if (inp.cnt[b] > h.seen[b]) { h.seen[b] = inp.cnt[b]; fn && fn(b); }
    }
    if (inp.rel > h.seenRel) h.seenRel = inp.rel;
  }

  stepSelect(dt) {
    this.pickTimer -= dt;
    // AI / auto picks
    const offHumans = this.teamHumans(this.possession).length, defHumans = this.teamHumans(this.defTeam()).length;
    if (!this.picks.off && offHumans === 0 && this.phaseT > this.aiPickDelay[0]) this.picks.off = aiPickOffense(this);
    if (!this.picks.def && defHumans === 0 && this.phaseT > this.aiPickDelay[1]) this.picks.def = aiPickDefense(this);
    if (this.pickTimer <= 0) {
      if (!this.picks.off) this.picks.off = this.offOptions[1];
      if (!this.picks.def) this.picks.def = 'cover';
    }
    for (const h of this.humans) this.consumeHumanPresses(h);
    // jog to formation
    for (const p of this.players) {
      this.tickTimers(p, dt);
      if (this.updateBodyState(p, dt)) continue;
      const [fx, fz] = this.formationSpot(p);
      const dx = fx - p.x, dz = fz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.3) movePlayer(p, dx / d * Math.min(1, d / 2), dz / d * Math.min(1, d / 2), d > 6, dt, 1.1);
      else { movePlayer(p, 0, 0, false, dt); const want = p.team === this.possession ? (dirOf(this.possession) > 0 ? 0 : Math.PI) : (dirOf(this.possession) > 0 ? Math.PI : 0); p.facing += Math.atan2(Math.sin(want - p.facing), Math.cos(want - p.facing)) * Math.min(1, dt * 6); }
    }
    this.syncHeldBall();
    if (this.picks.off && this.picks.def && this.phaseT > 0.4) {
      this.offPlay = OFF_PLAYS[this.picks.off]; this.defPlay = DEF_PLAYS[this.picks.def];
      this.emit('playsLocked', { off: this.picks.off, def: this.picks.def });
      this.setPhase('presnap', 1.25);
      for (const p of this.players) { if (p.act !== ACT.DOWN && p.act !== ACT.TUMBLE) this.setAct(p, ACT.STANCE); p.act = ACT.STANCE; p.y = 0; }
    }
  }

  idlePlayers(dt, wander) {
    for (const p of this.players) {
      this.tickTimers(p, dt);
      if (this.updateBodyState(p, dt)) continue;
      if (this.phase === 'presnap' || this.phase === 'onsideSet') {
        const [fx, fz] = this.phase === 'presnap' ? this.formationSpot(p) : [p.ai.setX ?? p.x, p.ai.setZ ?? p.z];
        p.x = lerp(p.x, fx, Math.min(1, dt * 8)); p.z = lerp(p.z, fz, Math.min(1, dt * 8)); p.vx = p.vz = 0;
        const want = p.team === this.possession ? (dirOf(this.possession) > 0 ? 0 : Math.PI) : (dirOf(this.possession) > 0 ? Math.PI : 0);
        if (this.phase === 'presnap') p.facing += Math.atan2(Math.sin(want - p.facing), Math.cos(want - p.facing)) * Math.min(1, dt * 8);
        continue;
      }
      movePlayer(p, 0, 0, false, dt);
    }
    this.syncHeldBall();
  }

  snap() {
    this.placeFormation(true);
    const d = dirOf(this.possession);
    this.passAllowed = true;
    this.playStartX = this.los;
    this.liveT = 0;
    this.aim = null;
    const play = this.offPlay, dplay = this.defPlay;
    for (const p of this.players) {
      p.act = ACT.NONE; p.actT = 0; p.triedCatch = false; p.engaged = 0; p.ai = {}; p.routeIdx = 0; p.invuln = 0; p.stamina = Math.max(p.stamina, 0.6);
      if (p.team === this.possession) {
        p.role = OFF_ROLES[p.slot];
        const r = p.role === 'qb' ? null : play.routes[p.role];
        if (r === 'block' || r === 'lead') p.assign = { type: r };
        else if (Array.isArray(r)) { p.assign = { type: 'route' }; p.route = r.map(q => [p.x + d * q[0], clamp(p.z + q[1], -FIELD.halfWid + 1, FIELD.halfWid - 1)]); }
        else p.assign = { type: play.type === 'run' && play.carrier === 'qb' ? 'run' : 'qb' };
        if (p.role === 'qb' && play.type === 'run' && play.carrier === 'qb') p.route = play.runPath.map(q => [p.x + d * q[0], clamp(p.z + q[1], -FIELD.halfWid + 1, FIELD.halfWid - 1)]);
      } else {
        p.role = DEF_ROLES[p.slot];
        const wr = this.possession * 3 + 1, flex = this.possession * 3 + 2, qb = this.possession * 3;
        if (dplay.id === 'cover') p.assign = p.role === 'lb' ? { type: 'man', target: flex } : p.role === 'cb' ? { type: 'man', target: wr } : { type: 'deep' };
        else if (dplay.id === 'blitz') p.assign = p.role === 'cb' ? { type: 'man', target: wr } : { type: 'rush', delay: p.role === 's' ? 0.35 : 0 };
        else p.assign = p.role === 'lb' ? { type: 'spy', target: qb } : p.role === 'cb' ? { type: 'man', target: wr } : { type: 'man', target: flex };
      }
    }
    this.ball.state = 'held'; this.ball.holder = this.possession * 3; this.ball.lastTeam = this.possession; this.ball.kick = false;
    this.target[this.possession] = this.possession * 3 + (play.read && play.read[0] === 'flex' ? 2 : 1);
    // human control: offense humans -> QB first; defense humans keep players
    const offH = this.teamHumans(this.possession);
    if (offH.length) {
      offH.forEach((h, k) => this.setControl(h, this.possession * 3 + (k % 3)));
    }
    for (const h of this.humans) { this.consumeHumanPresses(h); h.holdT = 0; }
    this.handoffPending = play.type === 'run' && play.carrier === 'flex';
    if (this.handoffPending) { this.passAllowed = false; this.players[this.possession * 3].assign = { type: 'handoff' }; }
    this.gainedInOwnEZ = false;
    this.setPhase('live');
    this.emit('snap');
    this.emit('whistleShort');
  }

  // ---------- live play ----------
  stepLive(dt) {
    if (this.phase === 'live') {
      this.liveT += dt;
      if (!this.conversion) { this.clock = Math.max(0, this.clock - dt); }
    }
    // handoff for sweeps
    if (this.handoffPending && this.ball.state === 'held') {
      const qb = this.players[this.possession * 3], fl = this.players[this.possession * 3 + 2];
      if (Math.hypot(qb.x - fl.x, qb.z - fl.z) < 2.2 || this.liveT > 0.4) {
        this.handoffPending = false;
        this.giveBall(fl, 'handoff');
        this.passAllowed = false;
        qb.assign = { type: 'block' };
      }
    }
    for (const h of this.humans) { this.autoSwitch(h); this.processHuman(h, dt); }
    for (const p of this.players) {
      this.tickTimers(p, dt);
      if (this.updateBodyState(p, dt)) continue;
      if (p.human != null && this.humanOf(p.human)) {
        const h = this.humanOf(p.human);
        movePlayer(p, h.input.mx, h.input.mz, (h.input.held & HELD.SPRINT) !== 0, dt, 1, this.ball.holder === p.i && this.ball.state === 'held');
        if (this.ball.holder === p.i && h.holding && this.passAllowed) {
          // face receiver while winding up
          const r = this.players[this.target[p.team]];
          const want = Math.atan2(r.z - p.z, r.x - p.x);
          p.facing += Math.atan2(Math.sin(want - p.facing), Math.cos(want - p.facing)) * Math.min(1, dt * 10);
        }
      } else {
        const cmd = aiThink(this, p, dt);
        const mul = this.aiSpeed(p);
        movePlayer(p, cmd.mx, cmd.mz, cmd.sprint, dt, mul, this.ball.holder === p.i && this.ball.state === 'held');
        if (cmd.act) this.doAction(p, cmd.act, cmd);
        if (cmd.throwTo != null) this.throwPass(p, cmd.throwTo, cmd.hold || 0.2, false);
      }
      // cut particles at speed
      if (p.sprinting && Math.random() < dt * 2.2 && (p.ai.lastFx || 0) < this.t - 0.25) {
        p.ai.lastFx = this.t;
        this.emit('turf', { x: p.x, z: p.z, n: 3 });
      }
    }
    this.resolveCollisions(dt);
    this.updateBall(dt);
    if (this.phase === 'live' || this.phase === 'onside') this.checkTackles();
    if (this.phase === 'live' || this.phase === 'onside') this.checkRules();
    this.updateAim();
  }

  assisted(team) { return this.assist && this.teamHumans(team).length > 0; }

  // Beginner assist: on defense, keep control of the defender closest to the ball.
  autoSwitch(h) {
    if (!this.assisted(h.team) || h.pIdx < 0 || this.ballTeam() === h.team) return;
    if ((h.autoT = (h.autoT || 0) - 1 / 60) > 0) return;
    h.autoT = 0.5;
    const b = this.ball, me = this.players[h.pIdx];
    if (me.act === ACT.TDIVE || me.act === ACT.JUMP) return;
    const myD = Math.hypot(me.x - b.x, me.z - b.z);
    let best = null, bd = myD - 3.5;
    for (const p of this.players) {
      if (p.team !== h.team || p === me || (p.human != null && p.human !== h.id)) continue;
      if (p.act === ACT.DOWN || p.act === ACT.TUMBLE || p.act === ACT.GETUP) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { this.setControl(h, best.i); this.emit('switch', { team: h.team }); }
  }

  aiSpeed(p) { return this.aiDiff(p).speed; }
  aiDiff(p) {
    const solo = this.mode === 'ai' || this.mode === 'season';
    if (solo && this.teamHumans(p.team).length > 0) return this.diff === DIFFICULTY.allstar ? DIFFICULTY.allstar : DIFFICULTY.pro;
    return this.diff;
  }

  processHuman(h, dt) {
    if (h.pIdx < 0) return;
    const p = this.players[h.pIdx];
    const inp = h.input;
    const b = this.ball;
    const hasBall = b.state === 'held' && b.holder === p.i;
    const onOffense = this.ballTeam() === p.team || (b.state !== 'held' && p.team === this.possession);
    const pressed = [];
    for (let k = 0; k < 8; k++) if (inp.cnt[k] > h.seen[k]) { pressed[k] = true; h.seen[k] = inp.cnt[k]; }
    const released = inp.rel > h.seenRel;
    if (released) h.seenRel = inp.rel;
    const aHeld = (inp.held & HELD.A) !== 0;
    if (this.phase === 'onside') {
      if (pressed[BTN.SWITCH]) this.switchToNearest(h);
      if (pressed[BTN.DIVE]) this.doAction(p, ACT.DIVE);
      return;
    }
    if (hasBall) {
      if (pressed[BTN.J]) this.doAction(p, ACT.JUKE, { side: inp.mx * Math.sin(p.facing) - inp.mz * Math.cos(p.facing) });
      if (pressed[BTN.K]) this.doAction(p, ACT.SPIN);
      if (pressed[BTN.L]) this.doAction(p, ACT.STIFF);
      if (pressed[BTN.DIVE]) this.doAction(p, ACT.DIVE);
      if (pressed[BTN.CYCL]) this.cycleTarget(p.team, -1);
      if (pressed[BTN.CYCR]) this.cycleTarget(p.team, 1);
      if (this.passAllowed && this.canThrow(p)) {
        if (pressed[BTN.A]) { h.holding = true; h.holdT = 0; }
        if (h.holding && aHeld) h.holdT += dt;
        if (h.holding && (released || !aHeld)) {
          const hold = released && inp.hold > 0 ? inp.hold : h.holdT;
          h.holding = false;
          this.throwPass(p, this.target[p.team], hold, true);
        }
      } else h.holding = false;
    } else {
      h.holding = false;
      if (onOffense) {
        if (pressed[BTN.DIVE]) this.doAction(p, ACT.DIVE);
        if (pressed[BTN.J]) this.doAction(p, ACT.JUMP);
        if (pressed[BTN.SWITCH] && b.state !== 'held') this.switchToNearest(h);
      } else {
        if (pressed[BTN.SWITCH]) this.switchToNearest(h);
        if (pressed[BTN.A]) this.doAction(p, ACT.TDIVE);
        if (pressed[BTN.J]) this.doAction(p, ACT.JUMP);
        if (pressed[BTN.DIVE]) this.doAction(p, ACT.TDIVE);
      }
    }
  }

  isWinding(p) {
    if (p.human == null) return false;
    const h = this.humanOf(p.human);
    return !!(h && h.holding);
  }

  canThrow(p) {
    const d = dirOf(p.team);
    return p.team === this.possession && d * (p.x - this.los) < 0.6 && p.slot === 0 && this.phase === 'live';
  }

  cycleTarget(team, dirn) {
    const cands = [team * 3 + 1, team * 3 + 2, team * 3];
    const elig = cands.filter(i => this.ball.holder !== i);
    let k = elig.indexOf(this.target[team]);
    k = (k + dirn + elig.length) % elig.length;
    this.target[team] = elig[k];
    this.emit('cycle', { team });
  }

  switchToNearest(h) {
    const b = this.ball;
    let best = -1, bd = 1e9;
    for (const p of this.players) {
      if (p.team !== h.team || p.i === h.pIdx) continue;
      if (p.human != null && p.human !== h.id) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bd) { bd = d; best = p.i; }
    }
    if (best >= 0) { this.setControl(h, best); this.emit('switch', { team: h.team }); }
  }

  setAct(p, act, dur) {
    p.act = act; p.actT = 0; p.actDur = dur ?? ACT_DUR[act] ?? 0;
  }

  doAction(p, act, opts = {}) {
    const busy = p.act === ACT.DOWN || p.act === ACT.TUMBLE || p.act === ACT.GETUP || p.act === ACT.DIVE || p.act === ACT.TDIVE;
    if (busy) return;
    const hasBall = this.ball.state === 'held' && this.ball.holder === p.i;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    switch (act) {
      case ACT.JUKE: {
        if (!hasBall || p.cd.juke > 0 || p.act === ACT.JUKE) return;
        p.cd.juke = COOLDOWNS.juke;
        let side = opts.side;
        if (!side || Math.abs(side) < 0.2) side = (p.ai.lastJuke = -(p.ai.lastJuke || 1));
        side = Math.sign(side);
        // perpendicular (left = -z when facing +x)
        p.jukeX = -fz * side; p.jukeZ = fx * side;
        this.setAct(p, ACT.JUKE);
        this.emit('juke', { x: p.x, z: p.z, i: p.i });
        // fake nearby defenders
        for (const d of this.players) {
          if (d.team === p.team) continue;
          const dist = Math.hypot(d.x - p.x, d.z - p.z);
          if (dist < 3.4 && d.act === ACT.NONE) {
            const resist = d.human != null ? 0.45 : this.aiDiff(d).tackle * 0.55;
            if (Math.random() > resist) { this.setAct(d, ACT.FAKED); d.vx *= 0.3; d.vz *= 0.3; }
          }
        }
        break;
      }
      case ACT.SPIN:
        if (!hasBall || p.cd.spin > 0) return;
        p.cd.spin = COOLDOWNS.spin; p.invuln = 0.5; this.setAct(p, ACT.SPIN); this.emit('spin', { x: p.x, z: p.z }); break;
      case ACT.STIFF:
        if (!hasBall || p.cd.stiff > 0) return;
        p.cd.stiff = COOLDOWNS.stiff; this.setAct(p, ACT.STIFF); this.emit('stiff'); break;
      case ACT.DIVE: {
        if (p.cd.dive > 0) return;
        p.cd.dive = COOLDOWNS.dive;
        const sp = Math.max(Math.hypot(p.vx, p.vz), 6.5) + 2.2;
        p.vx = fx * sp; p.vz = fz * sp; p.vy = 3.2;
        this.setAct(p, ACT.DIVE); this.emit('dive', { x: p.x, z: p.z });
        break;
      }
      case ACT.TDIVE: {
        if (p.cd.tackle > 0) return;
        p.cd.tackle = COOLDOWNS.tackle;
        // aim at carrier if roughly ahead
        const c = this.carrier();
        let ax = fx, az = fz;
        if (c && c.team !== p.team) {
          const dx = c.x + c.vx * 0.2 - p.x, dz = c.z + c.vz * 0.2 - p.z, dl = Math.hypot(dx, dz);
          if (dl < 5 && dl > 0.01) { const dot = (dx * fx + dz * fz) / dl; if (dot > 0.2 || p.human == null) { ax = dx / dl; az = dz / dl; p.facing = Math.atan2(az, ax); } }
        }
        const sp = Math.max(Math.hypot(p.vx, p.vz), 7) + 4;
        p.vx = ax * sp; p.vz = az * sp; p.vy = 2.6;
        this.setAct(p, ACT.TDIVE); this.emit('dive', { x: p.x, z: p.z });
        break;
      }
      case ACT.JUMP:
        if (p.cd.jump > 0 || hasBall) return;
        p.cd.jump = COOLDOWNS.jump; p.vy = 6.4; this.setAct(p, ACT.JUMP); this.emit('jump'); break;
    }
  }

  tickTimers(p, dt) {
    for (const k in p.cd) if (p.cd[k] > 0) p.cd[k] -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.engaged > 0) p.engaged -= dt;
    if (p.tackleCd > 0) p.tackleCd -= dt;
    p.actT += dt;
  }

  // Handles non-controllable body states. Returns true if the player is busy (no steering).
  updateBodyState(p, dt) {
    switch (p.act) {
      case ACT.TUMBLE: {
        p.vy -= PHYS.gravity * dt;
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
        p.tPitch += p.tvp * dt; p.tRoll += p.tvr * dt;
        if (p.y <= 0 && p.vy < 0) {
          p.y = 0;
          if (Math.abs(p.vy) > 4.5) { p.vy = -p.vy * 0.35; p.vx *= 0.6; p.vz *= 0.6; p.tvp *= 0.5; p.tvr *= 0.5; this.emit('thud', { x: p.x, z: p.z, big: false }); this.emit('turf', { x: p.x, z: p.z, n: 6 }); }
          else {
            p.vy = 0; p.vx *= 0.3; p.vz *= 0.3;
            // settle on back or front
            p.tPitch = Math.round(p.tPitch / Math.PI) * Math.PI + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
            p.tRoll = 0;
            this.setAct(p, ACT.DOWN); p.downT = p.ai.downTime || 1.1;
          }
        }
        return true;
      }
      case ACT.DOWN:
        p.vx *= Math.max(0, 1 - dt * 6); p.vz *= Math.max(0, 1 - dt * 6);
        p.x += p.vx * dt; p.z += p.vz * dt; p.y = 0;
        p.downT -= dt;
        if (p.downT <= 0 && this.phase !== 'td' && this.phase !== 'replay') this.setAct(p, ACT.GETUP);
        return true;
      case ACT.GETUP:
        p.vx = p.vz = 0;
        if (p.actT >= p.actDur) { this.setAct(p, ACT.NONE); p.tPitch = 0; p.tRoll = 0; }
        return true;
      case ACT.DIVE:
      case ACT.TDIVE: {
        p.vy -= PHYS.gravity * 0.9 * dt;
        p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.max(0, p.y + p.vy * dt);
        if (p.actT > 0.18 && p.y <= 0) {
          p.vx *= 0.35; p.vz *= 0.35;
          this.emit('turf', { x: p.x, z: p.z, n: 5 });
          const isCarrier = this.ball.state === 'held' && this.ball.holder === p.i;
          this.setAct(p, ACT.DOWN); p.downT = 0.55; p.tPitch = -Math.PI / 2; p.tRoll = 0;
          if (isCarrier && this.phase === 'live') this.carrierDown(p, 'dive');
        }
        return true;
      }
      case ACT.JUMP:
        p.vy -= PHYS.gravity * dt; p.y += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; this.setAct(p, ACT.NONE); }
        p.x += p.vx * dt * 0.8; p.z += p.vz * dt * 0.8;
        return true;
      case ACT.JUKE: {
        const t = p.actT / p.actDur;
        const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
        const side = 11 * (1 - t * 0.6);
        p.vx = p.jukeX * side + fx * 4.5; p.vz = p.jukeZ * side + fz * 4.5;
        p.x += p.vx * dt; p.z += p.vz * dt;
        if (p.actT >= p.actDur) { this.setAct(p, ACT.NONE); this.emit('turf', { x: p.x, z: p.z, n: 4 }); }
        return true;
      }
      case ACT.FAKED:
        if (p.actT >= p.actDur) this.setAct(p, ACT.NONE);
        return false;
      case ACT.SPIN: case ACT.STIFF: case ACT.THROW: case ACT.CATCH:
        if (p.actT >= p.actDur) this.setAct(p, ACT.NONE);
        return false;
      case ACT.STANCE:
        if (this.phase === 'live') this.setAct(p, ACT.NONE);
        return false;
    }
    return false;
  }

  resolveCollisions(dt) {
    const P = this.players, R = PHYS.playerRadius * 2;
    const bt = this.ballTeam();
    for (let i = 0; i < 6; i++) {
      const a = P[i];
      if (a.act === ACT.DOWN || a.act === ACT.TUMBLE || a.y > 0.6) continue;
      for (let j = i + 1; j < 6; j++) {
        const b = P[j];
        if (b.act === ACT.DOWN || b.act === ACT.TUMBLE || b.y > 0.6) continue;
        let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz);
        if (d < R && d > 0.0001) {
          dx /= d; dz /= d; const push = (R - d) * 0.5;
          a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
          // blocking: ball team non-carrier vs defender
          if (a.team !== b.team && (this.phase === 'live')) {
            const blk = a.team === bt ? a : b, def = blk === a ? b : a;
            if (this.ball.holder !== blk.i && def.act !== ACT.TDIVE && blk.act !== ACT.TDIVE) {
              def.engaged = 0.25; blk.engaged = 0.12;
              if (blk.act === ACT.NONE) blk.ai.blocking = this.t;
              if (!blk.ai.lastBlockFx || this.t - blk.ai.lastBlockFx > 0.6) { blk.ai.lastBlockFx = this.t; this.emit('block', { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }); }
            }
          }
        }
      }
    }
  }

  // ---------- ball ----------
  giveBall(p, how) {
    const b = this.ball;
    b.state = 'held'; b.holder = p.i; b.deflected = false; b.lastTeam = p.team; b.vx = b.vy = b.vz = 0;
    this.syncHeldBall();
    // control transfer: humans always control their team's ball carrier
    if (p.human == null) {
      const hs = this.teamHumans(p.team);
      if (hs.length) {
        let best = hs[0], bd = 1e9;
        for (const h of hs) { const q = this.players[h.pIdx]; const d = q ? Math.hypot(q.x - p.x, q.z - p.z) : 1e9; if (d < bd) { bd = d; best = h; } }
        // prefer the passer's controller
        if (how === 'catch' && b.passer >= 0) { const ph = this.players[b.passer].human; const hh = ph != null && this.humanOf(ph); if (hh && hh.team === p.team) best = hh; }
        this.setControl(best, p.i);
      }
    }
  }

  syncHeldBall() {
    const b = this.ball;
    if (b.state !== 'held' || b.holder < 0) return;
    const p = this.players[b.holder];
    b.x = p.x + Math.cos(p.facing) * 0.25; b.z = p.z + Math.sin(p.facing) * 0.25; b.y = p.y + 1.15;
  }

  updateAim() {
    this.aim = null;
    const c = this.carrier();
    if (!c || c.human == null || !this.passAllowed) return;
    const h = this.humanOf(c.human);
    if (!h || !h.holding) return;
    const r = this.players[this.target[c.team]];
    const lob = clamp((h.holdT - 0.15) / 0.45, 0, 1);
    const sol = this.solvePass(c, r, lob);
    this.aim = { x: sol.x, z: sol.z, lob, team: c.team };
  }

  solvePass(qb, r, lob) {
    const hs = lerp(27, 15.5, lob);
    let tx = r.x, tz = r.z, T = 0;
    // lead the receiver; lobs lead more downfield
    for (let k = 0; k < 3; k++) {
      T = Math.max(0.25, Math.hypot(tx - qb.x, tz - qb.z) / hs);
      tx = r.x + r.vx * T * 0.95; tz = r.z + r.vz * T * 0.95;
    }
    tz = clamp(tz, -FIELD.halfWid + 0.8, FIELD.halfWid - 0.8);
    tx = clamp(tx, -FIELD.endLine + 0.8, FIELD.endLine - 0.8);
    return { x: tx, z: tz, T: Math.max(0.25, Math.hypot(tx - qb.x, tz - qb.z) / hs) };
  }

  throwPass(qb, targetIdx, hold, human) {
    const b = this.ball;
    if (b.state !== 'held' || b.holder !== qb.i || !this.passAllowed || !this.canThrow(qb)) return;
    const r = this.players[targetIdx];
    if (!r || r.team !== qb.team || r.i === qb.i) return;
    const lob = clamp((hold - 0.15) / 0.45, 0, 1);
    let sol = this.solvePass(qb, r, lob);
    let dist = Math.hypot(sol.x - qb.x, sol.z - qb.z);
    // inaccuracy
    let pressure = 0;
    for (const d of this.players) if (d.team !== qb.team && d.act !== ACT.DOWN && Math.hypot(d.x - qb.x, d.z - qb.z) < 3) pressure = 1;
    const moving = Math.hypot(qb.vx, qb.vz) > 5 ? 1 : 0;
    const acc = human ? 0.9 : this.aiDiff(qb).qbAcc;
    let err = (0.25 + dist * 0.028 * (1.5 - acc) + pressure * 1.1 + moving * 0.5) * (1.2 - acc) * 1.6;
    if (human && this.assisted(qb.team)) err *= 0.3;
    const ea = rand(0, Math.PI * 2), er = Math.random() * err;
    sol.x += Math.cos(ea) * er; sol.z += Math.sin(ea) * er;
    sol.z = clamp(sol.z, -FIELD.halfWid - 1, FIELD.halfWid + 1);
    dist = Math.hypot(sol.x - qb.x, sol.z - qb.z);
    const hs = lerp(27, 15.5, lob);
    const T = Math.max(0.28, dist / hs);
    const y0 = qb.y + 1.9, y1 = 1.35;
    b.state = 'air'; b.holder = -1; b.passer = qb.i; b.intended = r.i;
    b.x = qb.x + Math.cos(qb.facing) * 0.4; b.z = qb.z + Math.sin(qb.facing) * 0.4; b.y = y0;
    b.vx = (sol.x - b.x) / T; b.vz = (sol.z - b.z) / T;
    b.vy = (y1 - y0 + 0.5 * PHYS.gravity * T * T) / T;
    b.target = { x: sol.x, z: sol.z }; b.flightT = T; b.airT = 0; b.lob = lob; b.deflected = false; b.lastTeam = qb.team;
    this.passAllowed = false;
    this.passFromX = qb.x;
    for (const p of this.players) p.triedCatch = false;
    qb.triedCatch = true;
    this.setAct(qb, ACT.THROW);
    this.stats[qb.team].att++;
    this.emit('throw', { lob, dist, x: qb.x, z: qb.z, long: dist > 22 });
  }

  updateBall(dt) {
    const b = this.ball;
    b.spin += dt;
    if (b.state === 'held') { this.syncHeldBall(); return; }
    if (b.state === 'dead') return;
    b.vy -= PHYS.gravity * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.state === 'air') {
      b.airT += dt;
      if (b.y < 3.6 && b.vy < 4) this.checkCatches();
      if (b.state === 'air' && b.y <= BALL_R) {
        b.y = BALL_R;
        if (this.phase === 'live') {
          this.emit('incomplete', { x: b.x, z: b.z });
          b.state = 'loose'; b.vy = Math.abs(b.vy) * 0.3; b.vx *= 0.4; b.vz *= 0.4;
          this.endPlay({ type: 'incomplete' });
          this.message('INCOMPLETE', '', '#ffffff');
        }
      }
    } else if (b.state === 'loose') {
      if (b.y <= BALL_R) {
        b.y = BALL_R;
        if (Math.abs(b.vy) > 1.2) {
          // prolate bounce: unpredictable
          b.vy = Math.abs(b.vy) * rand(0.35, 0.7);
          const ang = rand(-1.1, 1.1), c = Math.cos(ang), s = Math.sin(ang);
          const vx = b.vx * c - b.vz * s, vz = b.vx * s + b.vz * c;
          const k = rand(0.55, 0.9); b.vx = vx * k; b.vz = vz * k;
          if (Math.random() < 0.25) b.vy += rand(1, 3);
          this.emit('bounce', { x: b.x, z: b.z, v: Math.abs(b.vy) });
        } else {
          b.vy = 0; b.vx *= Math.max(0, 1 - dt * 2.5); b.vz *= Math.max(0, 1 - dt * 2.5);
        }
      }
      if (this.phase === 'live' || this.phase === 'onside') {
        if (Math.abs(b.z) > FIELD.halfWid + 0.3 || Math.abs(b.x) > FIELD.endLine + 0.3) this.looseOutOfBounds();
        else this.checkPickup();
      }
    }
  }

  checkCatches() {
    const b = this.ball;
    const cands = [];
    for (const p of this.players) {
      if (p.triedCatch || p.act === ACT.DOWN || p.act === ACT.TUMBLE || p.act === ACT.GETUP) continue;
      const jumping = p.act === ACT.JUMP;
      const diving = p.act === ACT.DIVE || p.act === ACT.TDIVE;
      const rad = jumping ? PHYS.jumpCatchRadius : diving ? 1.5 : PHYS.catchRadius;
      const top = p.y + (jumping ? 3.1 : 2.6), bot = p.y + (diving ? 0.0 : 0.25);
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < rad && b.y < top && b.y > bot) cands.push({ p, d, rad, jumping, diving });
    }
    cands.sort((a, c) => a.d - c.d);
    const passTeam = b.lastTeam;
    for (const c of cands) {
      const p = c.p; p.triedCatch = true;
      const tg = b.target ? Math.hypot(p.x - b.target.x, p.z - b.target.z) : c.d;
      const dfac = Math.min(c.d, b.deflected ? c.d : tg) / c.rad;
      if (p.team === passTeam) {
        let skill = this.assisted(p.team) ? 0.98 : p.human != null ? 0.93 : this.aiDiff(p).catchSkill;
        let contest = 0;
        for (const d of this.players) if (d.team !== p.team && d.act !== ACT.DOWN && Math.hypot(d.x - p.x, d.z - p.z) < 1.7) contest = Math.max(contest, d.act === ACT.JUMP ? 0.38 : 0.2);
        if (this.assisted(p.team)) contest *= 0.45;
        const bullet = b.lob < 0.3 && b.airT < 0.5 ? 0.12 : 0;
        const pc = clamp(skill - 0.32 * dfac * dfac - contest - bullet - (c.diving ? 0.08 : 0) + (b.deflected ? -0.15 : 0), 0.08, 0.98);
        if (Math.random() < pc) { this.completeCatch(p); return; }
        // drop / deflect
        this.deflect(p, 0.5);
        this.emit('drop', { x: b.x, z: b.z });
        return;
      } else {
        const ai = p.human == null;
        let timing = 1;
        if (c.jumping) { const apexT = 6.4 / PHYS.gravity; timing = clamp(1 - Math.abs(p.actT - apexT) / 0.35, 0.3, 1); }
        const skill = ai ? this.aiDiff(p).catchSkill : 0.9;
        const pInt = (c.jumping ? 0.34 : 0.14) * timing * skill * (1.2 - dfac * 0.6) * (b.lob > 0.6 ? 1.3 : 1);
        const pSwat = (c.jumping ? 0.5 : 0.28) * timing;
        const r = Math.random();
        if (r < pInt) { this.interception(p); return; }
        if (r < pInt + pSwat) { this.deflect(p, 1); this.emit('swat', { x: b.x, z: b.z }); this.message('SWATTED!', '', '#7af7ff'); return; }
      }
    }
  }

  deflect(p, power) {
    const b = this.ball;
    const sp = Math.hypot(b.vx, b.vz);
    const ang = Math.atan2(b.vz, b.vx) + Math.PI + rand(-1.4, 1.4);
    const k = rand(0.15, 0.35) * sp * power;
    b.vx = Math.cos(ang) * k; b.vz = Math.sin(ang) * k; b.vy = rand(2.5, 5.5) * power + 1.5;
    b.deflected = true; b.airT = 1;
    for (const q of this.players) if (q.i !== p.i && Math.hypot(q.x - b.x, q.z - b.z) > 1.2) q.triedCatch = false;
  }

  completeCatch(p) {
    const b = this.ball;
    if (Math.abs(p.z) > FIELD.halfWid || Math.abs(p.x) > FIELD.endLine) {
      this.emit('incomplete', { x: b.x, z: b.z });
      this.message('OUT OF BOUNDS', 'Incomplete pass', '#ffffff');
      b.state = 'loose'; this.endPlay({ type: 'incomplete' }); return;
    }
    this.giveBall(p, 'catch');
    this.setAct(p, ACT.CATCH);
    this.stats[p.team].comp++;
    const yds = Math.round((p.x - this.los) * dirOf(p.team));
    this.passCatchX = p.x;
    this.emit('catch', { x: p.x, z: p.z, i: p.i, long: Math.abs(p.x - this.passFromX) > 18 });
    if (Math.abs(p.x - this.passFromX) > 20) this.emit('crowd', { level: 0.8 });
    for (const q of this.players) if (q.team === p.team && q !== p && q.assign) q.assign = { type: 'block' };
    this.passCaught = true;
    void yds;
  }

  interception(p) {
    this.giveBall(p, 'int');
    this.setAct(p, ACT.CATCH);
    this.stats[1 - p.team].ints++;
    this.gainedInOwnEZ = dirOf(p.team) * p.x < -FIELD.goal;
    this.message('INTERCEPTED!', `${this.teams[p.team].name} pick it off`, '#ff4b2b');
    this.emit('int', { x: p.x, z: p.z, team: p.team });
    this.emit('crowd', { level: 1 });
  }

  checkPickup() {
    const b = this.ball;
    if (b.y > 0.95) return;
    let best = null, bd = PHYS.pickupRadius;
    for (const p of this.players) {
      if (p.act === ACT.DOWN || p.act === ACT.TUMBLE || p.act === ACT.GETUP) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const p = best;
    if (b.kick) {
      // onside kick rules
      const traveled = dirOf(this.kickTeam) * (b.x - b.kickX);
      if (p.team === this.kickTeam && traveled < 10 && !b.touchedR) {
        // illegal touch: give to receiving team
        this.endOnside(1 - this.kickTeam, b.x, 'ILLEGAL TOUCH', 'Ball must go 10 yards');
        return;
      }
      this.giveBall(p, 'recover');
      this.endOnside(p.team, p.x, p.team === this.kickTeam ? 'ONSIDE RECOVERED!' : 'RECOVERED', p.team === this.kickTeam ? `${this.teams[p.team].name} keep it!` : '');
      return;
    }
    const prevTeam = b.lastTeam;
    this.giveBall(p, 'recover');
    if (p.team !== prevTeam) {
      this.gainedInOwnEZ = dirOf(p.team) * p.x < -FIELD.goal;
      this.message('RECOVERED!', `${this.teams[p.team].name} take over`, '#ffd21f');
      this.emit('crowd', { level: 0.9 });
    }
    this.emit('recover', { x: p.x, z: p.z });
  }

  looseOutOfBounds() {
    const b = this.ball;
    if (b.kick) { this.endOnside(1 - this.kickTeam, clamp(b.x, -FIELD.goal + 1, FIELD.goal - 1), 'OUT OF BOUNDS', ''); return; }
    const team = b.lastTeam;
    this.message('OUT OF BOUNDS', '', '#ffffff');
    this.endPlay({ type: 'down', team, x: clamp(b.x, -FIELD.endLine, FIELD.endLine) });
  }

  // ---------- tackling ----------
  checkTackles() {
    const c = this.carrier();
    if (!c || c.act === ACT.DOWN || c.act === ACT.TUMBLE) return;
    for (const d of this.players) {
      if (d.team === c.team || d.tackleCd > 0) continue;
      if (d.act === ACT.DOWN || d.act === ACT.TUMBLE || d.act === ACT.GETUP || d.act === ACT.FAKED) continue;
      const diving = d.act === ACT.TDIVE;
      const range = diving ? PHYS.diveRange : PHYS.tackleRange;
      if (Math.abs(d.y - c.y) > 1.4) continue;
      const dist = Math.hypot(d.x - c.x, d.z - c.z);
      if (dist > range) continue;
      d.tackleCd = 0.6;
      // spin move beats arm tackles
      if (c.invuln > 0 && (!diving || Math.random() < 0.5)) { this.emit('evade', { x: c.x, z: c.z }); continue; }
      if (c.act === ACT.STIFF && Math.random() < (d.human != null ? 0.6 : 0.85 - this.aiDiff(d).tackle * 0.3)) {
        this.knockDown(d, c, 6);
        this.emit('stiffHit', { x: d.x, z: d.z });
        this.message('STIFF ARM!', '', '#ffd21f');
        continue;
      }
      // AI defenders can whiff
      if (d.human == null && !diving) {
        const sk = this.aiDiff(d).tackle;
        if (Math.random() > sk + 0.18) { this.setAct(d, ACT.FAKED); this.emit('evade', { x: c.x, z: c.z }); continue; }
      }
      if (c.human == null && d.human != null && !diving && Math.random() < 0.12) { this.setAct(d, ACT.FAKED); this.emit('evade', { x: c.x, z: c.z }); continue; }
      this.tackle(c, d, diving);
      return;
    }
  }

  knockDown(p, from, power) {
    const dx = p.x - from.x, dz = p.z - from.z, dl = Math.hypot(dx, dz) || 1;
    p.vx = dx / dl * power; p.vz = dz / dl * power; p.vy = 3;
    p.tvp = rand(-6, 6); p.tvr = rand(-4, 4); p.tPitch = 0; p.tRoll = 0; p.ai.downTime = 0.9;
    this.setAct(p, ACT.TUMBLE);
  }

  tackle(c, d, diving) {
    const rvx = d.vx - c.vx, rvz = d.vz - c.vz;
    const impact = Math.hypot(rvx, rvz) + (diving ? 1.5 : 0) + (d.sprinting ? 1 : 0);
    const big = impact > 15.5;
    const spotX = c.x;
    const sp = Math.max(0.1, Math.hypot(d.vx, d.vz));
    // carrier tumbles in hitter's direction
    const k = big ? 0.75 : 0.35;
    c.vx = c.vx * 0.3 + d.vx / sp * impact * k; c.vz = c.vz * 0.3 + d.vz / sp * impact * k;
    c.vy = big ? rand(5, 7.5) : rand(1.5, 3);
    const fwd = Math.cos(c.facing) * d.vx + Math.sin(c.facing) * d.vz > 0; // hit from behind -> fall forward
    c.tPitch = 0; c.tRoll = 0;
    c.tvp = (fwd ? -1 : 1) * (big ? rand(7, 12) : rand(3, 5));
    c.tvr = big ? rand(-6, 6) : rand(-1.5, 1.5);
    c.ai.downTime = big ? 1.5 : 1.0;
    this.setAct(c, ACT.TUMBLE);
    if (!diving) { d.vx *= 0.4; d.vz *= 0.4; d.vy = 2; d.tvp = -4; d.tvr = rand(-1, 1); d.tPitch = 0; d.tRoll = 0; d.ai.downTime = 0.7; this.setAct(d, ACT.TUMBLE); }
    this.emit(big ? 'bigHit' : 'tackle', { x: c.x, z: c.z, impact });
    if (big) {
      this.stats[d.team].bigHits++;
      this.slowmo = 0.75; this.shake = 1;
      this.emit('crowd', { level: 1 });
    }
    const isQBSack = c.slot === 0 && c.team === this.possession && this.passAllowed && dirOf(c.team) * (spotX - this.los) < 0;
    // fumble?
    const fumbleChance = (big ? 0.24 : 0.035) * (this.assisted(c.team) ? 0.25 : 1);
    if (this.phase === 'live' && Math.random() < fumbleChance) {
      const b = this.ball;
      b.state = 'loose'; b.holder = -1; b.lastTeam = c.team;
      b.x = c.x; b.y = 1.1; b.z = c.z;
      b.vx = c.vx * 0.8 + rand(-3, 3); b.vz = c.vz * 0.8 + rand(-3, 3); b.vy = rand(3, 6);
      this.stats[c.team].fumbles++;
      this.message('FUMBLE!', 'Ball is loose!', '#ff4b2b');
      this.emit('fumble', { x: c.x, z: c.z });
      this.emit('crowd', { level: 1 });
      if (this.phase === 'onside') return;
      return;
    }
    if (isQBSack) { this.stats[d.team].sacks++; this.message(big ? 'BIG SACK!' : 'SACKED!', '', '#ff4b2b'); }
    else if (big) this.message('BIG HIT!', '', '#ff4b2b');
    this.carrierDown(c, 'tackle', spotX);
  }

  carrierDown(c, how, spotX = c.x) {
    if (this.phase !== 'live') return;
    this.endPlay({ type: 'down', team: c.team, x: spotX, z: c.z, how });
  }

  checkRules() {
    const c = this.carrier();
    if (!c) return;
    const d = dirOf(c.team);
    // touchdown
    if (d * c.x > FIELD.goal && Math.abs(c.z) <= FIELD.halfWid && c.act !== ACT.DOWN) {
      if (this.phase === 'onside') { this.endOnside(c.team, c.x, 'RECOVERED', ''); return; }
      this.touchdown(c);
      return;
    }
    // out of bounds
    if (Math.abs(c.z) > FIELD.halfWid || Math.abs(c.x) > FIELD.endLine) {
      if (this.phase === 'onside') { this.endOnside(c.team, clamp(c.x, -FIELD.goal + 1, FIELD.goal - 1), 'OUT OF BOUNDS', ''); return; }
      this.message('OUT OF BOUNDS', '', '#ffffff');
      this.endPlay({ type: 'down', team: c.team, x: clamp(c.x, -FIELD.endLine, FIELD.endLine), how: 'oob' });
      return;
    }
    if (c.slot === 0 && this.passAllowed && d * (c.x - this.los) > 0.6) this.passAllowed = false;
  }

  // ---------- play results ----------
  endPlay(res) {
    if (this.phase !== 'live') return;
    this.setPhase('dead');
    this.pending = res;
    this.emit('whistle');
    this.emit('playEnd', res);
    this.aim = null;
    for (const h of this.humans) h.holding = false;
  }

  touchdown(c) {
    const team = c.team;
    this.setPhase('td');
    this.celebrator = c.i;
    this.aim = null;
    if (this.conversion) {
      const pts = this.conversion.pts;
      this.tdTeam = this.conversion.team;
      if (team === this.conversion.team) {
        this.score[team] += pts;
        this.message(pts === 2 ? '2-POINT GOOD!' : 'EXTRA POINT GOOD!', `+${pts}`, '#ffd21f');
        this.emit('convGood', { team, pts });
        this.emit('crowd', { level: 0.9 });
      } else { this.message('NO GOOD', 'Conversion returned', '#aaaaaa'); this.emit('convFail'); }
      this.phaseT = RULES.tdCelebrate - 1.6; // short celebration, no replay
      this.convDone = true;
      this.setAct(c, ACT.CHEER);
      this.pending = { type: 'convEnd', team: this.conversion.team };
      return;
    }
    this.score[team] += 6;
    this.stats[team].tds++;
    const yds = Math.round(Math.abs(c.x - this.playStartX));
    this.message('TOUCHDOWN!', `${this.teams[team].city} ${this.teams[team].name}`, this.teams[team].primary);
    this.emit('td', { team, i: c.i, yds });
    this.emit('crowd', { level: 1.2 });
    this.setAct(c, ACT.CELEB); c.actVar = randInt(0, 4);
    c.vx *= 0.3; c.vz *= 0.3;
    this.tdTeam = team;
    this.pending = { type: 'tdDone', team };
  }

  stepCelebrate(dt) {
    const sc = this.players[this.celebrator] || null;
    for (const p of this.players) {
      this.tickTimers(p, dt);
      if (p.act === ACT.TUMBLE || p.act === ACT.DOWN || p.act === ACT.GETUP) { this.updateBodyState(p, dt); if (p.act === ACT.DOWN && p.downT <= 0) this.setAct(p, ACT.GETUP); continue; }
      if (p.act === ACT.DIVE || p.act === ACT.TDIVE || p.act === ACT.JUMP) { this.updateBodyState(p, dt); continue; }
      if (sc && p === sc && this.phase !== 'gameover') {
        p.vx *= Math.max(0, 1 - dt * 3); p.vz *= Math.max(0, 1 - dt * 3);
        p.x += p.vx * dt; p.z += p.vz * dt;
        if (p.act === ACT.CELEB) {
          if (p.actVar === 2 && this.ball.state === 'held' && p.actT > 0.55) { // spike
            const b = this.ball; b.state = 'loose'; b.holder = -1; b.vx = rand(-2, 2); b.vz = rand(-2, 2); b.vy = -16; b.y = 1.3;
            this.emit('spike', { x: p.x, z: p.z });
          }
          if (p.actVar === 3 && p.actT > 0.3 && p.actT < 1.2) p.y = Math.max(0, Math.sin((p.actT - 0.3) / 0.9 * Math.PI) * 1.6); else p.y = 0;
        }
        continue;
      }
      // teammates rush to celebrate; opponents walk sadly
      if (sc && p.team === sc.team && this.phase !== 'gameover') {
        const dx = sc.x - p.x, dz = sc.z - p.z, d = Math.hypot(dx, dz);
        if (d > 2.2) movePlayer(p, dx / d, dz / d, d > 5, dt);
        else { movePlayer(p, 0, 0, false, dt); if (p.act !== ACT.CHEER) this.setAct(p, ACT.CHEER); }
      } else if (this.phase === 'gameover') {
        movePlayer(p, 0, 0, false, dt);
        const want = p.team === this.winner ? ACT.CHEER : ACT.SAD;
        if (p.act !== want) this.setAct(p, want);
      } else {
        movePlayer(p, 0, 0, false, dt);
        if (p.act !== ACT.SAD) this.setAct(p, ACT.SAD);
      }
    }
    this.updateBall(dt);
  }

  stepDead(dt) {
    for (const p of this.players) {
      this.tickTimers(p, dt);
      if (this.updateBodyState(p, dt)) continue;
      movePlayer(p, 0, 0, false, dt);
    }
    for (const h of this.humans) this.consumeHumanPresses(h);
    this.updateBall(dt);
  }

  resolvePending() {
    const res = this.pending; this.pending = null;
    if (!res) { this.enterSelect(); return; }
    const b = this.ball;
    // conversion attempt failed / ended
    if (this.conversion) {
      if (res.type !== 'convEnd') { this.message('NO GOOD', 'Conversion failed', '#aaaaaa'); this.emit('convFail'); }
      const team = this.conversion.team;
      this.conversion = null;
      this.enterKickChoice(team);
      return;
    }
    if (res.type === 'convEnd') { this.conversion = null; this.enterKickChoice(res.team); return; }
    if (res.type === 'incomplete') {
      this.advanceDown(this.los);
    } else if (res.type === 'down') {
      const team = res.team;
      const d = dirOf(team);
      let x = res.x;
      // safety / touchback
      if (d * x < -FIELD.goal) {
        if (this.gainedInOwnEZ) { this.message('TOUCHBACK', '', '#ffffff'); this.startSeries(team, RULES.touchbackYards); return this.nextSnapOrQuarter(); }
        this.safety(team); return;
      }
      if (team !== this.possession) {
        // turnover
        this.possession = team;
        this.startSeries(team, clamp(xToYard(team, x), 1, 59));
        this.message('TURNOVER', `${this.teams[team].name} ball`, '#ffd21f');
        return this.nextSnapOrQuarter();
      }
      const gain = (x - this.playStartX) * d;
      if (this.ball && b.passer >= 0 && this.passCaught) this.stats[team].passYds += Math.round(gain); else this.stats[team].rushYds += Math.round(gain);
      this.advanceDown(clamp(x, -FIELD.goal + 0.5, FIELD.goal - 0.5));
    }
    b.passer = -1; this.passCaught = false;
  }

  advanceDown(newX) {
    const d = dirOf(this.possession);
    this.passCaught = false; this.ball.passer = -1;
    if (d * (newX - this.fdX) >= 0) {
      const yl = clamp(xToYard(this.possession, newX), 1, 59);
      this.startSeries(this.possession, yl);
      this.message('FIRST DOWN', '', '#ffd21f');
      this.emit('firstDown');
      return this.nextSnapOrQuarter();
    }
    this.los = newX;
    this.down++;
    if (this.down > 4) {
      const other = 1 - this.possession;
      this.startSeries(other, clamp(xToYard(other, newX), 1, 59));
      this.message('TURNOVER ON DOWNS', `${this.teams[other].name} ball`, '#ff4b2b');
      this.emit('turnoverDowns');
    }
    this.nextSnapOrQuarter();
  }

  safety(team) {
    const other = 1 - team;
    this.score[other] += 2;
    this.message('SAFETY!', `+2 ${this.teams[other].name}`, '#ff4b2b');
    this.emit('safety', { team: other });
    this.emit('crowd', { level: 0.9 });
    if (this.ot) { this.endGame(); return; }
    this.startSeries(other, RULES.touchbackYards);
    this.nextSnapOrQuarter();
  }

  nextSnapOrQuarter() {
    if (this.clock <= 0 && !this.conversion) { this.endQuarter(); return; }
    this.enterSelect();
  }

  endQuarter() {
    if (this.quarter >= 4 && !this.ot && this.score[0] !== this.score[1]) { this.endGame(); return; }
    if (this.ot && this.score[0] !== this.score[1]) { this.endGame(); return; }
    if (this.quarter >= 4) {
      // overtime (sudden death)
      this.ot = true; this.quarter++; this.clock = RULES.quarterLen;
      const team = Math.random() < 0.5 ? 0 : 1;
      this.startSeries(team, RULES.touchbackYards);
      this.message('OVERTIME', 'Sudden death! Next score wins', '#ffd21f');
      this.emit('quarter', { q: this.quarter, ot: true });
    } else {
      const ended = this.quarter;
      this.quarter++; this.clock = RULES.quarterLen;
      if (this.quarter === 3) {
        this.startSeries(1 - this.firstPossession, RULES.touchbackYards);
        this.message('HALFTIME', `${this.score[0]} - ${this.score[1]}`, '#ffd21f');
      } else this.message(`END OF Q${ended}`, '', '#ffffff');
      this.emit('quarter', { q: this.quarter });
    }
    this.setPhase('quarterBreak', 2.4);
  }

  endGame() {
    this.winner = this.score[0] > this.score[1] ? 0 : 1;
    this.setPhase('gameover');
    this.message('FINAL', `${this.teams[this.winner].name} win!`, this.teams[this.winner].primary);
    this.emit('gameover', { winner: this.winner, score: this.score.slice() });
    this.emit('crowd', { level: 1 });
  }

  afterTouchdown() {
    const team = this.tdTeam;
    for (const p of this.players) { if (p.act === ACT.CELEB || p.act === ACT.CHEER || p.act === ACT.SAD) this.setAct(p, ACT.NONE); p.y = 0; }
    if (this.ot) { this.endGame(); return; }
    if (this.convDone) { this.convDone = false; this.conversion = null; this.enterKickChoice(team); return; }
    this.choice = { kind: 'conv', team, timer: 6, value: null };
    this.setPhase('convChoice');
  }

  enterKickChoice(team) {
    this.choice = { kind: 'kick', team, timer: 5, value: null };
    this.setPhase('kickChoice');
  }

  stepChoice(dt) {
    const ch = this.choice;
    ch.timer -= dt;
    this.idlePlayers(dt, true);
    for (const h of this.humans) this.consumeHumanPresses(h);
    const hasHuman = this.teamHumans(ch.team).length > 0;
    if (!hasHuman && ch.value == null && this.phaseT > 1.0) ch.value = ch.kind === 'conv' ? aiConversion(this, ch.team) : (aiOnside(this, ch.team) ? 'onside' : 'normal');
    if (ch.timer <= 0 && ch.value == null) ch.value = ch.kind === 'conv' ? 1 : 'normal';
    if (ch.value == null) return;
    if (ch.kind === 'conv') {
      const pts = ch.value;
      this.conversion = { team: ch.team, pts };
      this.possession = ch.team;
      const yds = pts === 2 ? RULES.convTwoPointYards : RULES.convOnePointYards;
      this.los = dirOf(ch.team) * (FIELD.goal - yds);
      this.down = 1; this.goalToGo = true; this.fdX = dirOf(ch.team) * FIELD.goal;
      this.message(pts === 2 ? 'GOING FOR TWO' : 'EXTRA POINT TRY', `From the ${yds}`, '#ffffff');
      this.choice = null;
      this.placeFormation(true);
      this.enterSelect();
      this.down = 4; // one try
      this.convTry = true;
    } else {
      const team = ch.team;
      this.choice = null;
      if (ch.value === 'onside') this.setupOnside(team);
      else {
        this.startSeries(1 - team, RULES.touchbackYards);
        this.placeFormation(true);
        this.nextSnapOrQuarter();
      }
    }
  }

  setupOnside(team) {
    this.kickTeam = team;
    this.possession = team;
    const d = dirOf(team);
    const bx = yardToX(team, RULES.onsideSpotYards);
    this.los = bx;
    for (const p of this.players) {
      p.act = ACT.NONE; p.y = 0; p.vx = p.vz = 0; p.engaged = 0; p.ai = {};
      const zs = [-6, 0, 6];
      if (p.team === team) { p.x = bx - d * 1.5; p.z = zs[p.slot] + (p.slot === 1 ? 0.8 : 0); p.facing = d > 0 ? 0 : Math.PI; }
      else { p.x = bx + d * 11; p.z = zs[p.slot] * 1.2; p.facing = d > 0 ? Math.PI : 0; }
      p.ai.setX = p.x; p.ai.setZ = p.z;
    }
    const b = this.ball; b.state = 'dead'; b.holder = -1; b.x = bx; b.z = 0; b.y = BALL_R; b.vx = b.vy = b.vz = 0;
    this.message('ONSIDE KICK!', 'Recover it to keep the ball', '#ffd21f');
    this.emit('onside');
    this.setPhase('onsideSet', 1.4);
  }

  kickOnside() {
    const d = dirOf(this.kickTeam);
    const b = this.ball;
    b.state = 'loose'; b.kick = true; b.kickX = b.x; b.touchedR = false; b.lastTeam = 1 - this.kickTeam;
    b.vx = d * rand(8.5, 12.5); b.vz = rand(-2.5, 2.5); b.vy = rand(2.5, 5.5);
    for (const p of this.players) p.assign = { type: 'chase' };
    this.emit('kick', { x: b.x, z: b.z });
    this.emit('whistleShort');
    this.setPhase('onside');
  }

  endOnside(team, x, text, sub) {
    if (this.phase !== 'onside') return;
    const b = this.ball;
    if (team == null) team = 1 - this.kickTeam;
    if (x == null) x = b.x;
    b.kick = false;
    if (text) this.message(text, sub || '', team === this.kickTeam ? '#ffd21f' : '#ffffff');
    this.emit('whistle');
    this.startSeries(team, clamp(xToYard(team, x), 1, 59));
    this.setPhase('dead');
    this.pending = { type: 'onsideDone' };
    this.resolvePendingOnside = true;
  }

  // Override resolvePending for onside-done
  // (kept separate for clarity)
  _resolveOnside() {
    this.nextSnapOrQuarter();
  }

  // ---------- snapshots ----------
  snapshot() {
    const P = this.players.map(p => [
      +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +p.facing.toFixed(3), p.act, +p.actT.toFixed(3), p.actVar,
      +p.vx.toFixed(2), +p.vz.toFixed(2), +p.stamina.toFixed(2), (p.sprinting ? 1 : 0) | (p.engaged > 0 ? 2 : 0) | (p.invuln > 0 ? 4 : 0) | (this.isWinding(p) ? 8 : 0),
      +p.tPitch.toFixed(3), +p.tRoll.toFixed(3), p.human == null ? null : p.human,
      +Math.max(0, p.cd.juke).toFixed(2), +Math.max(0, p.cd.spin).toFixed(2), +Math.max(0, p.cd.stiff).toFixed(2),
    ]);
    const b = this.ball;
    const B = [+b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3), +b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2),
      b.state === 'held' ? 0 : b.state === 'air' ? 1 : b.state === 'loose' ? 2 : 3, b.holder, +b.lob.toFixed(2)];
    return { p: P, b: B, g: this.hudInfo() };
  }

  hudInfo() {
    const d = dirOf(this.possession);
    const ballOn = xToYard(this.possession, this.los);
    return {
      phase: this.phase, phaseT: +this.phaseT.toFixed(2), phaseDur: this.phaseDur,
      q: this.quarter, ot: this.ot, clock: +this.clock.toFixed(1), score: this.score.slice(),
      pos: this.possession, down: this.down, toGo: this.goalToGo ? 'Goal' : Math.max(1, Math.round(d * (this.fdX - this.los))),
      ballOn: Math.round(ballOn), los: +this.los.toFixed(2), fdX: +this.fdX.toFixed(2),
      opts: this.offOptions, picks: { off: !!this.picks.off, def: !!this.picks.def }, offPlay: this.offPlay ? this.offPlay.id : null, defPlay: this.defPlay ? this.defPlay.id : null,
      pickTimer: +Math.max(0, this.pickTimer).toFixed(2), pickLen: this.pickLen, assist: this.assist,
      target: this.target.slice(), aim: this.aim, passAllowed: this.passAllowed,
      conv: this.conversion ? this.conversion.pts : 0,
      choice: this.choice ? { kind: this.choice.kind, team: this.choice.team, timer: +this.choice.timer.toFixed(1), value: this.choice.value } : null,
      humans: this.humans.map(h => ({ id: h.id, team: h.team, pIdx: h.pIdx, name: h.name, ack: h.ack })),
      winner: this.winner, celebrator: this.celebrator, slowmo: this.slowmo > 0 ? 1 : 0,
      stats: this.stats, msg: this.msg ? { text: this.msg.text, sub: this.msg.sub, color: this.msg.color, id: this.msg.id } : null,
      ballTeam: this.ballTeam(),
      bt: this.ball.state === 'air' && this.ball.target ? [+this.ball.target.x.toFixed(2), +this.ball.target.z.toFixed(2)] : null,
      t: +this.t.toFixed(2),
    };
  }
}

// patch: onside dead phase resolution
const _resolve = Sim.prototype.resolvePending;
Sim.prototype.resolvePending = function () {
  if (this.pending && this.pending.type === 'onsideDone') { this.pending = null; this.placeFormation(true); return this.nextSnapOrQuarter(); }
  return _resolve.call(this);
};

export { pick };
