// Broadcast-style camera rig: side-angle follow cam, dynamic pass zoom, cinematic sweeps,
// replay & celebration angles, menu orbit and screen shake.
import * as THREE from 'three';
import { clamp, lerp, smoothDamp } from './config.js';

const ease = t => t * t * (3 - 2 * t);

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'menu';
    this.t = 0;
    this.focus = new THREE.Vector3(0, 0, 0);
    this.pos = new THREE.Vector3(0, 20, 50);
    this.look = new THREE.Vector3();
    this.zoom = 0;
    this.fov = 40;
    this.shakeAmt = 0;
    this.sweepT = 0; this.sweepDur = 0;
    this.replayStyle = 0;
    this.tmp = new THREE.Vector3();
  }

  setMode(m) { if (this.mode !== m) { this.mode = m; this.t = 0; } }
  startSweep(dur = 3) { this.sweepT = 0; this.sweepDur = dur; this.sweepA0 = Math.random() < 0.5 ? -2.4 : -0.7; this.setMode('sweep'); }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  // ctx: {focusX, focusZ, ballY, inAir, targetX, targetZ, dir, celeb:{x,z,f}, replay:{x,z,vx,vz}, editor:Vector3}
  update(dt, ctx) {
    this.t += dt;
    const cam = this.cam;
    let pos = this.tmp.set(0, 0, 0), look = new THREE.Vector3(), fov = 40;
    const broadcast = (p, l) => {
      let fx = ctx.focusX, fz = ctx.focusZ * 0.35;
      let zoom = 0;
      if (ctx.inAir) { fx = (ctx.focusX + ctx.targetX) / 2; zoom = clamp(Math.abs(ctx.targetX - ctx.focusX) / 30, 0, 1) * 0.9 + 0.15; }
      if (ctx.wide) zoom = Math.max(zoom, 0.35);
      this.zoom = smoothDamp(this.zoom, zoom, 2.5, dt);
      this.focus.x = smoothDamp(this.focus.x, fx, ctx.inAir ? 3 : 4.5, dt);
      this.focus.z = smoothDamp(this.focus.z, fz, 3, dt);
      const dist = 26 + this.zoom * 16, height = 14.5 + this.zoom * 8;
      p.set(this.focus.x - (ctx.dir || 1) * 2, height, this.focus.z + dist);
      l.set(this.focus.x, 0.8, this.focus.z - 2);
      return 40;
    };
    switch (this.mode) {
      case 'broadcast': fov = broadcast(pos, look); break;
      case 'sweep': {
        this.sweepT += dt;
        const k = clamp(this.sweepT / this.sweepDur, 0, 1), e = ease(k);
        const a = lerp(this.sweepA0, Math.PI / 2, e);
        const r = lerp(70, 34, e);
        const bp = new THREE.Vector3(), bl = new THREE.Vector3();
        broadcast(bp, bl);
        pos.set(Math.cos(a) * r, lerp(38, 16, e), Math.sin(a) * r);
        look.set(lerp(0, bl.x, e), lerp(4, 0.8, e), 0);
        const blend = ease(clamp((k - 0.6) / 0.4, 0, 1));
        pos.lerp(bp, blend); look.lerp(bl, blend);
        fov = lerp(48, 40, e);
        if (k >= 1) this.setMode('broadcast');
        break;
      }
      case 'replay': {
        const r = ctx.replay || { x: 0, z: 0, vx: 1, vz: 0 };
        const d = ctx.dir || 1;
        if (this.replayStyle === 0) {
          // low tracking from the sideline
          const ang = -0.5 + this.t * 0.18;
          pos.set(r.x - d * 7 * Math.cos(ang), 1.9, r.z + 8 * Math.sin(ang + 1.2) + 3);
          look.set(r.x, 1.3, r.z);
          fov = 34;
        } else if (this.replayStyle === 1) {
          // end-zone camera looking back up the field
          pos.set(d * 44, 5 + Math.sin(this.t) * 0.3, r.z * 0.4);
          look.set(r.x, 1.2, r.z);
          fov = clamp(18 + Math.abs(44 * d - r.x) * 0.25, 18, 38);
        } else {
          // sky cam swoop
          const ang = this.t * 0.35;
          pos.set(r.x - d * 9 + Math.cos(ang) * 3, 9 - this.t * 1.0, r.z + 9 + Math.sin(ang) * 3);
          look.set(r.x + d * 2, 1, r.z);
          fov = 38;
        }
        break;
      }
      case 'celebrate': {
        const c = ctx.celeb || { x: 0, z: 0 };
        const d = ctx.dir || 1;
        const ang = Math.PI / 2 + Math.sin(this.t * 0.4) * 0.6 - d * 0.3;
        pos.set(c.x + Math.cos(ang) * 6.5 + d * 2, 2.4 + this.t * 0.25, c.z + Math.sin(ang) * 6.5);
        look.set(c.x, 1.4, c.z);
        fov = 36;
        break;
      }
      case 'gameover': {
        const c = ctx.celeb || { x: 0, z: 0 };
        const ang = this.t * 0.25;
        pos.set(c.x + Math.cos(ang) * 12, 5, c.z + Math.sin(ang) * 12);
        look.set(c.x, 1.2, c.z);
        fov = 40;
        break;
      }
      case 'editor': {
        const e = ctx.editor || new THREE.Vector3(0, 0, 10);
        pos.set(e.x + 4.6, 1.9, e.z + 2.2);
        look.set(e.x, 1.25, e.z - 0.3);
        fov = 34;
        break;
      }
      default: { // menu orbit
        const ang = this.t * 0.06 + 0.6;
        pos.set(Math.cos(ang) * 52, 17 + Math.sin(this.t * 0.2) * 3, Math.sin(ang) * 40 + 6);
        look.set(0, 2, 0);
        fov = 42;
      }
    }
    // smoothing (cuts on mode change are smoothed quickly)
    const k = this.mode === 'broadcast' || this.mode === 'sweep' ? 9 : this.mode === 'editor' ? 4 : 6;
    if (this.t < 0.02 && (this.mode === 'replay' || this.mode === 'celebrate' || this.mode === 'sweep')) { this.pos.copy(pos); this.look.copy(look); }
    else { this.pos.x = smoothDamp(this.pos.x, pos.x, k, dt); this.pos.y = smoothDamp(this.pos.y, pos.y, k, dt); this.pos.z = smoothDamp(this.pos.z, pos.z, k, dt);
      this.look.x = smoothDamp(this.look.x, look.x, k, dt); this.look.y = smoothDamp(this.look.y, look.y, k, dt); this.look.z = smoothDamp(this.look.z, look.z, k, dt); }
    this.fov = smoothDamp(this.fov, fov, 5, dt);
    cam.position.copy(this.pos);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.6;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s * 0.5;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
