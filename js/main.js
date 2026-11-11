// Gridiron Blitz — app bootstrap, main loop, mode orchestration.
import * as THREE from 'three';
import { QUALITY, RULES, storeGet, storeSet, rand, pick } from './config.js';
import { getTeams, getTeam, saveTeamOverride, resetTeamOverride, playerNumber, setPlayerNumber, colorDistance } from './teams.js';
import { DEF_LIST } from './plays.js';
import { Renderer } from './render.js';
import { Stadium } from './field.js';
import { PlayerModel } from './players.js';
import { BallModel } from './ball.js';
import { FX } from './fx.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { LocalMatch, ClientMatch } from './match.js';
import { NetHost, NetClient } from './network.js';
import { Season } from './season.js';
import { ACT, dirOf } from './sim.js';

const bootMsg = (t, p) => { const m = document.querySelector('.boot-msg'); if (m) m.textContent = t; const b = document.querySelector('.boot-bar div'); if (b && p != null) b.style.width = `${p}%`; };

class App {
  async init() {
    this.settings = Object.assign({ quality: 'medium', difficulty: 'pro', showFps: false, name: 'Player' + Math.floor(rand(10, 99)), lastTeam: 0 }, storeGet('settings', {}));
    if (!QUALITY[this.settings.quality]) this.settings.quality = 'medium';
    this.Q = QUALITY[this.settings.quality];
    bootMsg('Building stadium…', 20);
    this.r = new Renderer(document.getElementById('gl'));
    this.stadium = new Stadium(this.r.scene, this.r.renderer, this.Q);
    this.stadium.setTeams(getTeam(0), getTeam(3));
    this.stadium.setQuality(this.Q);
    this.r.setQuality(this.Q);
    bootMsg('Suiting up players…', 55);
    this.fx = new FX(this.r.scene, this.Q);
    this.models = [];
    for (let i = 0; i < 6; i++) { const m = new PlayerModel(getTeam(i < 3 ? 0 : 3), i % 3, { outlines: this.Q.outlines, decals: this.Q.decals }); this.r.scene.add(m.group); this.models.push(m); }
    this.ballModel = new BallModel(); this.r.scene.add(this.ballModel.group);
    this.showcase = new PlayerModel(getTeam(0), 0, { number: playerNumber() });
    this.showcase.group.visible = false; this.r.scene.add(this.showcase.group);
    this.showcasePos = new THREE.Vector3(-6, 0, 19);
    this.rig = new CameraRig(this.r.camera);
    this.audio = new Audio();
    this.input = new Input();
    this.ui = new UI(this);
    this.ui.fpsEl.classList.toggle('hidden', !this.settings.showFps);
    this.input.onKey((code, e) => this.onKey(code, e));
    const unlock = () => { this.audio.init(); if (!this.match || this.match.demo) this.audio.startMusic(); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    this.recorder = { frames: [], t: 0 };
    this.replay = null;
    this.tmpV = new THREE.Vector3(); this.tmpV2 = new THREE.Vector3();
    this.jumboT = 0; this.jumboMsg = null;
    this.frame = 0;
    bootMsg('Warming up…', 85);
    this.startDemo();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('40px "Russo One"').then(() => { const t = this.stadium.teams; if (t) this.stadium.setTeams(t[0], t[1]); }).catch(() => {});
    }
    // compile shaders up front to avoid hitches
    try { this.r.renderer.compile(this.r.scene, this.r.camera); } catch (e) { /* ignore */ }
    const q = new URLSearchParams(location.search);
    const room = q.get('room');
    this.ui.show(room ? 'online' : 'main', room ? { code: room.toUpperCase().slice(0, 4) } : {});
    bootMsg('Ready!', 100);
    setTimeout(() => { const b = document.getElementById('boot'); if (b) { b.classList.add('done'); setTimeout(() => b.remove(), 700); } }, 150);
    this.last = performance.now();
    this.fpsAcc = 0; this.fpsN = 0;
    requestAnimationFrame(t => this.loop(t));
  }

  saveSettings() { storeSet('settings', this.settings); }

  // ---------------- modes ----------------
  kitTeams(a, b) {
    const ta = typeof a === 'object' ? a : getTeam(a);
    let tb = typeof b === 'object' ? b : getTeam(b);
    if (colorDistance(ta.primary, tb.primary) < 110) tb = { ...tb, primary: tb.accent, accent: tb.primary, alt: true };
    return [ta, tb];
  }

  applyTeams(teams, myTeam = -1) {
    this.stadium.setTeams(teams[0], teams[1]);
    for (let i = 0; i < 6; i++) {
      const t = teams[i < 3 ? 0 : 1];
      const num = (i < 3 ? 0 : 1) === myTeam && i % 3 === 0 ? playerNumber() : undefined;
      this.models[i].setTeam(t, num);
    }
    this.fx.trails.forEach(t => t.clear());
  }

