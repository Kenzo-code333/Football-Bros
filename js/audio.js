// Fully synthesized audio (Web Audio API): crowd ambience, whistle, impacts,
// catch pop, touchdown horn and a little menu music loop.
import { storeGet, storeSet } from './config.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = storeGet('volume', { master: 0.8, music: 0.5, sfx: 0.8, crowd: 0.6 });
    this.musicOn = false;
    this.crowdLevel = 0.15;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.comp = ctx.createDynamicsCompressor(); this.comp.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.comp);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.comp);
    this.crowdBus = ctx.createGain(); this.crowdBus.connect(this.comp);
    this.applyVolume();
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
    this.startCrowd();
    if (this.musicWanted) this.startMusic();
  }

  applyVolume() {
    if (!this.ctx) return;
    const v = this.vol, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(v.music * 0.55, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(v.crowd, t, 0.05);
  }
  setVolume(k, val) { this.vol[k] = val; storeSet('volume', this.vol); this.applyVolume(); }

  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); return s; }

  startCrowd() {
    const ctx = this.ctx;
    // murmur: band-passed noise with slow modulation
    const n1 = this.noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.12;
    n1.connect(bp); bp.connect(lp); lp.connect(this.crowdGain); this.crowdGain.connect(this.crowdBus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.21; const lg = ctx.createGain(); lg.gain.value = 140;
    lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
    n1.start();
    // roar layer for swells
    const n2 = this.noiseSrc();
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 1100; bp2.Q.value = 0.4;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    n2.connect(bp2); bp2.connect(this.roarGain); this.roarGain.connect(this.crowdBus);
    n2.start();
    this.roarFilter = bp2;
  }

  crowdSwell(level = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.roarGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.5 * level, t + 0.25);
    g.setTargetAtTime(0, t + 1.2 + level * 1.5, 0.9);
    this.roarFilter.frequency.setValueAtTime(900, t); this.roarFilter.frequency.linearRampToValueAtTime(1400, t + 0.6);
    // claps
    for (let i = 0; i < 18 * level; i++) this.clap(t + 0.2 + Math.random() * 2.2, 0.05 + Math.random() * 0.05);
  }

  setCrowdBase(v) { if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); }

  clap(when, vol) {
    const ctx = this.ctx; const s = this.noiseSrc();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 1500; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    s.connect(f); f.connect(g); g.connect(this.crowdBus); s.start(when); s.stop(when + 0.08);
  }

  env(node, t, a, peak, d) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

  whistle(short = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = short ? 0.22 : 0.55;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2850;
    const trill = ctx.createOscillator(); trill.frequency.value = 38; const tg = ctx.createGain(); tg.gain.value = 120;
    trill.connect(tg); tg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02); g.gain.setValueAtTime(0.22, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const n = this.noiseSrc(); const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000; const ng = ctx.createGain(); this.env(ng, t, 0.01, 0.05, dur);
    n.connect(nf); nf.connect(ng); ng.connect(this.sfxBus);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); trill.start(t); n.start(t); o.stop(t + dur + 0.05); trill.stop(t + dur + 0.05); n.stop(t + dur + 0.05);
  }

  thud(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140 * (0.8 + Math.random() * 0.3), t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain(); this.env(g, t, 0.005, 0.7 * power, 0.3);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.4);
    const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + power * 900;
    const ng = ctx.createGain(); this.env(ng, t, 0.002, 0.5 * power, 0.12);
    n.connect(f); f.connect(ng); ng.connect(this.sfxBus); n.start(t); n.stop(t + 0.2);
    if (power > 1.2) { // crunchy pad crack
      const n2 = this.noiseSrc(); const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2400; f2.Q.value = 2;
      const g2 = ctx.createGain(); this.env(g2, t, 0.001, 0.35, 0.07); n2.connect(f2); f2.connect(g2); g2.connect(this.sfxBus); n2.start(t); n2.stop(t + 0.1);
    }
  }

  catchPop() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.08);
    const g = ctx.createGain(); this.env(g, t, 0.003, 0.5, 0.12);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.2);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 1320;
    const g2 = ctx.createGain(); this.env(g2, t + 0.04, 0.003, 0.12, 0.15); o2.connect(g2); g2.connect(this.sfxBus); o2.start(t + 0.04); o2.stop(t + 0.25);
  }

  whoosh(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2200 * power, t + 0.25);
    const g = ctx.createGain(); this.env(g, t, 0.05, 0.25 * power, 0.25);
    n.connect(f); f.connect(g); g.connect(this.sfxBus); n.start(t); n.stop(t + 0.4);
  }

  blip(freq = 880, dur = 0.07, type = 'square', vol = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); this.env(g, t, 0.004, vol, dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }

  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.08); g.gain.setValueAtTime(0.35, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    lp.connect(g); g.connect(this.sfxBus);
    for (const f of [174.6, 220, 261.6, 349.2]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp); o.start(t); o.stop(t + 2);
    }
  }

  // ---------- menu music: tiny step sequencer ----------
  startMusic() {
    this.musicWanted = true;
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.musicOn) return;
      while (this.nextNote < this.ctx.currentTime + 0.15) { this.playStep(this.step, this.nextNote); this.step++; this.nextNote += 60 / 118 / 4; }
      this.musicTimer = setTimeout(tick, 40);
    };
    tick();
  }
  stopMusic() { this.musicWanted = false; this.musicOn = false; clearTimeout(this.musicTimer); }

  playStep(s, t) {
    const ctx = this.ctx, bar = Math.floor(s / 16) % 4, st = s % 16;
    const prog = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 56]][bar];
    const m2f = m => 440 * Math.pow(2, (m - 69) / 12);
    // kick
    if (st % 4 === 0) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); const g = ctx.createGain(); this.env(g, t, 0.002, 0.55, 0.18); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.25); }
    // snare / clap
    if (st === 4 || st === 12) { const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; const g = ctx.createGain(); this.env(g, t, 0.002, 0.35, 0.12); n.connect(f); f.connect(g); g.connect(this.musicBus); n.start(t); n.stop(t + 0.18); }
    // hats
    if (st % 2 === 1) { const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); this.env(g, t, 0.001, 0.08, 0.04); n.connect(f); f.connect(g); g.connect(this.musicBus); n.start(t); n.stop(t + 0.06); }
    // bass
    if ([0, 3, 6, 10, 12, 14].includes(st)) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = m2f(prog[0] - 12 + (st === 14 ? 12 : 0)); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.15); const g = ctx.createGain(); this.env(g, t, 0.005, 0.28, 0.16); o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.22); }
    // chord stabs
    if (st === 2 || st === 7 || st === 10) for (const n of prog.slice(1)) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = m2f(n + 12); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; const g = ctx.createGain(); this.env(g, t, 0.004, 0.045, 0.14); o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.2); }
    // lead arp in later bars
    if (Math.floor(s / 64) % 2 === 1 && st % 2 === 0) { const n = prog[(st / 2) % 4] + 24; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = m2f(n); const g = ctx.createGain(); this.env(g, t, 0.003, 0.07, 0.1); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.15); }
  }
}
