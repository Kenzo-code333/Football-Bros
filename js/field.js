// Stadium: painted field, grass blades, stands with an instanced animated crowd,
// floodlight towers with volumetric cones, jumbotron, skyline and sky.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIELD } from './config.js';
import { drawLogo, shade } from './teams.js';
import { makeToonMaterial } from './players.js';

const FX = 44, FZ = 20; // painted area half extents

export class Stadium {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.time = 0;
    this.excite = 0;
    this.exciteTarget = 0;
    this.teams = null;
    this.buildSky();
    this.buildGround();
    this.buildStands();
    this.buildLights();
    this.buildJumbotron();
    this.buildProps();
  }

  // ---------------- sky ----------------
  buildSky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; uniform float uTime;
        void main(){
          float h = vP.y;
          vec3 top = vec3(0.012, 0.016, 0.05);
          vec3 mid = vec3(0.05, 0.04, 0.13);
          vec3 hor = vec3(0.11, 0.055, 0.12);
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h));
          c = mix(c, top, smoothstep(0.18, 0.7, h));
          // warm city glow on one side
          float glow = pow(max(0.0, 1.0 - abs(h - 0.02) * 6.0), 2.0) * (0.6 + 0.4 * vP.x);
          c += vec3(0.22, 0.09, 0.04) * glow * 0.35;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.root.add(this.sky);
    // stars
    const n = 900, pos = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = 0.12 + Math.random() * 0.85;
      const r = 380; const y = Math.sin(v * Math.PI / 2) * r; const rr = Math.cos(v * Math.PI / 2) * r;
      pos.set([Math.cos(u) * rr, y, Math.sin(u) * rr], i * 3); sz[i] = Math.random() * 2 + 0.6;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    const sm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute float size; varying float vA; uniform float uTime;
        void main(){ vA = 0.55 + 0.45 * sin(uTime * 1.5 + position.x * 0.3 + position.z); gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vec3(0.85,0.9,1.0), a * vA * 0.8); }`,
    });
    this.stars = new THREE.Points(sg, sm);
    this.root.add(this.stars);
    // skyline band
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 128;
    const x = cv.getContext('2d');
    let px = 0;
    while (px < cv.width) {
      const w = 20 + Math.random() * 60, h = 25 + Math.random() * 90;
      x.fillStyle = `rgb(${8 + Math.random() * 8},${8 + Math.random() * 8},${18 + Math.random() * 12})`;
      x.fillRect(px, 128 - h, w, h);
      for (let wy = 128 - h + 4; wy < 124; wy += 6) for (let wx = px + 3; wx < px + w - 3; wx += 5) {
        if (Math.random() < 0.28) { x.fillStyle = Math.random() < 0.7 ? 'rgba(255,210,140,0.9)' : 'rgba(160,210,255,0.9)'; x.fillRect(wx, wy, 2, 3); }
      }
      px += w + Math.random() * 6;
    }
    const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace; st.wrapS = THREE.RepeatWrapping; st.repeat.x = 3;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(260, 260, 40, 48, 1, true), new THREE.MeshBasicMaterial({ map: st, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    band.position.y = 14;
    this.root.add(band);
  }

  // ---------------- field ----------------
  buildGround() {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 160).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x0f2a16 }));
    apron.position.y = -0.02; apron.receiveShadow = true;
    this.root.add(apron);
    // running track ring
    const track = new THREE.Mesh(new THREE.RingGeometry(1, 1.0001, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    track.visible = false;
    this.fieldMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.field = new THREE.Mesh(new THREE.PlaneGeometry(FX * 2, FZ * 2).rotateX(-Math.PI / 2), this.fieldMat);
    this.field.receiveShadow = true;
    this.root.add(this.field);
    this.grass = null;
  }

  paintField(home, away) {
    const W = this.quality.fieldTex, H = Math.round(W / (FX * 2) * FZ * 2);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const ppy = W / (FX * 2);
    const X = x => (x + FX) * ppy, Z = z => (z + FZ) * ppy;
    // apron
    c.fillStyle = '#1d5a2c'; c.fillRect(0, 0, W, H);
    // mowed stripes (5 yd)
    for (let x = -FIELD.goal; x < FIELD.goal; x += 5) {
      c.fillStyle = ((x + FIELD.goal) / 5) % 2 ? '#2f8a3e' : '#38a149';
      c.fillRect(X(x), Z(-FIELD.halfWid), 5 * ppy + 1, FIELD.halfWid * 2 * ppy);
    }
    // cross-mow (subtle checker)
    c.globalAlpha = 0.06;
    for (let z = -FIELD.halfWid; z < FIELD.halfWid; z += 4) { if (((z + 16) / 4) % 2) { c.fillStyle = '#000'; c.fillRect(X(-FIELD.goal), Z(z), FIELD.goal * 2 * ppy, 4 * ppy); } }
    c.globalAlpha = 1;
    // end zones
    const ez = (x0, team, rot) => {
      c.fillStyle = shade(team.secondary, -0.15); c.fillRect(X(x0), Z(-FIELD.halfWid), 10 * ppy, FIELD.halfWid * 2 * ppy);
      c.save(); c.beginPath(); c.rect(X(x0), Z(-FIELD.halfWid), 10 * ppy, FIELD.halfWid * 2 * ppy); c.clip();
      c.strokeStyle = shade(team.secondary, 0.08); c.lineWidth = ppy * 0.9;
      for (let k = -40; k < 40; k += 2.4) { c.beginPath(); c.moveTo(X(x0 + k), Z(-FIELD.halfWid)); c.lineTo(X(x0 + k + 32), Z(FIELD.halfWid)); c.stroke(); }
      c.restore();
      c.save(); c.translate(X(x0 + 5), Z(0)); c.rotate(rot);
      c.font = `${Math.round(ppy * 5.2)}px "Russo One", Impact, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = ppy * 0.6; c.strokeStyle = team.accent; c.strokeText(team.name.toUpperCase(), 0, 0);
      c.fillStyle = team.primary; c.fillText(team.name.toUpperCase(), 0, 0);
      c.restore();
    };
    ez(-FIELD.endLine, home, -Math.PI / 2);
    ez(FIELD.goal, away, Math.PI / 2);
    // lines
    c.fillStyle = '#f4f6f2';
    const lw = Math.max(2, ppy * 0.14);
    for (let x = -FIELD.goal; x <= FIELD.goal; x += 5) c.fillRect(X(x) - lw / 2, Z(-FIELD.halfWid), lw * (x % FIELD.goal === 0 ? 2.2 : 1), FIELD.halfWid * 2 * ppy);
    c.fillRect(X(-FIELD.endLine), Z(-FIELD.halfWid) - lw * 2, FIELD.endLine * 2 * ppy, lw * 4); // far sideline
    c.fillRect(X(-FIELD.endLine), Z(FIELD.halfWid) - lw * 2, FIELD.endLine * 2 * ppy, lw * 4); // near sideline
    c.fillRect(X(-FIELD.endLine) - lw * 2, Z(-FIELD.halfWid), lw * 4, FIELD.halfWid * 2 * ppy);
    c.fillRect(X(FIELD.endLine) - lw * 2, Z(-FIELD.halfWid), lw * 4, FIELD.halfWid * 2 * ppy);
    // hash marks
    for (let x = -FIELD.goal + 1; x < FIELD.goal; x++) {
      if (x % 5 === 0) continue;
      for (const z of [-FIELD.halfWid + 0.3, -4, 4, FIELD.halfWid - 1.0]) c.fillRect(X(x) - lw / 2, Z(z), lw, ppy * 0.7);
    }
    // numbers
    c.font = `${Math.round(ppy * 2.6)}px "Russo One", Impact, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let x = -20; x <= 20; x += 10) {
      const n = String(30 - Math.abs(x));
      for (const [z, r] of [[FIELD.halfWid - 4, 0], [-FIELD.halfWid + 4, Math.PI]]) {
        c.save(); c.translate(X(x), Z(z)); c.rotate(r); c.fillStyle = '#f4f6f2'; c.fillText(n.split('').join(' '), 0, 0);
        // arrows toward nearest goal
        if (x !== 0) { const s = (x < 0 ? -1 : 1) * (r ? -1 : 1); c.beginPath(); c.moveTo(s * ppy * 2.6, -ppy * 0.5); c.lineTo(s * ppy * 3.3, 0); c.lineTo(s * ppy * 2.6, ppy * 0.5); c.fill(); }
        c.restore();
      }
    }
    // midfield logo
    const logo = drawLogo(home, 512);
    const ls = ppy * 9;
    c.globalAlpha = 0.92; c.drawImage(logo, X(0) - ls / 2, Z(0) - ls / 2, ls, ls); c.globalAlpha = 1;
    // grass noise
    const img = c.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 7;
      d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 1.2)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.6));
    }
    c.putImageData(img, 0, 0);
    if (this.fieldTex) this.fieldTex.dispose();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.fieldTex = tex;
    this.fieldMat.map = tex; this.fieldMat.needsUpdate = true;
  }

  buildGrass() {
    if (this.grass) { this.root.remove(this.grass); this.grass.geometry.dispose(); this.grass.material.dispose(); this.grass = null; }
    const N = this.quality.grass;
    if (!N) return;
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.018, 0, 0, 0.018, 0, 0, 0, 1, 0, 0, 0, -0.018, 0, 0, 0.018, 0, 1, 0]), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime; varying float vH; varying vec3 vC;
        void main(){
          vec3 p = position;
          vec4 wp = instanceMatrix * vec4(p, 1.0);
          float h = position.y;
          vH = h;
          float stripe = mod(floor((wp.x + 30.0) / 5.0), 2.0);
          bool inPlay = abs(wp.x) < 30.0 && abs(wp.z) < 16.0;
          vC = inPlay ? mix(vec3(0.045,0.36,0.07), vec3(0.06,0.48,0.1), stripe) : vec3(0.02,0.14,0.04);
          wp.x += sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.2) * 0.04 * h;
          wp.z += cos(uTime * 1.3 + wp.x * 0.2) * 0.03 * h;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `varying float vH; varying vec3 vC; void main(){ gl_FragColor = vec4(vC * (0.6 + vH * 0.75), 1.0); }`,
    });
    const mesh = new THREE.InstancedMesh(blade, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      const z = FZ - 0.5 - Math.pow(Math.random(), 1.7) * (FZ * 2 - 1);
      const x = (Math.random() * 2 - 1) * (FX - 0.5);
      p.set(x, 0, z); q.setFromAxisAngle(up, Math.random() * Math.PI); const h = 0.07 + Math.random() * 0.1; s.set(1, h, 1);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
    }
    mesh.frustumCulled = false;
    this.grass = mesh;
    this.root.add(mesh);
  }

  // ---------------- stands & crowd ----------------
  buildStands() {
    const rows = [];
    // far side (z negative), near side (z positive, lower), ends
    this.standDefs = [
      { axis: 'x', sign: -1, start: 24, len: 96, rows: 18 },
      { axis: 'x', sign: 1, start: 27, len: 96, rows: 10 },
      { axis: 'z', sign: -1, start: 50, len: 46, rows: 14 },
      { axis: 'z', sign: 1, start: 50, len: 46, rows: 14 },
    ];
    const RH = 0.85, RD = 1.3;
    const boxes = [];
    for (const sd of this.standDefs) {
      for (let r = 0; r < sd.rows; r++) {
        const h = 1.2 + r * RH, d = sd.start + r * RD + RD / 2;
        const g = new THREE.BoxGeometry(sd.axis === 'x' ? sd.len : RD, h, sd.axis === 'x' ? RD : sd.len);
        g.translate(sd.axis === 'x' ? 0 : sd.sign * d, h / 2, sd.axis === 'x' ? sd.sign * d : 0);
        g.deleteAttribute('uv');
        boxes.push(g);
      }
      // back wall
      const top = 1.2 + sd.rows * RH, back = sd.start + sd.rows * RD;
      const w = new THREE.BoxGeometry(sd.axis === 'x' ? sd.len : 1, top + 4, sd.axis === 'x' ? 1 : sd.len);
      w.translate(sd.axis === 'x' ? 0 : sd.sign * (back + 0.5), (top + 4) / 2, sd.axis === 'x' ? sd.sign * (back + 0.5) : 0);
      w.deleteAttribute('uv');
      boxes.push(w);
      // front wall (padded, team colored later)
    }
    const geo = mergeGeometries(boxes);
    this.standMat = makeToonMaterial({ color: 0x2a2d3a });
    this.stands = new THREE.Mesh(geo, this.standMat);
    this.stands.receiveShadow = true;
    this.root.add(this.stands);
    this.RH = RH; this.RD = RD;
    this.crowd = null;
  }

  buildCrowd() {
    if (this.crowd) { this.root.remove(this.crowd); this.crowd.geometry.dispose(); this.crowd.material.dispose(); this.crowd = null; }
    const N = this.quality.crowd;
    // person geometry with part ids
    const parts = [];
    const add = (g, part) => { g.deleteAttribute('uv'); const n = g.attributes.position.count; g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1)); parts.push(g); };
    add(new THREE.BoxGeometry(0.34, 0.55, 0.42).translate(0, 0.62, 0), 0);
    add(new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.07, 0), 1);
    add(new THREE.BoxGeometry(0.11, 0.48, 0.11).translate(0, 0.62, -0.27), 2);
    add(new THREE.BoxGeometry(0.11, 0.48, 0.11).translate(0, 0.62, 0.27), 3);
    const geo = mergeGeometries(parts);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uExcite: { value: 0 }, uWave: { value: -999 } },
      vertexShader: `
        attribute float aPart; attribute vec3 aColor; attribute float aPhase;
        uniform float uTime; uniform float uExcite; uniform float uWave;
        varying vec3 vColor; varying vec3 vN; varying float vPart;
        void main(){
          vec3 p = position; vec3 n = normal;
          vec4 base = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float along = base.x + base.z;
          float wave = exp(-pow((along - uWave) * 0.12, 2.0));
          float ex = clamp(uExcite * (0.55 + 0.45 * fract(aPhase * 7.13)) + wave, 0.0, 1.0);
          float cheer = 0.5 + 0.5 * sin(uTime * (6.0 + aPhase * 4.0) + aPhase * 40.0);
          if (aPart > 1.5) {
            float side = aPart > 2.5 ? 1.0 : -1.0;
            float ang = mix(0.12 + 0.08 * sin(uTime + aPhase * 9.0), 2.7 + 0.35 * sin(uTime * 9.0 + aPhase * 30.0), ex) ;
            vec3 sh = vec3(0.0, 0.84, side * 0.27);
            vec3 q = p - sh;
            float c = cos(ang * side), s = sin(ang * side);
            q = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
            p = q + sh;
            n = vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
          }
          p.y += max(0.0, sin(uTime * (7.5 + aPhase * 3.0) + aPhase * 50.0)) * ex * 0.32 * cheer + wave * 0.25;
          p.y += sin(uTime * 1.1 + aPhase * 60.0) * 0.015;
          vec4 wp = instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(instanceMatrix) * n);
          vColor = aPart > 0.5 && aPart < 1.5 ? vec3(0.85, 0.65, 0.5) * (0.6 + 0.4 * fract(aPhase * 3.7)) : aColor;
          vPart = aPart;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `varying vec3 vColor; varying vec3 vN; varying float vPart;
        void main(){
          float l = 0.42 + 0.58 * max(0.0, dot(vN, normalize(vec3(0.3, 0.8, 0.4))));
          l = l > 0.75 ? 1.0 : l > 0.5 ? 0.78 : 0.55;
          gl_FragColor = vec4(vColor * l * 0.62, 1.0);
        }`,
    });
    // seats
    const seats = [];
    for (const sd of this.standDefs) {
      for (let r = 0; r < sd.rows; r++) {
        const h = 1.2 + r * this.RH, d = sd.start + r * this.RD + this.RD * 0.45;
        for (let a = -sd.len / 2 + 1; a < sd.len / 2 - 1; a += 0.62) {
          seats.push({ x: sd.axis === 'x' ? a : sd.sign * d, y: h, z: sd.axis === 'x' ? sd.sign * d : a, rot: sd.axis === 'x' ? (sd.sign < 0 ? -Math.PI / 2 : Math.PI / 2) : (sd.sign < 0 ? 0 : Math.PI), side: sd.sign * (sd.axis === 'x' ? 1 : 2) });
        }
      }
    }
    for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    const count = Math.min(N, seats.length);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new Float32Array(count * 3), ph = new Float32Array(count);
    this.crowdSeats = [];
    for (let i = 0; i < count; i++) {
      const st = seats[i];
      p.set(st.x + (Math.random() - 0.5) * 0.15, st.y, st.z);
      q.setFromAxisAngle(up, st.rot + (Math.random() - 0.5) * 0.3);
      const sc = 0.9 + Math.random() * 0.25; s.set(sc, sc, sc);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
      ph[i] = Math.random();
      this.crowdSeats.push(st);
    }
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    mesh.frustumCulled = false;
    this.crowd = mesh;
    this.root.add(mesh);
    if (this.teams) this.colorCrowd();
  }

  colorCrowd() {
    if (!this.crowd) return;
    const [home, away] = this.teams;
    const attr = this.crowd.geometry.getAttribute('aColor');
    const c = new THREE.Color();
    const pal = (t) => [t.primary, t.primary, t.secondary, t.accent];
    for (let i = 0; i < attr.count; i++) {
      const st = this.crowdSeats[i];
      const r = Math.random();
      // home fans fill the far side & left end, away fans the right end
      let team = st.side === 2 ? (r < 0.75 ? away : home) : (r < 0.72 ? home : r < 0.9 ? away : null);
      if (team) c.set(pal(team)[Math.floor(Math.random() * 4)]);
      else c.setHSL(Math.random(), 0.25, 0.25 + Math.random() * 0.3);
      c.multiplyScalar(0.75 + Math.random() * 0.3);
      attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  // ---------------- lights ----------------
  buildLights() {
    this.hemi = new THREE.HemisphereLight(0x9fb4ff, 0x1a3020, 0.42);
    this.root.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x404660, 0.25);
    this.root.add(this.ambient);
    this.key = new THREE.DirectionalLight(0xfff3e0, 2.2);
    this.key.position.set(-30, 60, 40);
    this.key.target.position.set(0, 0, 0);
    this.root.add(this.key, this.key.target);
    const sc = this.key.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 30; sc.bottom = -30; sc.near = 10; sc.far = 160;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006; this.key.shadow.normalBias = 0.04;
    this.fill = new THREE.DirectionalLight(0xbcd0ff, 0.9);
    this.fill.position.set(40, 50, -40);
    this.root.add(this.fill);
    // towers
    const towers = [[-50, -34], [50, -34], [-50, 36], [50, 36]];
    const poles = [], heads = [], cones = [];
    const bulbsCv = document.createElement('canvas'); bulbsCv.width = 128; bulbsCv.height = 64;
    const bx = bulbsCv.getContext('2d'); bx.fillStyle = '#20232c'; bx.fillRect(0, 0, 128, 64);
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 8; xx++) {
      const g = bx.createRadialGradient(8 + xx * 16, 8 + yy * 16, 0, 8 + xx * 16, 8 + yy * 16, 7);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#fff4d0'); g.addColorStop(1, '#30302a');
      bx.fillStyle = g; bx.beginPath(); bx.arc(8 + xx * 16, 8 + yy * 16, 7, 0, 7); bx.fill();
    }
    const bulbTex = new THREE.CanvasTexture(bulbsCv); bulbTex.colorSpace = THREE.SRGBColorSpace;
    const H = 34;
    for (const [x, z] of towers) {
      const pole = new THREE.CylinderGeometry(0.5, 0.9, H, 8).translate(x, H / 2, z); pole.deleteAttribute('uv'); poles.push(pole);
      const brace = new THREE.BoxGeometry(9, 0.5, 0.5).translate(x, H - 3.3, z); brace.deleteAttribute('uv'); poles.push(brace);
      const center = new THREE.Vector3(x * 0.35, 0, z * 0.25);
      const head = new THREE.Vector3(x, H, z);
      const dir = center.clone().sub(head).normalize();
      // panel facing the field
      const panel = new THREE.PlaneGeometry(9, 4.5);
      const lookM = new THREE.Matrix4().lookAt(head, head.clone().add(dir), new THREE.Vector3(0, 1, 0));
      panel.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI)).applyMatrix4(lookM).translate(head.x, head.y, head.z);
      heads.push(panel);
      const back = new THREE.BoxGeometry(9.4, 4.9, 0.6);
      back.applyMatrix4(lookM).translate(head.x - dir.x * 0.35, head.y - dir.y * 0.35, head.z - dir.z * 0.35); back.deleteAttribute('uv'); poles.push(back);
      // volumetric cone
      const len = head.distanceTo(center) * 1.05;
      const cone = new THREE.CylinderGeometry(3.5, 20, len, 24, 1, true);
      cone.translate(0, -len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      cone.applyQuaternion(q).translate(head.x, head.y, head.z);
      const n = cone.attributes.position.count; const along = new Float32Array(n);
      const pos = cone.attributes.position;
      for (let i = 0; i < n; i++) { const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)); along[i] = v.sub(head).dot(dir) / len; }
      cone.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      cones.push(cone);
    }
    this.poles = new THREE.Mesh(mergeGeometries(poles), makeToonMaterial({ color: 0x3a3f4d }));
    this.root.add(this.poles);
    this.lampMat = new THREE.MeshBasicMaterial({ map: bulbTex, color: new THREE.Color(3.2, 3.0, 2.6), toneMapped: false, side: THREE.DoubleSide });
    this.lamps = new THREE.Mesh(mergeGeometries(heads), this.lampMat);
    this.root.add(this.lamps);
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uInt: { value: 0.11 }, uTime: { value: 0 } },
      vertexShader: `attribute float aAlong; varying float vA; varying vec3 vN; varying vec3 vV;
        void main(){ vA = aAlong; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vN; varying vec3 vV; uniform float uInt; uniform float uTime;
        void main(){
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float fade = (1.0 - smoothstep(0.0, 1.0, vA)) * smoothstep(0.0, 0.05, vA);
          float dust = 0.85 + 0.15 * sin(vA * 40.0 - uTime * 0.7);
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.82) * edge * fade * uInt * dust, 1.0);
        }`,
    });
    this.cones = new THREE.Mesh(mergeGeometries(cones), coneMat);
    this.cones.renderOrder = 5;
    this.root.add(this.cones);
    // halo sprites around lamps
    const haloCv = document.createElement('canvas'); haloCv.width = haloCv.height = 64;
    const hx = haloCv.getContext('2d'); const hg = hx.createRadialGradient(32, 32, 0, 32, 32, 32);
    hg.addColorStop(0, 'rgba(255,245,220,0.9)'); hg.addColorStop(0.3, 'rgba(255,230,180,0.35)'); hg.addColorStop(1, 'rgba(255,220,160,0)');
    hx.fillStyle = hg; hx.fillRect(0, 0, 64, 64);
    const haloTex = new THREE.CanvasTexture(haloCv);
    for (const [x, z] of towers) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.position.set(x * 0.98, H, z * 0.98); sp.scale.set(22, 22, 1);
      this.root.add(sp);
    }
  }

  // ---------------- jumbotron ----------------
  buildJumbotron() {
    const W = 26, H = 12;
    const frame = new THREE.BoxGeometry(W + 1.6, H + 1.6, 1.2).translate(0, 0, -0.7);
    const legs = [new THREE.BoxGeometry(1.2, 22, 1.2).translate(-W / 3, -H / 2 - 11, -0.7), new THREE.BoxGeometry(1.2, 22, 1.2).translate(W / 3, -H / 2 - 11, -0.7)];
    const geo = mergeGeometries([frame, ...legs]);
    const fm = new THREE.Mesh(geo, makeToonMaterial({ color: 0x1b1d26 }));
    this.jumboCanvas = document.createElement('canvas'); this.jumboCanvas.width = 1024; this.jumboCanvas.height = 472;
    this.jumboTex = new THREE.CanvasTexture(this.jumboCanvas); this.jumboTex.colorSpace = THREE.SRGBColorSpace;
    this.jumboMat = new THREE.MeshBasicMaterial({ map: this.jumboTex, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
    this.jumboScreen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.jumboMat);
    // live feed overlay
    this.feedMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.feedScreen = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, H * 0.62), this.feedMat);
    this.feedScreen.position.set(0, -H * 0.12, 0.05);
    this.feedScreen.visible = false;
    this.jumbo = new THREE.Group();
    this.jumbo.add(fm, this.jumboScreen, this.feedScreen);
    this.jumbo.position.set(0, 30, -52);
    this.root.add(this.jumbo);
    this.jumboInfo = null;
    this.jumboDirty = true;
  }

  setJumbotron(info) {
    const key = JSON.stringify(info);
    if (key === this.jumboKey) return;
    this.jumboKey = key;
    const c = this.jumboCanvas.getContext('2d');
    const W = this.jumboCanvas.width, H = this.jumboCanvas.height;
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0d1e'); g.addColorStop(1, '#171032');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // LED dot texture
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (info.big) {
      c.font = '120px "Russo One", Impact, sans-serif';
      c.fillStyle = info.color || '#ffd21f'; c.shadowColor = info.color || '#ffd21f'; c.shadowBlur = 30;
      c.fillText(info.big, W / 2, H * 0.42);
      c.shadowBlur = 0;
      if (info.sub) { c.font = '52px "Russo One", Impact, sans-serif'; c.fillStyle = '#ffffff'; c.fillText(info.sub, W / 2, H * 0.72); }
    } else if (this.teams) {
      const [a, b] = this.teams;
      const s = info.score || [0, 0];
      for (const [k, t, x] of [[0, a, W * 0.25], [1, b, W * 0.75]]) {
        c.drawImage(drawLogo(t, 256), x - 85, 26, 170, 170);
        c.font = '44px "Russo One", Impact, sans-serif'; c.fillStyle = '#ffffff'; c.fillText(t.name.toUpperCase(), x, 228);
        c.font = '150px "Russo One", Impact, sans-serif'; c.fillStyle = t.primary; c.fillText(String(s[k]), x, 340);
      }
      c.font = '46px "Russo One", Impact, sans-serif'; c.fillStyle = '#ffd21f'; c.fillText(info.period || '', W / 2, 120);
      c.font = '84px "Russo One", Impact, sans-serif'; c.fillStyle = '#ffffff'; c.fillText(info.clock || '', W / 2, 210);
      if (info.line) { c.font = '38px "Barlow Condensed", sans-serif'; c.fillStyle = '#9fd3ff'; c.fillText(info.line, W / 2, 420); }
    }
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1.5);
    this.jumboTex.needsUpdate = true;
  }

  // ---------------- props ----------------
  buildProps() {
    const parts = [];
    // goal posts at end lines
    for (const s of [-1, 1]) {
      const x = s * (FIELD.endLine + 0.5);
      parts.push(new THREE.CylinderGeometry(0.15, 0.15, 3.4, 8).translate(x + s * 1, 1.7, 0));
      parts.push(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8).rotateZ(Math.PI / 2).translate(x + s * 0.4, 3.4, 0));
      parts.push(new THREE.CylinderGeometry(0.1, 0.1, 6.2, 8).rotateX(Math.PI / 2).translate(x, 3.4, 0));
      for (const t of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.09, 0.09, 7, 8).translate(x, 6.9, t * 3.1));
    }
    parts.forEach(p => p.deleteAttribute('uv'));
    this.posts = new THREE.Mesh(mergeGeometries(parts), makeToonMaterial({ color: 0xffd21f, emissive: 0x332800 }));
    this.root.add(this.posts);
    // pylons
    const py = [];
    for (const sx of [-1, 1]) for (const gx of [FIELD.goal, FIELD.endLine]) for (const sz of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.3, 0.9, 0.3).translate(sx * gx, 0.45, sz * (FIELD.halfWid + 0.2)); g.deleteAttribute('uv'); py.push(g);
    }
    this.pylons = new THREE.Mesh(mergeGeometries(py), makeToonMaterial({ color: 0xff6a00, emissive: 0x401800 }));
    this.root.add(this.pylons);
    // LED ad boards
    this.adCanvas = document.createElement('canvas'); this.adCanvas.width = 2048; this.adCanvas.height = 64;
    this.adTex = new THREE.CanvasTexture(this.adCanvas); this.adTex.colorSpace = THREE.SRGBColorSpace; this.adTex.wrapS = THREE.RepeatWrapping;
    const adMat = new THREE.MeshBasicMaterial({ map: this.adTex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    const ads = [];
    ads.push(new THREE.PlaneGeometry(92, 1.3).translate(0, 0.65, -23.5));
    const near = new THREE.PlaneGeometry(92, 1.3).rotateY(Math.PI).translate(0, 0.65, 26.5); ads.push(near);
    for (const s of [-1, 1]) ads.push(new THREE.PlaneGeometry(44, 1.3).rotateY(-s * Math.PI / 2).translate(s * 49.5, 0.65, 0));
    this.ads = new THREE.Mesh(mergeGeometries(ads), adMat);
    this.ads.material.map.repeat.x = 2;
    this.root.add(this.ads);
    // benches
    const bench = [];
    for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(14, 0.6, 1.2).translate(s * 14, 0.3, -21); g.deleteAttribute('uv'); bench.push(g); }
    this.benches = new THREE.Mesh(mergeGeometries(bench), makeToonMaterial({ color: 0x3c4152 }));
    this.root.add(this.benches);
  }

  paintAds() {
    const c = this.adCanvas.getContext('2d'), W = 2048, H = 64;
    c.fillStyle = '#05060c'; c.fillRect(0, 0, W, H);
    const items = ['GRIDIRON BLITZ', '★', this.teams[0].city.toUpperCase() + ' ' + this.teams[0].name.toUpperCase(), '★', 'FRIDAY NIGHT LIGHTS', '★', this.teams[1].city.toUpperCase() + ' ' + this.teams[1].name.toUpperCase(), '★'];
    c.font = '40px "Russo One", Impact, sans-serif'; c.textBaseline = 'middle';
    let x = 20; let k = 0;
    while (x < W) {
      const t = items[k % items.length];
      c.fillStyle = k % 4 === 2 ? this.teams[0].primary : k % 4 === 0 ? '#ffd21f' : k % 8 === 6 ? this.teams[1].primary : '#7af7ff';
      if (t !== '★' && k % 8 === 6) c.fillStyle = this.teams[1].primary;
      c.fillText(t, x, H / 2 + 2);
      x += c.measureText(t).width + 40; k++;
    }
    this.adTex.needsUpdate = true;
  }

  setTeams(home, away) {
    this.teams = [home, away];
    this.paintField(home, away);
    this.colorCrowd();
    this.paintAds();
    this.jumboKey = null;
  }

  setQuality(q) {
    const prev = this._appliedQ;
    this._appliedQ = q;
    this.quality = q;
    if (!prev || prev.fieldTex !== q.fieldTex) { if (this.teams) this.paintField(this.teams[0], this.teams[1]); }
    if (!prev || prev.crowd !== q.crowd) this.buildCrowd();
    if (!prev || prev.grass !== q.grass) this.buildGrass();
    this.key.castShadow = !!q.shadows;
    this.cones.visible = q.cones;
  }

  cheer(level) { this.exciteTarget = Math.max(this.exciteTarget, level); }
  startWave() { this.wave = -120; }

  update(dt) {
    this.time += dt;
    this.exciteTarget = Math.max(0, this.exciteTarget - dt * 0.28);
    this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 3);
    if (this.wave != null) { this.wave += dt * 60; if (this.wave > 140) this.wave = null; }
    if (this.crowd) { const u = this.crowd.material.uniforms; u.uTime.value = this.time; u.uExcite.value = Math.min(1, this.excite + 0.08); u.uWave.value = this.wave == null ? -999 : this.wave; }
    if (this.grass) this.grass.material.uniforms.uTime.value = this.time;
    this.stars.material.uniforms.uTime.value = this.time;
    this.cones.material.uniforms.uTime.value = this.time;
    this.adTex.offset.x = (this.time * 0.02) % 1;
    const flick = 1 + this.excite * 0.25 * (0.5 + 0.5 * Math.sin(this.time * 20));
    this.lampMat.color.setRGB(3.2 * flick, 3.0 * flick, 2.6 * flick);
  }
}