  startDemo() {
    this.disposeMatch();
    const teams = this.kitTeams(Math.floor(rand(0, 8)), Math.floor(rand(0, 8)));
    if (teams[0].id === teams[1].id) teams[1] = getTeam((getTeams().findIndex(t => t.id === teams[0].id) + 4) % 8);
    this.applyTeams(teams);
    this.match = new LocalMatch(this, { teams, difficulty: 'allstar', mode: 'demo', humans: [], demo: true });
    this.match.sim.firstOffer = false;
    this.rig.setMode('menu');
    this.ui.showHud(false);
    this.audio.setCrowdBase && this.audio.ctx && this.audio.setCrowdBase(0.08);
  }

  disposeMatch() {
    if (this.match && this.match.dispose) this.match.dispose();
    this.match = null; this.replay = null; this.recorder = { frames: [], t: 0 }; this.paused = false; this.gameOverShown = false;
    this.r.desat = 0;
  }

  startLocalMatch(mode, a, b, diff, extra = {}) {
    this.disposeMatch();
    const teams = this.kitTeams(a, b);
    const humans = mode === 'local2' ? [{ id: 'p1', team: 0, name: 'P1' }, { id: 'p2', team: 1, name: 'P2' }] : [{ id: 'p1', team: extra.userSide ?? 0, name: this.settings.name }];
    const localHumans = mode === 'local2' ? [{ id: 'p1', team: 0, pad: 0 }, { id: 'p2', team: 1, pad: 1 }] : [{ id: 'p1', team: extra.userSide ?? 0, pad: 0 }];
    this.input.setDual(mode === 'local2');
    this.applyTeams(teams, mode === 'local2' ? -1 : localHumans[0].team);
    this.match = new LocalMatch(this, { teams, difficulty: diff, mode: mode === 'season' ? 'season' : mode, humans, localHumans });
    this.matchMode = mode;
    this.matchExtra = extra;
    this.enterMatchUI(teams, false);
  }

  enterMatchUI(teams, online) {
    this.ui.show(null);
    this.ui.showHud(true, { teams, online });
    this.audio.stopMusic();
    if (this.audio.ctx) this.audio.setCrowdBase(0.14);
    this.rig.setMode('broadcast');
  }

  quitMatch() {
    if (this.net) { this.leaveOnline(); return; }
    this.input.setDual(false);
    this.startDemo();
    this.audio.startMusic();
    this.ui.show(this.matchMode === 'season' ? 'season' : 'main', this.matchMode === 'season' ? { season: Season.load() } : {});
  }

  togglePause(force) {
    if (!this.match || this.match.demo) return;
    const on = force ?? !this.paused;
    this.paused = on;
    if (!this.match.isClient && !this.net) this.match.paused = on;
    this.ui.showPause(on, !!this.net);
    if (!on) this.ui.show(null);
  }
  pauseSub(name) {
    this.ui.showPause(false);
    this.ui.show(name, { back: () => { this.ui.show(null); this.ui.showPause(true, !!this.net); } });
  }

  pickPlay(humanId, id) { this.matchCommand(humanId, { type: 'pick', id }); this.audio.blip(880, 0.06); }
  matchCommand(humanId, cmd) { if (this.match && !this.match.demo) this.match.command(humanId, cmd); }

  // ---------------- season ----------------
  openSeason() { this.ui.show('season', { season: Season.load() }); }
  newSeason(team, diff) { const s = Season.create(team); s.difficulty = diff; s.save(); this.ui.show('season', { season: s }); }
  abandonSeason() { Season.clear(); this.ui.show('season', { season: null }); }
  playSeasonGame() {
    const s = Season.load(); if (!s) return;
    const g = s.nextGame(); if (!g) return;
    this.season = s;
    this.startLocalMatch('season', g.home, g.away, s.difficulty || this.settings.difficulty, { userSide: g.home === s.userTeam ? 0 : 1, label: g.label });
  }

  // ---------------- editor ----------------
  previewTeam(idx, draft) {
    const t = { ...getTeams()[idx], ...draft };
    this.showcase.setTeam(t, draft.number);
    this.editorActive = true;
  }
  endPreview() { this.editorActive = false; }
  saveTeam(idx, d) {
    const t = getTeams()[idx];
    saveTeamOverride(t.id, { primary: d.primary, secondary: d.secondary, accent: d.accent, helmet: d.helmet, jersey: d.jersey });
    setPlayerNumber(d.number);
    this.settings.lastTeam = idx; this.saveSettings();
  }
  resetTeam(idx) { resetTeamOverride(getTeams()[idx].id); }

