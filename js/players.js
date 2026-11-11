// Chunky toy-like football players: procedurally built, rigidly skinned to a small
// bone rig (1 draw call + 1 outline per player), toon shaded, procedurally animated.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ACT } from './sim.js';
import { clamp, lerp } from './config.js';
import { drawLogo, rosterNumbers } from './teams.js';

let gradientMap = null;
export function toonGradient() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([70, 140, 205, 255]);
  gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

// Toon material with a soft cool rim light for that "pop" against the night.
export function makeToonMaterial(opts = {}) {
  const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
       outgoingLight += vec3(0.32, 0.38, 0.55) * rimF * 0.55;
       #include <opaque_fragment>`);
  };
  return m;
}

let outlineMat = null;
export function makeOutlineMaterial(width = 0.03) {
  const m = new THREE.MeshBasicMaterial({ color: 0x07070c, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.outlineW = { value: width };
    sh.vertexShader = 'uniform float outlineW;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      'vec3 transformed = vec3(position) + normalize(normal) * outlineW;');
  };
  return m;
}

// bone indices
const B = { root: 0, hips: 1, chest: 2, head: 3, shL: 4, elL: 5, shR: 6, elR: 7, thL: 8, knL: 9, thR: 10, knR: 11 };
const BONE_POS = [
  [0, 0, 0], [0, 0.95, 0], [0, 1.22, 0], [0, 1.62, 0],
  [0, 1.5, -0.42], [0, 1.17, -0.43], [0, 1.5, 0.42], [0, 1.17, 0.43],
  [0, 0.9, -0.17], [0, 0.48, -0.17], [0, 0.9, 0.17], [0, 0.48, 0.17],
];
const BONE_PARENT = [-1, 0, 1, 2, 2, 4, 2, 6, 1, 8, 1, 10];
const NB = BONE_POS.length;

const SKIN_TONES = ['#f1c9a5', '#d9a47c', '#b07850', '#8a5a3b', '#5f3b26', '#e8b996'];

function part(geo, bone, color, pos, rot, scale) {
  const g = geo.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0])));
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...(scale || [1, 1, 1])));
  g.applyMatrix4(m);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

const G = {};
function geos() {
  if (G.sphere) return G;
  G.sphere = new THREE.SphereGeometry(1, 16, 12);
  G.sphereLo = new THREE.SphereGeometry(1, 10, 8);
  G.capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
  G.box = new THREE.BoxGeometry(1, 1, 1);
  G.cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  G.cone = new THREE.ConeGeometry(1, 1, 10);
  return G;
}

