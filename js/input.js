// Keyboard input for up to two local players. Produces sim-compatible input snapshots
// with press counters so short taps are never lost (also used over the network).
import { BTN, HELD } from './sim.js';

const P1 = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  sprint: ['ShiftLeft'], [BTN.A]: ['Space'], [BTN.J]: ['KeyJ'], [BTN.K]: ['KeyK'], [BTN.L]: ['KeyL'],
  [BTN.DIVE]: ['ControlLeft', 'KeyC'], [BTN.SWITCH]: ['Tab'], [BTN.CYCL]: ['KeyQ'], [BTN.CYCR]: ['KeyE'],
  picks: ['Digit1', 'Digit2', 'Digit3'],
};
const P2 = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  sprint: ['ShiftRight'], [BTN.A]: ['Numpad0', 'Slash'], [BTN.J]: ['Numpad1', 'Period'], [BTN.K]: ['Numpad2', 'Comma'], [BTN.L]: ['Numpad3', 'KeyM'],
  [BTN.DIVE]: ['ControlRight', 'NumpadDecimal', 'Quote'], [BTN.SWITCH]: ['Enter', 'NumpadEnter'], [BTN.CYCL]: ['Numpad4', 'BracketLeft'], [BTN.CYCR]: ['Numpad6', 'BracketRight'],
  picks: ['Numpad7', 'Numpad8', 'Numpad9'],
};
// single-player: allow arrows + both shifts too
const SOLO = {
  ...P1,
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], [BTN.DIVE]: ['ControlLeft', 'ControlRight', 'KeyC'],
};

export const KEYMAPS = { P1, P2, SOLO };

const BLOCK = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'Enter', 'ControlLeft', 'ControlRight']);

class Pad {
  constructor(map) { this.setMap(map); this.cnt = [0, 0, 0, 0, 0, 0, 0, 0]; this.rel = 0; this.hold = 0; this.aDown = 0; this.seq = 0; }
  setMap(map) {
    this.map = map;
    this.lookup = new Map();
    for (let b = 0; b < 8; b++) for (const c of map[b] || []) this.lookup.set(c, b);
  }
}

export class Input {
  constructor() {
    this.down = new Set();
    this.pads = [new Pad(SOLO), new Pad(P2)];
    this.dual = false;
    this.enabled = true;
    this.listeners = [];
    window.addEventListener('keydown', e => this.onDown(e));
    window.addEventListener('keyup', e => this.onUp(e));
    window.addEventListener('blur', () => { this.down.clear(); });
  }
  setDual(d) { this.dual = d; this.pads[0].setMap(d ? P1 : SOLO); }
  onKey(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; }
  typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); }
  onDown(e) {
    if (this.typing(e)) return;
    if (BLOCK.has(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    const now = performance.now();
    this.pads.forEach((p, k) => {
      if (k === 1 && !this.dual) return;
      const b = p.lookup.get(e.code);
      if (b != null) { p.cnt[b]++; if (b === BTN.A) p.aDown = now; }
    });
    for (const fn of this.listeners) fn(e.code, e);
  }
  onUp(e) {
    if (!this.down.has(e.code)) return;
    this.down.delete(e.code);
    const now = performance.now();
    this.pads.forEach((p, k) => {
      if (k === 1 && !this.dual) return;
      if (p.lookup.get(e.code) === BTN.A) { p.rel++; p.hold = (now - p.aDown) / 1000; }
    });
  }
  any(codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  pickIndex(code, padIdx) { const m = this.pads[padIdx].map.picks; return m.indexOf(code); }
  get(k) {
    const p = this.pads[k], m = p.map;
    let mx = (this.any(m.right) ? 1 : 0) - (this.any(m.left) ? 1 : 0);
    let mz = (this.any(m.down) ? 1 : 0) - (this.any(m.up) ? 1 : 0);
    let held = 0;
    if (this.any(m.sprint)) held |= HELD.SPRINT;
    if (this.any(m[BTN.A])) held |= HELD.A;
    p.seq++;
    return { mx, mz, held, cnt: p.cnt.slice(), rel: p.rel, hold: p.hold, seq: p.seq };
  }
}