  onScreen(name) {
    this.editorActive = name === 'editor';
    if (this.match && this.match.demo) this.rig.setMode(name === 'editor' ? 'editor' : 'menu');
  }

  setQuality(k) {
    this.settings.quality = k; this.saveSettings();
    this.Q = QUALITY[k];
    this.r.setQuality(this.Q);
    this.stadium.setQuality(this.Q);
    this.fx.setQuality(this.Q);
    this.models.forEach(m => m.setQuality(this.Q));
  }

  // ---------------- online ----------------
  async hostOnline(name) {
    const net = new NetHost();
    await net.open();
    this.net = net;
    this.roomLink = net.link();
    const home = this.settings.lastTeam ?? 0;
    this.lobby = { code: net.code, players: [{ id: 'host', name, team: 0, ready: true, host: true }], teams: [home, (home + 3) % 8], difficulty: this.settings.difficulty, inGame: false };
    net.on('join', (id, meta) => {
      const L = this.lobby;
      const counts = [0, 1].map(k => L.players.filter(p => p.team === k).length);
      if (counts[0] >= 3 && counts[1] >= 3) { net.kick(id, 'Room is full'); return; }
      if (L.inGame) { net.kick(id, 'Game already in progress'); return; }
      const team = counts[1] < counts[0] ? 1 : counts[0] < 3 ? 0 : 1;
      const nm = String((meta && meta.name) || 'Player').slice(0, 14);
      L.players.push({ id, name: nm, team, ready: false });
      net.send(id, { t: 'welcome', id });
      this.broadcastLobby();
      this.ui.toast(`${nm} joined`);
    });
    net.on('leave', (id) => {
      const L = this.lobby; const p = L.players.find(x => x.id === id);
      L.players = L.players.filter(x => x.id !== id);
      if (p) this.ui.toast(`${p.name} left`);
      if (this.match && !this.match.demo && this.match.humanLeft) this.match.humanLeft(id, p && p.name);
      if (!L.inGame) this.broadcastLobby();
    });
    net.on('msg', (id, msg) => this.hostLobbyMsg(id, msg));
    net.on('error', (e) => this.ui.toast('Network: ' + (e.type || e.message || e)));
    this.ui.show('lobby');
    this.broadcastLobby();
  }

  lobbyTeamObjs() { return this.kitTeams(this.lobby.teams[0], this.lobby.teams[1]); }
  broadcastLobby() {
    if (!this.net || !this.net.isHost) return;
    const L = this.lobby;
    L.teamObjs = this.lobbyTeamObjs();
    this.net.broadcast({ t: 'lobby', lobby: L });
    if (this.ui.current === 'lobby') this.ui.refresh();
  }
  hostLobbyMsg(id, msg) {
    if (!msg || typeof msg !== 'object') return;
    const L = this.lobby; const p = L.players.find(x => x.id === id);
    if (!p) return;
    if (msg.t === 'team' && (msg.team === 0 || msg.team === 1) && !L.inGame) {
      if (L.players.filter(x => x.team === msg.team).length < 3) { p.team = msg.team; p.ready = false; this.broadcastLobby(); }
    } else if (msg.t === 'ready' && !L.inGame) { p.ready = !!msg.ready; this.broadcastLobby(); }
    else if (msg.t === 'emoji' && typeof msg.e === 'string') { const e = msg.e.slice(0, 4); this.net.broadcast({ t: 'emoji', name: p.name, e }); this.ui.floatEmoji(p.name, e); this.audio.blip(1200, 0.05, 'sine', 0.05); }
  }
  lobbySend(msg) {
    if (!this.net) return;
    if (this.net.isHost) {
      const p = this.lobby.players.find(x => x.id === 'host');
      if (msg.t === 'team' && this.lobby.players.filter(x => x.team === msg.team).length < 3) { p.team = msg.team; this.broadcastLobby(); }
    } else this.net.send(msg);
  }
  lobbySetTeam(k, idx) { this.lobby.teams[k] = idx; this.broadcastLobby(); }
  lobbySetDiff(d) { this.lobby.difficulty = d; this.broadcastLobby(); }
  sendEmoji(e) {
    if (!this.net) return;
    if (this.net.isHost) { const name = this.lobby.players.find(x => x.id === 'host').name; this.net.broadcast({ t: 'emoji', name, e }); this.ui.floatEmoji(name, e); }
    else this.net.send({ t: 'emoji', e });
  }