export function buildPlayerGeometry(team, opts = {}) {
  const g = geos();
  const P = team.primary, S = team.secondary, A = team.accent;
  const skin = opts.skin || SKIN_TONES[0];
  const jersey = team.jersey || 'solid';
  const helmetCol = opts.helmetColor || S;
  const pants = A;
  const parts = [];
  const torsoCol = P;
  const padCol = jersey === 'split' ? S : P;
  const sleeveCol = jersey === 'sleeves' ? A : P;
  // torso & pads
  parts.push(part(g.capsule(0.3, 0.32), B.chest, torsoCol, [0, 1.27, 0], null, [0.85, 1, 1.18]));
  if (jersey === 'stripes') parts.push(part(g.cyl, B.chest, A, [0, 1.2, 0], null, [0.265, 0.1, 0.36]));
  if (jersey === 'split') parts.push(part(g.cyl, B.chest, A, [0, 1.42, 0], null, [0.262, 0.04, 0.356]));
  parts.push(part(g.sphere, B.chest, padCol, [0, 1.56, 0], null, [0.33, 0.19, 0.55]));
  parts.push(part(g.cyl, B.head, skin, [0, 1.68, 0], null, [0.1, 0.16, 0.1]));
  // pelvis
  parts.push(part(g.capsule(0.26, 0.1), B.hips, pants, [0, 0.93, 0], null, [0.86, 1, 1.25]));
  parts.push(part(g.cyl, B.hips, S, [0, 1.06, 0], null, [0.235, 0.05, 0.33]));
  // head: big toy helmet
  parts.push(part(g.sphere, B.head, helmetCol, [0.02, 1.96, 0], null, [0.42, 0.41, 0.4]));
  parts.push(part(g.sphere, B.head, skin, [0.2, 1.86, 0], null, [0.27, 0.25, 0.25]));
  // eyes
  for (const s of [-1, 1]) {
    parts.push(part(g.sphereLo, B.head, '#ffffff', [0.43, 1.92, s * 0.095], null, [0.035, 0.07, 0.055]));
    parts.push(part(g.sphereLo, B.head, '#101018', [0.455, 1.915, s * 0.095], null, [0.025, 0.05, 0.035]));
  }
  // facemask bars
  const mask = '#d8dbe0';
  parts.push(part(g.cyl, B.head, mask, [0.47, 1.8, 0], [Math.PI / 2, 0, 0], [0.022, 0.46, 0.022]));
  parts.push(part(g.cyl, B.head, mask, [0.45, 1.73, 0], [Math.PI / 2, 0, 0], [0.022, 0.38, 0.022]));
  parts.push(part(g.cyl, B.head, mask, [0.475, 1.79, 0], [0, 0, 0.18], [0.02, 0.17, 0.02]));
  for (const s of [-1, 1]) parts.push(part(g.cyl, B.head, mask, [0.36, 1.82, s * 0.27], [0.3 * s, 0, 1.1], [0.02, 0.25, 0.02]));
  // helmet designs
  const hd = team.helmet || 'stripe';
  if (hd === 'stripe') parts.push(part(g.box, B.head, A, [0.0, 2.02, 0], [0, 0, 0], [0.82, 0.74, 0.07]));
  if (hd === 'double') for (const s of [-1, 1]) parts.push(part(g.box, B.head, P, [0.0, 2.02, s * 0.08], null, [0.82, 0.73, 0.04]));
  if (hd === 'horns') for (const s of [-1, 1]) parts.push(part(g.cone, B.head, A, [0.0, 2.25, s * 0.36], [s * 0.7, 0, 0], [0.09, 0.32, 0.09]));
  if (hd === 'mohawk') for (let k = 0; k < 5; k++) parts.push(part(g.cone, B.head, P, [0.22 - k * 0.12, 2.35 - Math.abs(k - 1.5) * 0.04, 0], [0, 0, 0.3 - k * 0.12], [0.06, 0.2, 0.05]));
  // arms
  for (const [sh, el, s] of [[B.shL, B.elL, -1], [B.shR, B.elR, 1]]) {
    parts.push(part(g.capsule(0.125, 0.18), sh, sleeveCol, [0, 1.36, s * 0.44]));
    parts.push(part(g.capsule(0.105, 0.17), el, skin, [0, 1.04, s * 0.44]));
    parts.push(part(g.sphere, el, S, [0.02, 0.88, s * 0.44], null, [0.115, 0.12, 0.1]));
  }
  // legs
  for (const [th, kn, s] of [[B.thL, B.knL, -1], [B.thR, B.knR, 1]]) {
    parts.push(part(g.capsule(0.16, 0.22), th, pants, [0, 0.7, s * 0.17]));
    parts.push(part(g.capsule(0.13, 0.22), kn, S, [0, 0.3, s * 0.17]));
    parts.push(part(g.sphere, kn, '#1a1a22', [0.07, 0.08, s * 0.17], null, [0.2, 0.09, 0.115]));
    parts.push(part(g.box, kn, '#f2f2f2', [0.1, 0.1, s * 0.17], null, [0.18, 0.025, 0.2]));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  merged.computeBoundingSphere();
  return merged;
}

function numberTexture(num, team) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.font = 'bold 92px "Russo One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 12; x.strokeStyle = team.secondary; x.strokeText(String(num), 64, 70);
  x.fillStyle = team.accent; x.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

let sharedToon = null, sharedOutline = null;

export class PlayerModel {
  constructor(team, idx, opts = {}) {
    this.idx = idx;
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.offset = new THREE.Group();
    this.offset.position.y = -0.95;
    this.tilt.position.y = 0.95;
    this.group.add(this.tilt); this.tilt.add(this.offset);
    // bones
    this.bones = [];
    for (let i = 0; i < NB; i++) {
      const b = new THREE.Bone();
      const p = BONE_POS[i], pp = BONE_PARENT[i] >= 0 ? BONE_POS[BONE_PARENT[i]] : [0, 0, 0];
      b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      this.bones.push(b);
      if (BONE_PARENT[i] >= 0) this.bones[BONE_PARENT[i]].add(b);
    }
    this.offset.add(this.bones[0]);
    if (!sharedToon) { sharedToon = makeToonMaterial({ vertexColors: true }); sharedOutline = makeOutlineMaterial(0.032); }
    this.skin = opts.skin || SKIN_TONES[(idx * 7 + (team.index || 0) * 3) % SKIN_TONES.length];
    this.team = team;
    this.outlines = opts.outlines !== false;
    this.decals = opts.decals !== false;
    this.number = opts.number || rosterNumbers(team)[idx % 3];
    this.buildMesh();
    this.pose = new Float32Array(NB * 3);
    this.target = new Float32Array(NB * 3);
    this.tiltCur = { p: 0, r: 0, h: 0.95, y: 0, yaw: 0 };
    this.phase = Math.random() * 6;
    this.time = Math.random() * 10;
    this.handPos = new THREE.Vector3();
  }

  buildMesh() {
    if (this.mesh) { this.offset.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.outline) this.offset.remove(this.outline);
    if (this.decalMeshes) this.decalMeshes.forEach(m => { m.parent && m.parent.remove(m); m.geometry.dispose(); m.material.map && m.material.map.dispose(); m.material.dispose(); });
    const geo = buildPlayerGeometry(this.team, { skin: this.skin });
    // reset bones to rest for binding
    this.bones.forEach(b => b.rotation.set(0, 0, 0));
    const savedGroup = [this.group.position.clone(), this.group.rotation.clone(), this.tilt.rotation.clone(), this.tilt.position.clone()];
    this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0); this.tilt.rotation.set(0, 0, 0); this.tilt.position.set(0, 0.95, 0);
    const parent = this.group.parent; if (parent) parent.remove(this.group);
    this.group.updateMatrixWorld(true);
    this.mesh = new THREE.SkinnedMesh(geo, sharedToon);
    this.offset.add(this.mesh);
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh.bind(this.skeleton);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    if (this.outlines) {
      this.outline = new THREE.SkinnedMesh(geo, sharedOutline);
      this.offset.add(this.outline);
      this.outline.bind(this.skeleton, this.mesh.bindMatrix);
      this.outline.frustumCulled = false;
    } else this.outline = null;
    this.decalMeshes = [];
    if (this.decals) {
      // jersey numbers (front + back) attached to chest
      const ng = mergeGeometries([
        new THREE.PlaneGeometry(0.34, 0.34).rotateY(-Math.PI / 2).translate(-0.262, 0.08, 0),
        new THREE.PlaneGeometry(0.2, 0.2).rotateY(Math.PI / 2).translate(0.262, 0.12, 0),
      ]);
      const nm = new THREE.Mesh(ng, new THREE.MeshToonMaterial({ map: numberTexture(this.number, this.team), transparent: true, alphaTest: 0.4, gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
      this.bones[B.chest].add(nm); this.decalMeshes.push(nm);
      // helmet logos
      const lt = new THREE.CanvasTexture(drawLogo(this.team, 128)); lt.colorSpace = THREE.SRGBColorSpace;
      const lg = mergeGeometries([
        new THREE.PlaneGeometry(0.27, 0.27).translate(0, 0, 0.402),
        new THREE.PlaneGeometry(0.27, 0.27).rotateY(Math.PI).translate(0, 0, -0.402),
      ]).translate(-0.03, 0.34, 0);
      const lm = new THREE.Mesh(lg, new THREE.MeshToonMaterial({ map: lt, transparent: true, alphaTest: 0.3, gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
      this.bones[B.head].add(lm); this.decalMeshes.push(lm);
    }
    if (parent) parent.add(this.group);
    this.group.position.copy(savedGroup[0]); this.group.rotation.copy(savedGroup[1]); this.tilt.rotation.copy(savedGroup[2]); this.tilt.position.copy(savedGroup[3]);
  }

  setTeam(team, number) {
    this.team = team; this.number = number ?? rosterNumbers(team)[this.idx % 3];
    this.buildMesh();
  }

  setQuality(q) {
    const want = q.outlines, wantD = q.decals;
    if (want !== this.outlines || wantD !== this.decals) { this.outlines = want; this.decals = wantD; this.buildMesh(); }
  }

  // world position of right hand (for holding the ball)
  getHand(out) {
    const el = this.bones[B.elR];
    el.updateWorldMatrix(true, false);
    return out.set(0.06, -0.3, 0.02).applyMatrix4(el.matrixWorld);
  }
  getHead(out) {
    const h = this.bones[B.head];
    h.updateWorldMatrix(true, false);
    return out.set(0, 0.4, 0).applyMatrix4(h.matrixWorld);
  }

  // s = player view state: {x,y,z,facing,act,actT,actVar,vx,vz,flags,tPitch,tRoll,hasBall,winding}
  update(s, dt) {
    this.time += dt;
    const T = this.target; T.fill(0);
    const set = (b, x, y, z) => { T[b * 3] = x; T[b * 3 + 1] = y; T[b * 3 + 2] = z; };
    const add = (b, x, y, z) => { T[b * 3] += x; T[b * 3 + 1] += y; T[b * 3 + 2] += z; };
    const speed = Math.hypot(s.vx, s.vz);
    const sprint = (s.flags & 1) !== 0;
    const engaged = (s.flags & 2) !== 0;
    this.phase += dt * (speed > 0.4 ? 3.2 + speed * 1.05 : 0);
    const ph = this.phase;
    const a = clamp(speed / 9, 0, 1);
    let tiltP = 0, tiltR = 0, pivotH = 0.95, bodyY = 0, extraYaw = 0, smooth = 16, directTilt = false;
    const t = s.actT;
    const act = s.act;
    const breath = Math.sin(this.time * 2.2) * 0.03;
    // --- base locomotion ---
    const locomotion = () => {
      const sw = Math.sin(ph);
      set(B.thL, 0, 0, sw * 1.0 * a + 0.05);
      set(B.thR, 0, 0, -sw * 1.0 * a + 0.05);
      set(B.knL, 0, 0, -(0.15 + a * 1.3 * Math.max(0, Math.sin(ph + 1.9))));
      set(B.knR, 0, 0, -(0.15 + a * 1.3 * Math.max(0, Math.sin(ph + 1.9 + Math.PI))));
      set(B.shL, 0.18 + a * 0.1, 0, -sw * 0.9 * a + 0.1);
      set(B.shR, -0.18 - a * 0.1, 0, sw * 0.9 * a + 0.1);
      set(B.elL, 0, 0, 0.35 + a * 1.0);
      set(B.elR, 0, 0, 0.35 + a * 1.0);
      set(B.chest, 0, Math.sin(ph) * 0.22 * a, -0.18 * a - (sprint ? 0.15 : 0) + breath);
      set(B.hips, 0, -Math.sin(ph) * 0.12 * a, -0.08 * a);
      set(B.head, 0, 0, 0.12 * a);
      bodyY = Math.abs(Math.cos(ph)) * 0.09 * a - (1 - a) * 0.03;
      if (a < 0.1) { add(B.knL, 0, 0, -0.15); add(B.knR, 0, 0, -0.15); add(B.thL, 0, 0, 0.1); add(B.thR, 0, 0, 0.1); bodyY -= 0.03; }
    };
    const carry = () => { set(B.shR, -0.1, 0, 0.35); set(B.elR, 0, 0.2, 1.9); };
    locomotion();
    if (s.hasBall) carry();
    if (engaged) { set(B.shL, 0.2, 0, 1.4); set(B.shR, -0.2, 0, 1.4); set(B.elL, 0, 0, 0.3); set(B.elR, 0, 0, 0.3); add(B.chest, 0, 0, -0.35); }
    switch (act) {
      case ACT.STANCE:
        set(B.chest, 0, 0, -0.55); set(B.hips, 0, 0, -0.2); set(B.thL, 0, 0, 0.75); set(B.thR, 0, 0, 0.75);
        set(B.knL, 0, 0, -1.05); set(B.knR, 0, 0, -1.05); set(B.shL, 0.15, 0, 0.75); set(B.shR, -0.15, 0, 0.75);
        set(B.elL, 0, 0, 0.3); set(B.elR, 0, 0, 0.3); set(B.head, 0, 0, 0.45); bodyY = -0.2;
        if (s.hasBall) { set(B.shR, -0.2, 0, 0.9); set(B.elR, 0, 0, 1.2); }
        break;
      case ACT.JUKE: {
        const lat = -Math.sin(s.facing) * s.vx + Math.cos(s.facing) * s.vz;
        const sgn = Math.sign(lat) || 1;
        add(B.chest, sgn * 0.45, 0, -0.1); add(B.hips, sgn * 0.25, 0, 0);
        set(B.thL, -0.45 * sgn, 0, 0.3); set(B.thR, -0.45 * sgn, 0, -0.2);
        tiltR = sgn * 0.25; bodyY = -0.08;
        break;
      }
      case ACT.SPIN: extraYaw = -clamp(t / 0.45, 0, 1) * Math.PI * 2; add(B.chest, 0, 0, -0.2); set(B.shL, 1.0, 0, 0.3); break;
      case ACT.STIFF: set(B.shL, 0.15, 0, 1.55); set(B.elL, 0, 0, 0.05); add(B.chest, -0.15, 0.25, -0.15); break;
      case ACT.DIVE: case ACT.TDIVE: {
        const k = clamp(t / 0.22, 0, 1);
        tiltP = -1.35 * k; pivotH = lerp(0.95, 0.45, k);
        set(B.shL, 0.2, 0, 2.9); set(B.shR, -0.2, 0, 2.9); set(B.elL, 0, 0, 0.1); set(B.elR, 0, 0, 0.1);
        set(B.thL, 0, 0, -0.25); set(B.thR, 0, 0, -0.1); set(B.knL, 0, 0, -0.4); set(B.knR, 0, 0, -0.2); set(B.head, 0, 0, 0.6);
        if (s.hasBall && act === ACT.DIVE) { set(B.shR, -0.2, 0, 2.6); set(B.elR, 0, 0, 0.2); }
        smooth = 22;
        break;
      }
      case ACT.JUMP:
        set(B.shL, 0.25, 0, 2.95); set(B.shR, -0.25, 0, 2.95); set(B.elL, 0, 0, 0.15); set(B.elR, 0, 0, 0.15);
        set(B.thL, 0, 0, 0.6); set(B.thR, 0, 0, 0.3); set(B.knL, 0, 0, -1.1); set(B.knR, 0, 0, -0.7); set(B.head, 0, 0, -0.3);
        smooth = 22; break;
      case ACT.THROW: {
        const k = clamp(t / 0.22, 0, 1);
        set(B.shR, lerp(-1.9, -0.4, k), 0, lerp(-0.2, 1.5, k)); set(B.elR, 0, 0, lerp(1.6, 0.15, k));
        set(B.shL, 0.3, 0, 0.9); add(B.chest, 0, lerp(0.6, -0.5, k), -0.15 * k); smooth = 30;
        break;
      }
      case ACT.CATCH: {
        const k = clamp(1 - t / 0.4, 0, 1);
        if (k > 0.3) { set(B.shL, 0.1, 0, 2.3); set(B.shR, -0.1, 0, 2.3); set(B.elL, 0, 0, 0.6); set(B.elR, 0, 0, 0.6); }
        break;
      }
      case ACT.FAKED:
        add(B.chest, Math.sin(t * 22) * 0.35, 0, 0.15); set(B.shL, 1.2, 0, 0.6); set(B.shR, -1.2, 0, 0.3);
        tiltR = Math.sin(t * 12) * 0.2; break;
      case ACT.TUMBLE:
        directTilt = true; tiltP = s.tPitch; tiltR = s.tRoll; pivotH = 0.95;
        set(B.shL, 0.9 + Math.sin(t * 9) * 0.6, 0, Math.sin(t * 13) * 1.6); set(B.shR, -0.9 - Math.sin(t * 8) * 0.6, 0, Math.cos(t * 11) * 1.6);
        set(B.elL, 0, 0, 0.8); set(B.elR, 0, 0, 0.8);
        set(B.thL, 0.2, 0, Math.sin(t * 11 + 1) * 0.9); set(B.thR, -0.2, 0, Math.cos(t * 10) * 0.9); set(B.knL, 0, 0, -0.9); set(B.knR, 0, 0, -0.6);
        smooth = 30; break;
      case ACT.DOWN: {
        directTilt = false; tiltP = s.tPitch; tiltR = 0; pivotH = 0.26;
        set(B.shL, 0.6, 0, s.tPitch > 0 ? 0.4 : 2.6); set(B.shR, -0.6, 0, s.tPitch > 0 ? 0.4 : 2.6);
        set(B.elL, 0, 0, 0.3); set(B.elR, 0, 0, 0.3); set(B.thL, 0.12, 0, 0.05); set(B.thR, -0.12, 0, 0.0);
        set(B.knL, 0, 0, -0.2); set(B.knR, 0, 0, -0.3); set(B.head, 0, 0, s.tPitch > 0 ? 0.3 : -0.2); set(B.chest, 0, 0, 0); set(B.hips, 0, 0, 0);
        bodyY = 0; smooth = 10;
        break;
      }
      case ACT.GETUP: {
        const k = clamp(t / 0.55, 0, 1), e = k * k * (3 - 2 * k);
        tiltP = s.tPitch * (1 - e); pivotH = lerp(0.26, 0.95, e);
        const m = Math.sin(k * Math.PI);
        set(B.thL, 0, 0, 1.3 * m); set(B.thR, 0, 0, 0.9 * m); set(B.knL, 0, 0, -1.7 * m); set(B.knR, 0, 0, -1.3 * m);
        set(B.shL, 0.3, 0, 0.9 * m); set(B.shR, -0.3, 0, 0.9 * m); set(B.chest, 0, 0, -0.5 * m);
        bodyY = -0.3 * m; smooth = 14;
        break;
      }
      case ACT.CELEB: celebrate(s.actVar, t, set, add, (v) => { bodyY = v; }, (p) => { tiltP = p; }, (y) => { extraYaw = y; }); smooth = 20; directTilt = s.actVar === 3; break;
      case ACT.CHEER: {
        const j = Math.abs(Math.sin(t * 6.5 + this.idx));
        bodyY = j * 0.3; set(B.shL, 0.4, 0, 2.7 + Math.sin(t * 13) * 0.3); set(B.shR, -0.4, 0, 2.7 + Math.cos(t * 13) * 0.3);
        set(B.elL, 0, 0, 0.3); set(B.elR, 0, 0, 0.3); set(B.knL, 0, 0, -0.6 * (1 - j)); set(B.knR, 0, 0, -0.6 * (1 - j)); set(B.thL, 0, 0, 0.3 * (1 - j)); set(B.thR, 0, 0, 0.3 * (1 - j));
        set(B.head, 0, 0, -0.3); smooth = 20; break;
      }
      case ACT.SAD:
        set(B.head, 0, 0, 0.7); set(B.chest, 0, 0, -0.25); set(B.shL, 0.5, 0, 2.2); set(B.shR, -0.5, 0, 2.2); set(B.elL, 0, 0.6, 2.2); set(B.elR, 0, -0.6, 2.2);
        break;
    }
    if (s.winding && s.hasBall && act !== ACT.THROW) { set(B.shR, -1.9, 0, -0.25); set(B.elR, 0, 0, 1.6); add(B.chest, 0, 0.55, 0); set(B.shL, 0.3, 0, 1.0); }
    // blend pose
    const k = 1 - Math.exp(-smooth * dt);
    for (let i = 0; i < NB * 3; i++) this.pose[i] += (T[i] - this.pose[i]) * k;
    for (let i = 1; i < NB; i++) this.bones[i].rotation.set(this.pose[i * 3], this.pose[i * 3 + 1], this.pose[i * 3 + 2]);
    // body transform
    const tc = this.tiltCur;
    const kt = 1 - Math.exp(-(directTilt ? 60 : 12) * dt);
    tc.p += (tiltP - tc.p) * kt; tc.r += (tiltR - tc.r) * kt;
    tc.h += (pivotH - tc.h) * (1 - Math.exp(-14 * dt));
    tc.y += (bodyY - tc.y) * (1 - Math.exp(-20 * dt));
    if (act !== ACT.SPIN) tc.yaw += (extraYaw - tc.yaw) * (1 - Math.exp(-20 * dt)); else tc.yaw = extraYaw;
    this.tilt.rotation.set(tc.r, 0, tc.p);
    this.tilt.position.y = tc.h + tc.y;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = -s.facing + tc.yaw;
  }
}

function celebrate(v, t, set, add, setY, setTilt, setYaw) {
  switch (v) {
    case 0: { // "Gridiron Shuffle" dance
      const w = t * 8;
      set(B.hips, Math.sin(w) * 0.3, 0, 0); set(B.chest, -Math.sin(w) * 0.25, Math.sin(w * 0.5) * 0.4, 0);
      set(B.shL, 0.6, 0, 1.6 + Math.sin(w) * 1.1); set(B.shR, -0.6, 0, 1.6 - Math.sin(w) * 1.1);
      set(B.elL, 0, 0, 1.0); set(B.elR, 0, 0, 1.0);
      set(B.thL, 0.2, 0, Math.max(0, Math.sin(w)) * 0.8); set(B.thR, -0.2, 0, Math.max(0, -Math.sin(w)) * 0.8);
      set(B.knL, 0, 0, -Math.max(0, Math.sin(w)) * 1.2); set(B.knR, 0, 0, -Math.max(0, -Math.sin(w)) * 1.2);
      setY(Math.abs(Math.sin(w)) * 0.1);
      setYaw(Math.sin(t * 2) * 0.6);
      break;
    }
    case 1: { // power flex
      const pulse = Math.sin(t * 6) * 0.15;
      set(B.shL, 1.45, 0, 0.2); set(B.shR, -1.45, 0, 0.2); set(B.elL, 0, 0, 1.9 + pulse); set(B.elR, 0, 0, 1.9 - pulse);
      set(B.chest, 0, 0, 0.25); set(B.head, 0, 0, -0.35); set(B.thL, 0.3, 0, 0); set(B.thR, -0.3, 0, 0);
      setY(-0.05 + Math.abs(pulse) * 0.2);
      break;
    }
    case 2: { // spike
      if (t < 0.5) { set(B.shR, -0.3, 0, 2.9); set(B.elR, 0, 0, 0.2); set(B.chest, 0, 0, 0.2); }
      else if (t < 0.9) { set(B.shR, -0.2, 0, 0.6); set(B.chest, 0, 0, -0.7); set(B.knL, 0, 0, -0.5); set(B.thL, 0, 0, 0.6); }
      else { set(B.shL, 0.5, 0, 2.6); set(B.shR, -0.5, 0, 2.6); setY(Math.abs(Math.sin(t * 7)) * 0.25); }
      break;
    }
    case 3: { // backflip
      const k = clamp((t - 0.3) / 0.9, 0, 1);
      const e = k * k * (3 - 2 * k);
      setTilt(e * Math.PI * 2);
      const tuck = Math.sin(k * Math.PI);
      set(B.thL, 0, 0, 1.6 * tuck); set(B.thR, 0, 0, 1.6 * tuck); set(B.knL, 0, 0, -2.0 * tuck); set(B.knR, 0, 0, -2.0 * tuck);
      set(B.shL, 0.3, 0, 2.6 - tuck); set(B.shR, -0.3, 0, 2.6 - tuck);
      if (k >= 1) { set(B.shL, 0.6, 0, 2.8); set(B.shR, -0.6, 0, 2.8); }
      break;
    }
    default: { // robot
      const st = Math.floor(t * 4);
      const a = (st % 4) * 0.4;
      set(B.shL, 0, 0, 1.57); set(B.elL, 0, 0, st % 2 ? 1.57 : 0); set(B.shR, 0, 0, st % 2 ? 0 : 1.57); set(B.elR, 0, 0, 1.57);
      set(B.head, 0, (st % 3 - 1) * 0.5, 0); set(B.chest, 0, a - 0.6, 0);
      setYaw(Math.floor(t * 2) % 2 ? 0.5 : -0.5);
    }
  }
}
