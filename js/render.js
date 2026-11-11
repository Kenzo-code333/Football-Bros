// Renderer, post-processing chain and quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSat: { value: 1.14 },
    uContrast: { value: 1.06 },
    uFlash: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette, uSat, uContrast, uFlash, uDesat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uDesat));
      // split toning: cool shadows, warm highlights
      float lt = clamp(l, 0.0, 1.0);
      col *= mix(vec3(0.92, 0.97, 1.08), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.6, lt));
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col += uFlash;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060f);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1000);
    this.feedCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
    this.quality = null;
    this.composer = null;
    this.flash = 0;
    this.desat = 0;
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = q;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(pr);
    const shadowChange = this.renderer.shadowMap.enabled !== !!q.shadows;
    this.renderer.shadowMap.enabled = !!q.shadows;
    if (shadowChange) this.scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.needsUpdate = true; }); } });
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (q.post) {
      const size = this.renderer.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (q.bloom) {
        const div = q.shadows ? 1 : 2;
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / div, size.y / div), 0.65, 0.55, 0.9);
        this.composer.addPass(this.bloom);
      }
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    if (q.liveFeed && !this.feedRT) this.feedRT = new THREE.WebGLRenderTarget(384, 216);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      if (this.fxaa) {
        const pr = this.renderer.getPixelRatio();
        this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      }
    }
  }

  renderFeed(stadium) {
    if (!this.feedRT || !this.quality.liveFeed) { stadium.feedScreen.visible = false; return; }
    const vis = stadium.feedScreen.visible;
    stadium.feedScreen.visible = false;
    this.renderer.setRenderTarget(this.feedRT);
    this.renderer.render(this.scene, this.feedCam);
    this.renderer.setRenderTarget(null);
    stadium.feedMat.map = this.feedRT.texture;
    stadium.feedScreen.visible = vis;
  }

  render(dt) {
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.composer) {
      if (this.grade) { this.grade.uniforms.uFlash.value = this.flash * 0.25; this.grade.uniforms.uDesat.value = this.desat; }
      this.composer.render(dt);
    } else this.renderer.render(this.scene, this.camera);
  }
}
