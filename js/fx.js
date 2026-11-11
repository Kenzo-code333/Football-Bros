// Juice: particles (turf, dust, sparks, fireworks), confetti, ribbon trails,
// on-field markers (scrimmage / first-down lines, rings, landing marker) and blob shadows.
import * as THREE from 'three';
import { rand } from './config.js';

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

class ParticlePool {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.grow = new Float32Array(max); this.baseSize = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.15, r) * vA; gl_FragColor = vec4(vC, a); }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 9, drag = 0.5, grow = 0) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.baseSize[i] = size; this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
    this.alpha[i] = 1;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; this.alpha[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.5; this.vel[i * 3 + 2] *= 0.5; }
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.5);
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - t));
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}

export class Trail {
  constructor(color, width = 0.35, life = 0.35, maxPts = 28, intensity = 1.6) {
    this.pts = []; this.life = life; this.width = width; this.maxPts = maxPts;
    this.active = false;
    const n = maxPts * 2;
    this.positions = new Float32Array(n * 3); this.alphas = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.time = 0;
  }
  setColor(c, intensity = 1.6) { this.mat.uniforms.uColor.value.set(c).multiplyScalar(intensity); }
  update(dt, pos, active, camPos) {
    this.time += dt;
    if (active) {
      const last = this.pts[this.pts.length - 1];
      if (!last || last.p.distanceToSquared(pos) > 0.04) this.pts.push({ p: pos.clone(), t: this.time });
      if (this.pts.length > this.maxPts) this.pts.shift();
    }
    while (this.pts.length && this.time - this.pts[0].t > this.life) this.pts.shift();
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < this.maxPts; i++) {
      const k = Math.min(i, n - 1);
      const p = this.pts[k].p;
      const pn = this.pts[Math.min(k + 1, n - 1)].p, pp = this.pts[Math.max(k - 1, 0)].p;
      tmpV.subVectors(pn, pp).normalize();
      tmpV2.subVectors(camPos, p).normalize();
      tmpV3.crossVectors(tmpV, tmpV2).normalize();
      const age = (this.time - this.pts[k].t) / this.life;
      const w = this.width * (1 - age) * (k / Math.max(1, n - 1) * 0.8 + 0.2);
      const a = i < n ? Math.max(0, 1 - age) * (k / Math.max(1, n - 1)) : 0;
      this.positions.set([p.x + tmpV3.x * w, p.y + tmpV3.y * w, p.z + tmpV3.z * w], i * 6);
      this.positions.set([p.x - tmpV3.x * w, p.y - tmpV3.y * w, p.z - tmpV3.z * w], i * 6 + 3);
      this.alphas[i * 2] = a; this.alphas[i * 2 + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
  clear() { this.pts = []; this.mesh.visible = false; }
}

function radialTex(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function ringTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 10; x.beginPath(); x.arc(64, 64, 52, 0, 7); x.stroke();
  x.lineWidth = 3; x.globalAlpha = 0.6; x.beginPath(); x.arc(64, 64, 38, 0, 7); x.stroke();
  return new THREE.CanvasTexture(c);
}
function targetTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 8;
  for (const r of [56, 34, 12]) { x.beginPath(); x.arc(64, 64, r, 0, 7); x.stroke(); }
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(scene, quality) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.setQuality(quality);
    this.time = 0;
    // confetti
    const CN = 700;
    const cg = new THREE.PlaneGeometry(0.16, 0.24);
    this.confetti = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CN);
    this.confetti.frustumCulled = false;
    this.confData = [];
    const col = new THREE.Color();
    for (let i = 0; i < CN; i++) { this.confData.push({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }); this.confetti.setColorAt(i, col.setHSL(Math.random(), 0.9, 0.6)); }
    this.confetti.count = CN;
    this.group.add(this.confetti);
    this.confActive = 0;
    // shadows
    this.shadowTex = radialTex();
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }), 8);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 1;
    this.group.add(this.shadows);
    // lines
    const lineGeo = new THREE.PlaneGeometry(0.22, 32).rotateX(-Math.PI / 2);
    this.losLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.6, 1.8), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.fdLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.7, 0.2), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    this.losLine.position.y = this.fdLine.position.y = 0.03;
    this.losLine.renderOrder = this.fdLine.renderOrder = 2;
    this.group.add(this.losLine, this.fdLine);
    // rings
    const rt = ringTex();
    const mkRing = (c, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: rt, color: c, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })); m.renderOrder = 3; m.visible = false; this.group.add(m); return m; };
    this.ctrlRings = [mkRing(new THREE.Color(0.3, 1.6, 2.0), 1.9), mkRing(new THREE.Color(2.0, 0.9, 0.2), 1.9)];
    this.targetRing = mkRing(new THREE.Color(2.0, 1.8, 0.3), 2.3);
    this.landMarker = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: targetTex(), color: new THREE.Color(2, 2, 2), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    this.landMarker.renderOrder = 3; this.landMarker.visible = false;
    this.group.add(this.landMarker);
    // floating arrows above controlled players
    const arrowGeo = new THREE.ConeGeometry(0.22, 0.42, 4).rotateX(Math.PI);
    this.ctrlArrows = [0, 1].map(k => { const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: k ? new THREE.Color(2, 0.9, 0.2) : new THREE.Color(0.3, 1.6, 2), toneMapped: false })); m.visible = false; this.group.add(m); return m; });
    this.trails = new Map();
    this.flash = 0;
  }

  setQuality(q) {
    if (this.pool) { this.group.remove(this.pool.points, this.glow.points); }
    this.pool = new ParticlePool(q.particles, false);
    this.glow = new ParticlePool(Math.round(q.particles * 0.9), true);
    this.group.add(this.pool.points, this.glow.points);
    this.quality = q;
  }

  turf(x, z, n = 6, power = 1) {
    for (let i = 0; i < n; i++) {
      const g = Math.random() < 0.6;
      this.pool.spawn(x + rand(-0.3, 0.3), 0.08, z + rand(-0.3, 0.3), rand(-2, 2) * power, rand(1.5, 4.5) * power, rand(-2, 2) * power,
        g ? 0.18 : 0.33, g ? 0.45 : 0.24, g ? 0.15 : 0.12, rand(0.07, 0.13), rand(0.5, 0.9), 12, 1.2);
    }
    for (let i = 0; i < Math.ceil(n / 3); i++) this.pool.spawn(x, 0.2, z, rand(-1, 1), rand(0.3, 1), rand(-1, 1), 0.55, 0.6, 0.45, 0.5, rand(0.6, 1.0), -0.3, 2, 2.5);
  }
  impact(x, z, big) {
    this.turf(x, z, big ? 26 : 10, big ? 1.6 : 1);
    if (big) for (let i = 0; i < 26; i++) { const a = rand(0, 6.28), s = rand(4, 9); this.glow.spawn(x, 1.2, z, Math.cos(a) * s, rand(1, 6), Math.sin(a) * s, 2.0, 1.6, 0.7, rand(0.1, 0.18), rand(0.25, 0.5), 6, 2); }
  }
  sparkle(x, y, z, color = [2, 1.8, 0.6], n = 12) {
    for (let i = 0; i < n; i++) { const a = rand(0, 6.28), s = rand(1, 3.5); this.glow.spawn(x, y, z, Math.cos(a) * s, rand(0.5, 3), Math.sin(a) * s, color[0], color[1], color[2], rand(0.08, 0.15), rand(0.3, 0.6), 3, 2); }
  }
  firework(x, y, z, hue) {
    const c = new THREE.Color().setHSL(hue ?? Math.random(), 1, 0.6);
    const n = 70;
    for (let i = 0; i < n; i++) {
      const u = rand(-1, 1), th = rand(0, 6.28), s = rand(9, 13), r = Math.sqrt(1 - u * u);
      this.glow.spawn(x, y, z, r * Math.cos(th) * s, u * s, r * Math.sin(th) * s, c.r * 2.5, c.g * 2.5, c.b * 2.5, rand(0.35, 0.6), rand(1.0, 1.6), 5, 1.4);
    }
    this.glow.spawn(x, y, z, 0, 0, 0, 3, 3, 3, 4, 0.25, 0, 0, 1);
  }
  fireworksShow(count = 6) {
    for (let k = 0; k < count; k++) setTimeout(() => this.firework(rand(-40, 40), rand(26, 40), rand(-45, -30)), k * 280 + Math.random() * 200);
  }
  confettiBurst(x, z, colors) {
    const col = new THREE.Color();
    for (let i = 0; i < this.confData.length; i++) {
      const d = this.confData[i];
      d.p.set(x + rand(-8, 8), rand(10, 18), z + rand(-8, 8));
      d.v.set(rand(-3, 3), rand(-1, 3), rand(-3, 3));
      d.r.set(rand(0, 6), rand(0, 6), rand(0, 6)); d.w.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      d.life = rand(4, 7);
      this.confetti.setColorAt(i, col.set(colors[i % colors.length]).multiplyScalar(1.3));
    }
    this.confetti.instanceColor.needsUpdate = true;
    this.confActive = 7;
  }

  trail(key, color, width, life, intensity) {
    let t = this.trails.get(key);
    if (!t) { t = new Trail(color, width, life, 28, intensity); this.trails.set(key, t); this.group.add(t.mesh); }
    return t;
  }

  update(dt, camPos) {
    this.time += dt;
    this.pool.update(dt); this.glow.update(dt);
    if (this.confActive > 0) {
      this.confActive -= dt;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < this.confData.length; i++) {
        const d = this.confData[i];
        if (d.life <= 0) { m.makeTranslation(0, -100, 0); this.confetti.setMatrixAt(i, m); continue; }
        d.life -= dt;
        d.v.y = Math.max(d.v.y - 6 * dt, -1.6);
        d.v.x += Math.sin(this.time * 3 + i) * dt * 2; d.v.z += Math.cos(this.time * 2.6 + i * 1.3) * dt * 2;
        d.v.x *= 1 - dt * 0.8; d.v.z *= 1 - dt * 0.8;
        d.p.addScaledVector(d.v, dt);
        if (d.p.y < 0.03) { d.p.y = 0.03; d.v.set(0, 0, 0); d.w.multiplyScalar(0.9); }
        d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
        q.setFromEuler(d.r); m.compose(d.p, q, s); this.confetti.setMatrixAt(i, m);
      }
      this.confetti.instanceMatrix.needsUpdate = true;
      this.confetti.visible = true;
    } else this.confetti.visible = false;
    void camPos;
  }

  setShadows(list) {
    const m = new THREE.Matrix4();
    let i = 0;
    for (const s of list) {
      const sc = s.r * Math.max(0.3, 1 - s.y * 0.25);
      m.makeScale(sc, 1, sc); m.setPosition(s.x, 0.025, s.z);
      this.shadows.setMatrixAt(i++, m);
    }
    for (; i < 8; i++) { m.makeTranslation(0, -100, 0); this.shadows.setMatrixAt(i, m); }
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  setLines(losX, fdX, visible, showFd) {
    this.losLine.visible = visible; this.fdLine.visible = visible && showFd;
    this.losLine.position.x = losX; this.fdLine.position.x = fdX;
  }

  setRing(ring, pos, visible, pulse = 0) {
    ring.visible = visible;
    if (!visible) return;
    ring.position.set(pos.x, 0.04, pos.z);
    const s = 1 + Math.sin(this.time * 6) * 0.08 * pulse;
    ring.scale.set(s, 1, s);
  }
}
