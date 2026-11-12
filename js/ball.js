// The football: toon model, orientation and trail hooks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeToonMaterial, makeOutlineMaterial } from './players.js';

export class BallModel {
  constructor() {
    const body = new THREE.SphereGeometry(1, 20, 12);
    body.scale(0.2, 0.125, 0.125);
    const colorize = (g, hex) => {
      const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
    };
    colorize(body, '#7a3b17');
    const parts = [body];
    // white stripes near the tips
    for (const s of [-1, 1]) {
      const ring = new THREE.CylinderGeometry(0.098, 0.098, 0.022, 14, 1, true).rotateZ(Math.PI / 2).translate(s * 0.125, 0, 0);
      parts.push(colorize(ring, '#f4efe6'));
    }
    const laces = new THREE.BoxGeometry(0.16, 0.022, 0.03).translate(0, 0.122, 0);
    parts.push(colorize(laces, '#ffffff'));
    for (let k = -2; k <= 2; k++) parts.push(colorize(new THREE.BoxGeometry(0.012, 0.02, 0.06).translate(k * 0.03, 0.126, 0), '#ffffff'));
    const nonIdx = parts.map(g => g.index ? g.toNonIndexed() : g);
    const geo = mergeGeometries(nonIdx);
    this.mesh = new THREE.Mesh(geo, makeToonMaterial({ vertexColors: true }));
    this.mesh.castShadow = true;
    this.outline = new THREE.Mesh(geo, makeOutlineMaterial(0.018));
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.outline);
    this.spin = 0;
    this.tumble = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._x = new THREE.Vector3(1, 0, 0);
  }

  // state: 0 held, 1 air, 2 loose, 3 dead
  update(pos, vel, state, dt, holderFacing) {
    this.group.position.copy(pos);
    if (state === 1 && vel.lengthSq() > 1) {
      // nose follows velocity, spiral spin
      this.spin += dt * 24;
      this._v.copy(vel).normalize();
      this._q.setFromUnitVectors(this._x, this._v);
      this.group.quaternion.copy(this._q);
      this.mesh.rotation.x = this.spin; this.outline.rotation.x = this.spin;
    } else if (state === 2 || state === 3) {
      const sp = vel.length();
      this.tumble.x += dt * sp * 2.2; this.tumble.y += dt * sp * 1.3; this.tumble.z += dt * sp * 0.7;
      if (pos.y < 0.2 && sp < 0.5) { this.tumble.z = this.tumble.z * 0.9; this.tumble.x = 0; }
      this.group.rotation.copy(this.tumble);
      this.mesh.rotation.x = 0; this.outline.rotation.x = 0;
    } else {
      this.group.rotation.set(0, -(holderFacing || 0), 0.5);
      this.mesh.rotation.x = 0; this.outline.rotation.x = 0;
    }
  }
}