  startOnlineMatch() {
    const L = this.lobby;
    L.inGame = true;
    const teams = this.lobbyTeamObjs();
    const humans = L.players.map(p => ({ id: p.id, team: p.team, name: p.name }));
    const setup = { teams, difficulty: L.difficulty, humans };
    for (const p of L.players) if (p.id !== 'host') this.net.send(p.id, { t: 'start', setup: { ...setup, myTeam: p.team } });
    this.disposeMatch();
    this.applyTeams(teams);
    const me = L.players.find(p => p.id === 'host');
    this.input.setDual(false);
    this.match = new LocalMatch(this, { teams, difficulty: L.difficulty, mode: 'online', humans, localHumans: [{ id: 'host', team: me.team, pad: 0 }], net: this.net });
    this.matchMode = 'online';
    this.enterMatchUI(teams, true);
  }

  async joinOnline(code, name) {
    const net = new NetClient();
    await net.join(code, name);
    this.net = net;
    this.roomLink = (() => { const u = new URL(location.href); u.search = ''; u.searchParams.set('room', code); const q = new URLSearchParams(location.search); for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure']) if (q.get(k)) u.searchParams.set(k, q.get(k)); return u.toString(); })();
    net.on('msg', (msg) => {
      if (msg.t === 'lobby') {
        this.lobby = msg.lobby;
        if (!this.match || this.match.demo) { if (this.ui.current === 'lobby') this.ui.refresh(); else this.ui.show('lobby'); }
      } else if (msg.t === 'start') this.startClientMatch(msg.setup);
      else if (msg.t === 'emoji') { this.ui.floatEmoji(msg.name, msg.e); this.audio.blip(1200, 0.05, 'sine', 0.05); }
      else if (msg.t === 'kick') { this.ui.toast(msg.reason || 'Removed from room'); this.leaveOnline(true); }
      else if (msg.t === 'closed') { this.ui.toast('Host closed the room'); this.leaveOnline(true); }
      else if (msg.t === 'toLobby') { this.toLobby(); }
    });
    net.on('closed', () => { if (this.net === net) { this.ui.toast('Disconnected from host'); this.leaveOnline(true); } });
    this.ui.show('lobby');
  }

  startClientMatch(setup) {
    this.disposeMatch();
    this.applyTeams(setup.teams);
    this.input.setDual(false);
    this.match = new ClientMatch(this, this.net, setup);
    this.matchMode = 'online';
    this.enterMatchUI(setup.teams, true);
  }

  toLobby() {
    if (this.net && this.net.isHost) { this.lobby.inGame = false; this.lobby.players.forEach(p => { if (!p.host) p.ready = false; }); this.net.broadcast({ t: 'toLobby' }); }
    this.startDemo();
    this.ui.show('lobby');
    if (this.net && this.net.isHost) this.broadcastLobby();
  }

  leaveOnline(silent) {
    const net = this.net; this.net = null; this.lobby = null;
    if (net) net.close();
    this.startDemo();
    this.audio.startMusic();
    this.ui.show('main');
    void silent;
  }

  // ---------------- input ----------------
  onKey(code) {
    const m = this.match;
    if (code === 'Escape') {
      if (m && !m.demo) { if (this.gameOverShown) return; this.togglePause(); }
      else if (this.ui.current && this.ui.current !== 'main' && this.ui.current !== 'lobby') { const back = document.querySelector('.screen.active .btn.ghost'); if (back) back.click(); }
      return;
    }
    if (!m || m.demo || this.paused) return;
    const g = m.g; if (!g) return;
    for (const lh of m.localHumans) {
      const idx = this.input.pickIndex(code, lh.pad);
      // also allow digits 1-3 for the solo player
      if (idx < 0) continue;
      if (g.phase === 'select') {
        const ids = g.pos === lh.team ? g.opts : DEF_LIST;
        this.pickPlay(lh.id, ids[idx]);
      } else if ((g.phase === 'convChoice' || g.phase === 'kickChoice') && g.choice && g.choice.team === lh.team && idx < 2) {
        this.matchCommand(lh.id, g.phase === 'convChoice' ? { type: 'conv', pts: idx + 1 } : { type: 'kick', onside: idx === 1 });
      }
    }
    if ((code === 'Space' || code === 'Enter') && (g.phase === 'replay' || g.phase === 'cine' || g.phase === 'td')) {
      for (const lh of m.localHumans) this.matchCommand(lh.id, { type: 'skip' });
    }
  }

  // ---------------- events ----------------
  handleEvents(evs, view) {
    const demo = this.match.demo;
    for (const e of evs) {
      switch (e.type) {
        case 'turf': this.fx.turf(e.x, e.z, e.n || 4); break;
        case 'whistle': if (!demo) this.audio.whistle(false); break;
        case 'whistleShort': if (!demo) this.audio.whistle(true); break;
        case 'snap': if (!demo) this.audio.blip(220, 0.08, 'square', 0.1); break;
        case 'throw': if (!demo) this.audio.whoosh(e.long ? 1.3 : 1); this.ballLong = e.long || e.lob > 0.5; break;
        case 'catch': if (!demo) { this.audio.catchPop(); if (e.long) { this.audio.crowdSwell(0.6); this.stadium.cheer(0.7); } } this.fx.sparkle(e.x, 1.6, e.z, [2, 1.8, 0.6], 10); break;
        case 'tackle': if (!demo) this.audio.thud(1); this.fx.impact(e.x, e.z, false); this.rig.shake(0.25); break;
        case 'bigHit':
          if (!demo) { this.audio.thud(1.7); this.audio.crowdSwell(0.8); }
          this.fx.impact(e.x, e.z, true); this.rig.shake(1.2); this.r.flash = 1; this.stadium.cheer(0.9); this.jumboMsg = { big: 'BIG HIT!', color: '#ff4b2b', t: 2.5 };
          break;
        case 'thud': if (!demo) this.audio.thud(0.5); break;
        case 'stiffHit': if (!demo) this.audio.thud(1.1); this.fx.impact(e.x, e.z, false); this.rig.shake(0.4); break;
        case 'juke': case 'spin': if (!demo) this.audio.whoosh(0.8); this.fx.turf(e.x, e.z, 6); break;
        case 'dive': if (!demo) this.audio.whoosh(0.6); break;
        case 'evade': if (!demo) this.audio.whoosh(0.7); break;
        case 'block': if (!demo && Math.random() < 0.5) this.audio.thud(0.35); break;
        case 'bounce': if (!demo && e.v > 1.5) this.audio.blip(160 + Math.random() * 80, 0.05, 'triangle', 0.12); break;
        case 'swat': case 'drop': if (!demo) this.audio.thud(0.4); this.fx.sparkle(this.ballModel.group.position.x, this.ballModel.group.position.y, this.ballModel.group.position.z, [2, 2, 2], 8); break;
        case 'incomplete': if (!demo) this.audio.setCrowdBase(0.1); break;
        case 'crowd': if (!demo) this.audio.crowdSwell(e.level); this.stadium.cheer(e.level); break;
        case 'int': this.jumboMsg = { big: 'INTERCEPTED!', color: '#ff4b2b', t: 3 }; break;
        case 'fumble': this.jumboMsg = { big: 'FUMBLE!', color: '#ffd21f', t: 3 }; break;
        case 'firstDown': if (!demo) { this.audio.blip(988, 0.08, 'triangle', 0.1); setTimeout(() => this.audio.blip(1318, 0.1, 'triangle', 0.1), 90); } this.stadium.cheer(0.4); break;
        case 'td': {
          const t = this.match.teams[e.team];
          if (!demo) { this.audio.horn(); this.audio.crowdSwell(1.3); }
          this.fx.confettiBurst(view ? view.players[e.i].x : 0, view ? view.players[e.i].z : 0, [t.primary, t.secondary, t.accent, '#ffffff']);
          this.fx.fireworksShow(demo ? 3 : 9);
          this.stadium.cheer(1.2); this.stadium.startWave();
          this.r.flash = 0.7;
          this.jumboMsg = { big: 'TOUCHDOWN!', sub: `${t.city} ${t.name}`.toUpperCase(), color: t.primary, t: 5 };
          this.recorder.tdT = this.recorder.t;
          break;
        }
        case 'replay': this.startReplay(); break;
        case 'convGood': if (!demo) this.audio.crowdSwell(0.7); this.fx.fireworksShow(3); break;
        case 'safety': this.jumboMsg = { big: 'SAFETY!', color: '#ff4b2b', t: 3 }; break;
        case 'kickoff': this.rig.startSweep(demo ? 3 : 3); this.stadium.cheer(0.5); break;
        case 'onside': case 'kick': if (!demo) this.audio.thud(0.8); break;
        case 'picked': case 'cycle': case 'switch': if (!demo) this.audio.blip(1100, 0.04, 'sine', 0.06); break;
        case 'quarter': if (!demo) this.audio.horn(); break;
        case 'gameover': if (!demo) { this.audio.horn(); this.audio.crowdSwell(1); } this.fx.fireworksShow(12); this.fx.confettiBurst(0, 0, ['#ffd21f', '#ffffff', this.match.teams[e.winner].primary]); break;
        case 'spike': if (!demo) this.audio.thud(0.9); break;
      }
    }
  }

  startReplay() {
    const R = this.recorder;
    if (R.tdT == null) return;
    const t0 = R.tdT - 2.6, t1 = R.tdT + 0.5;
    const frames = R.frames.filter(f => f.t >= t0 && f.t <= t1);
    if (frames.length < 10) return;
    this.replay = { frames, t: frames[0].t, t0: frames[0].t, t1: frames[frames.length - 1].t, rate: (frames[frames.length - 1].t - frames[0].t) / (RULES.replayLen - 0.4) };
    this.rig.replayStyle = Math.floor(rand(0, 3));
    this.rig.setMode('replay');
    this.jumboMsg = { big: 'INSTANT REPLAY', color: '#7af7ff', t: RULES.replayLen };
    this.fx.trails.forEach(t => t.clear());
  }

  replayView(dt) {
    const rp = this.replay;
    rp.t = Math.min(rp.t1, rp.t + dt * rp.rate);
    const fr = rp.frames;
    let i = 0; while (i < fr.length - 2 && fr[i + 1].t < rp.t) i++;
    const a = fr[i], b = fr[Math.min(i + 1, fr.length - 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (rp.t - a.t) / (b.t - a.t))) : 0;
    const lp = (x, y) => x + (y - x) * k;
    const players = a.v.players.map((p, j) => { const q = b.v.players[j]; return { ...p, x: lp(p.x, q.x), y: lp(p.y, q.y), z: lp(p.z, q.z), facing: p.facing + Math.atan2(Math.sin(q.facing - p.facing), Math.cos(q.facing - p.facing)) * k, tPitch: lp(p.tPitch, q.tPitch), tRoll: lp(p.tRoll, q.tRoll), actT: lp(p.actT, q.actT) }; });
    const ball = { ...a.v.ball, x: lp(a.v.ball.x, b.v.ball.x), y: lp(a.v.ball.y, b.v.ball.y), z: lp(a.v.ball.z, b.v.ball.z) };
    return { players, ball, g: a.v.g };
  }

  // ---------------- main loop ----------------
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.1);
    this.frame++;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.ui.setFps(Math.round(this.fpsN / this.fpsAcc)); this.fpsAcc = 0; this.fpsN = 0; }
    try { this.tick(dt); } catch (e) { console.error(e); }
  }

  tick(dt) {
    const m = this.match;
    if (!m) return;
    m.update(dt);
    if (m.demo && m.sim.phase === 'gameover' && m.sim.phaseT > 6) { this.startDemo(); return; }
    let view = m.view();
    const g = m.g;
    const evs = m.drainEvents();
    if (view) this.handleEvents(evs, view);
    if (!view || !g) { this.stadium.update(dt); this.r.render(dt); return; }
    const slow = g.slowmo ? 0.3 : 1;
    // record for replays
    const R = this.recorder;
    R.t += dt * slow;
    if (g.phase !== 'replay') {
      R.frames.push({ t: R.t, v: view });
      while (R.frames.length && R.frames[0].t < R.t - 12) R.frames.shift();
    }
    let animDt = dt * slow;
    if (g.phase === 'replay' && this.replay) { view = this.replayView(dt); animDt = dt * this.replay.rate; }
    else if (g.phase !== 'replay') this.replay = null;
    this.applyView(view, g, animDt, dt);
    this.updateCamera(view, g, dt);
    this.updateJumbotron(g, dt);
    this.stadium.update(dt);
    this.fx.update(dt, this.r.camera.position);
    if (!m.demo) {
      const locals = m.localHumans;
      this.ui.updateHud(g, view, { teams: m.teams, locals, demo: false, myName: this.settings.name });
      if (g.phase === 'gameover' && g.phaseT > 3.2 && !this.gameOverShown) this.onGameOver(g);
    }
    this.r.desat = g.phase === 'replay' ? 0.25 : 0;
    if (this.Q.liveFeed && this.frame % 3 === 0 && view) {
      const b = view.ball;
      this.r.feedCam.position.set(b.x - 6, 2.5, b.z + 7); this.r.feedCam.lookAt(b.x, 1.2, b.z);
      this.stadium.feedScreen.visible = !this.jumboMsg && (g.phase === 'live' || g.phase === 'dead');
      if (this.stadium.feedScreen.visible) this.r.renderFeed(this.stadium);
    } else if (!this.Q.liveFeed) this.stadium.feedScreen.visible = false;
    this.r.render(dt);
  }

  applyView(v, g, animDt, dt) {
    const m = this.match;
    const editor = this.editorActive && m.demo;
    for (let i = 0; i < 6; i++) {
      const model = this.models[i];
      model.group.visible = !editor;
      model.update(v.players[i], animDt);
    }
    // showcase model for team editor
    this.showcase.group.visible = !!editor;
    if (editor) {
      const t = performance.now() / 1000;
      this.showcase.update({ x: this.showcasePos.x, y: 0, z: this.showcasePos.z, facing: Math.PI * 0.5 - 0.35 + Math.sin(t * 0.5) * 0.45, act: (Math.floor(t / 4) % 2) ? ACT.CELEB : ACT.NONE, actT: t % 4, actVar: 1, vx: 0, vz: 0, flags: 0, tPitch: 0, tRoll: 0, hasBall: false }, dt);
    }
    // ball
    const b = v.ball;
    const bp = this.tmpV;
    let holderFacing = 0;
    if (b.state === 0 && b.holder >= 0) { this.models[b.holder].getHand(bp); holderFacing = v.players[b.holder].facing; }
    else bp.set(b.x, b.y, b.z);
    this.ballModel.group.visible = !editor;
    this.ballModel.update(bp, this.tmpV2.set(b.vx, b.vy, b.vz), b.state, animDt, holderFacing);
    // shadows
    const sh = v.players.map(p => ({ x: p.x, z: p.z, y: p.y, r: 1.5 }));
    sh.push({ x: bp.x, z: bp.z, y: bp.y, r: 0.55 });
    this.fx.setShadows(editor ? [] : sh);
    // lines
    const showLines = !editor && ['select', 'presnap', 'live', 'dead'].includes(g.phase);
    this.fx.setLines(g.los, g.fdX, showLines, !g.conv && Math.abs(g.fdX) < 30.5);
    // controlled-player rings & target ring
    const locals = m.demo ? [] : m.localHumans;
    for (let k = 0; k < 2; k++) {
      const lh = locals[k];
      const hum = lh && g.humans.find(x => x.id === lh.id);
      const p = hum && hum.pIdx >= 0 ? v.players[hum.pIdx] : null;
      const vis = !!p && g.phase !== 'replay' && g.phase !== 'td' && !editor;
      this.fx.setRing(this.fx.ctrlRings[k], p || { x: 0, z: 0 }, vis, 0);
      const ar = this.fx.ctrlArrows[k];
      ar.visible = vis;
      if (vis) { ar.position.set(p.x, p.y + 2.95 + Math.sin(performance.now() / 200) * 0.08, p.z); ar.rotation.y += dt * 3; }
    }
    // target receiver ring (for local offensive human QB)
    let tgtVis = false;
    for (const lh of locals) {
      if (g.pos !== lh.team || !g.passAllowed || g.phase !== 'live') continue;
      if (b.state !== 0 || v.players[b.holder] == null || b.holder % 3 !== 0 || Math.floor(b.holder / 3) !== lh.team) continue;
      const hum = g.humans.find(x => x.id === lh.id);
      if (!hum || hum.pIdx !== b.holder) continue;
      const tp = v.players[g.target[lh.team]];
      if (tp) { this.fx.setRing(this.fx.targetRing, tp, true, 1); tgtVis = true; }
    }
    if (!tgtVis) this.fx.targetRing.visible = false;
    // landing marker: aim preview or actual pass target
    const lm = this.fx.landMarker;
    if (g.aim && locals.some(l => l.team === g.aim.team)) { lm.visible = true; lm.position.set(g.aim.x, 0.05, g.aim.z); const s = 0.8 + g.aim.lob * 0.6; lm.scale.set(s, 1, s); lm.material.color.setRGB(2, 2 - g.aim.lob, 0.4 + (1 - g.aim.lob)); }
    else if (g.bt && g.phase === 'live') { lm.visible = true; lm.position.set(g.bt[0], 0.05, g.bt[1]); lm.scale.set(1, 1, 1); lm.material.color.setRGB(2, 1.7, 0.5); lm.rotation.y += dt * 2; }
    else lm.visible = false;
    // trails
    const cam = this.r.camera.position;
    for (let i = 0; i < 6; i++) {
      const p = v.players[i];
      const t = this.fx.trail('p' + i, m.teams[i < 3 ? 0 : 1].primary, 0.28, 0.32, 1.3);
      const active = (p.flags & 1) && Math.hypot(p.vx, p.vz) > 7 && !editor;
      this.tmpV2.set(p.x, p.y + 1.1, p.z);
      t.update(dt, this.tmpV2, !!active, cam);
    }
    const bt = this.fx.trail('ball', '#ffcc55', 0.16, 0.45, 2.2);
    bt.update(dt, bp, b.state === 1 && !editor, cam);
  }

  updateCamera(v, g, dt) {
    const m = this.match;
    const b = v.ball;
    const dir = dirOf(g.ballTeam != null ? g.ballTeam : g.pos);
    const ctx = { focusX: b.x, focusZ: b.z, inAir: b.state === 1 && !!g.bt, targetX: g.bt ? g.bt[0] : b.x, dir, wide: false, editor: this.showcasePos };
    if (b.state === 0 && b.holder >= 0) { const c = v.players[b.holder]; ctx.focusX = c.x + c.vx * 0.3; ctx.focusZ = c.z; }
    if (g.phase === 'select' || g.phase === 'presnap') { ctx.focusX = g.los + dirOf(g.pos) * 5; ctx.focusZ = 0; ctx.wide = true; ctx.dir = dirOf(g.pos); }
    if (m.demo) { this.rig.update(dt, ctx); return; }
    const cel = g.celebrator >= 0 ? v.players[g.celebrator] : null;
    if (g.phase === 'td') { this.rig.setMode('celebrate'); ctx.celeb = cel; }
    else if (g.phase === 'replay' && this.replay) { this.rig.setMode('replay'); const c = this.replayFocus(v); ctx.replay = c; }
    else if (g.phase === 'gameover') {
      this.rig.setMode('gameover');
      const w = g.winner; const p = v.players[w * 3]; ctx.celeb = p;
    } else if (this.rig.mode !== 'sweep') this.rig.setMode('broadcast');
    this.rig.update(dt, ctx);
  }

  replayFocus(v) {
    const b = v.ball;
    if (b.state === 0 && b.holder >= 0) { const p = v.players[b.holder]; return { x: p.x, z: p.z, vx: p.vx, vz: p.vz }; }
    return { x: b.x, z: b.z, vx: 0, vz: 0 };
  }

  updateJumbotron(g, dt) {
    this.jumboT -= dt;
    if (this.jumboMsg) { this.jumboMsg.t -= dt; if (this.jumboMsg.t <= 0) this.jumboMsg = null; }
    if (this.jumboT > 0) return;
    this.jumboT = 0.25;
    const m = this.match;
    if (this.jumboMsg) { this.stadium.setJumbotron({ big: this.jumboMsg.big, sub: this.jumboMsg.sub, color: this.jumboMsg.color }); return; }
    const sec = Math.max(0, Math.ceil(g.clock));
    const ord = ['1ST', '2ND', '3RD', '4TH'][g.down - 1] || '';
    this.stadium.setJumbotron({
      score: g.score, period: g.ot ? 'OVERTIME' : `QUARTER ${Math.min(4, g.q)}`, clock: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`,
      line: m.demo ? 'GRIDIRON BLITZ · FRIDAY NIGHT LIGHTS' : (g.conv ? `${g.conv}-POINT TRY` : `${ord} & ${String(g.toGo).toUpperCase()}`),
    });
  }

  onGameOver(g) {
    this.gameOverShown = true;
    const m = this.match;
    const actions = [];
    let headline = '';
    if (this.matchMode === 'season') {
      const s = Season.load();
      if (s && !this.seasonRecorded) {
        s.record(g.score[0], g.score[1]);
        this.seasonRecorded = true;
        const userSide = this.matchExtra.userSide;
        headline = g.winner === userSide ? 'Victory! Season standings updated.' : 'Tough loss. Standings updated.';
        if (s.phase === 'done') headline = s.champion === s.userTeam ? '🏆 BLITZ BOWL CHAMPIONS! 🏆' : headline + ' Season complete.';
      }
      actions.push(['Season Hub', () => { this.seasonRecorded = false; this.quitMatch(); }, 'primary']);
    } else if (this.matchMode === 'online') {
      if (this.net && this.net.isHost) actions.push(['Back to Lobby', () => this.toLobby(), 'primary']);
      else actions.push(['Waiting for host…', () => {}, '']);
      actions.push(['Leave', () => this.leaveOnline(), 'ghost']);
    } else {
      actions.push(['Rematch', () => { const t = m.teams; this.disposeMatch(); this.startLocalMatchTeams(t); }, 'primary']);
      actions.push(['Main Menu', () => this.quitMatch(), 'ghost']);
    }
    this.ui.showGameOver({ teams: m.teams, score: g.score, winner: g.winner, stats: g.stats, ot: g.ot, actions, headline });
  }

  startLocalMatchTeams(teams) {
    const mode = this.matchMode;
    const humans = mode === 'local2' ? [{ id: 'p1', team: 0, name: 'P1' }, { id: 'p2', team: 1, name: 'P2' }] : [{ id: 'p1', team: 0, name: this.settings.name }];
    const localHumans = mode === 'local2' ? [{ id: 'p1', team: 0, pad: 0 }, { id: 'p2', team: 1, pad: 1 }] : [{ id: 'p1', team: 0, pad: 0 }];
    this.applyTeams(teams, mode === 'local2' ? -1 : 0);
    this.match = new LocalMatch(this, { teams, difficulty: this.settings.difficulty, mode, humans, localHumans });
    this.enterMatchUI(teams, false);
  }
}

const app = new App();
window.__gblitz = app;
app.init().catch(err => {
  console.error(err);
  const m = document.querySelector('.boot-msg');
  if (m) m.innerHTML = 'Could not start: ' + (err && err.message ? err.message : err) + '<br><small>Check your internet connection (Three.js loads from a CDN) and that WebGL is enabled.</small>';
});
void pick;
