// Online multiplayer over PeerJS (WebRTC data channels). Host-authoritative:
// clients send inputs, the host simulates and broadcasts snapshots (~20Hz).
import { ROOM_PREFIX } from './config.js';

let PeerCtor = null;

async function loadPeer() {
  if (PeerCtor) return PeerCtor;
  try {
    const mod = await import('peerjs');
    PeerCtor = mod.Peer || mod.default || (mod.default && mod.default.Peer);
    if (PeerCtor) return PeerCtor;
  } catch (e) { console.warn('[net] ESM PeerJS failed, falling back to UMD build', e); }
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Could not load PeerJS from the CDN'));
    document.head.appendChild(s);
  });
  PeerCtor = window.Peer;
  if (!PeerCtor) throw new Error('PeerJS unavailable');
  return PeerCtor;
}

function peerOptions() {
  // Optional self-hosted signaling server: ?peerhost=host&peerport=9000&peerpath=/
  const q = new URLSearchParams(location.search);
  const o = { debug: 0 };
  if (q.get('peerhost')) {
    o.host = q.get('peerhost'); o.port = +(q.get('peerport') || 9000); o.path = q.get('peerpath') || '/';
    o.secure = q.get('peersecure') === '1';
  }
  return o;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode() { let s = ''; for (let i = 0; i < 4; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return s; }

class Emitter {
  constructor() { this.h = {}; }
  on(t, f) { (this.h[t] = this.h[t] || []).push(f); return this; }
  emit(t, ...a) { (this.h[t] || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); }
}

// ---------------- Host ----------------
export class NetHost extends Emitter {
  constructor() { super(); this.conns = new Map(); this.peer = null; this.code = null; this.isHost = true; this.id = 'host'; }

  async open(tries = 4) {
    const Peer = await loadPeer();
    for (let k = 0; k < tries; k++) {
      const code = randomCode();
      try {
        await new Promise((res, rej) => {
          const peer = new Peer(ROOM_PREFIX + code, peerOptions());
          const to = setTimeout(() => { rej(new Error('Timed out contacting the matchmaking server')); peer.destroy(); }, 12000);
          peer.on('open', () => { clearTimeout(to); this.peer = peer; this.code = code; res(); });
          peer.on('error', (e) => { clearTimeout(to); if (!this.peer) { peer.destroy(); rej(e); } else this.emit('error', e); });
        });
        break;
      } catch (e) {
        if (!(e && e.type === 'unavailable-id') || k === tries - 1) throw e;
      }
    }
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) { /* ignore */ } });
    return this.code;
  }

  accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.emit('join', conn.peer, conn.metadata || {});
    });
    conn.on('data', (msg) => this.emit('msg', conn.peer, msg));
    const gone = () => { if (this.conns.has(conn.peer)) { this.conns.delete(conn.peer); this.emit('leave', conn.peer); } };
    conn.on('close', gone);
    conn.on('error', gone);
    // ICE failures don't always fire close
    conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'disconnected' || s === 'closed') setTimeout(() => { if (conn.peerConnection && ['failed', 'closed'].includes(conn.peerConnection.iceConnectionState)) gone(); }, 3000); });
  }

  send(id, msg) { const c = this.conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }
  broadcast(msg, except) { for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }
  kick(id, reason) { this.send(id, { t: 'kick', reason }); setTimeout(() => { const c = this.conns.get(id); if (c) c.close(); }, 300); }
  close() { try { this.broadcast({ t: 'closed' }); } catch (e) { /* ignore */ } setTimeout(() => { try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ } }, 200); this.conns.clear(); }
  link() { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('room', this.code); const q = new URLSearchParams(location.search); for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure']) if (q.get(k)) u.searchParams.set(k, q.get(k)); return u.toString(); }
}

// ---------------- Client ----------------
export class NetClient extends Emitter {
  constructor() { super(); this.peer = null; this.conn = null; this.isHost = false; this.id = null; this.rtt = 0.1; }

  async join(code, name) {
    const Peer = await loadPeer();
    code = code.toUpperCase().trim();
    await new Promise((res, rej) => {
      const peer = new Peer(undefined, peerOptions());
      const to = setTimeout(() => { rej(new Error('Could not reach the room. Check the code and try again.')); peer.destroy(); }, 15000);
      peer.on('open', (id) => {
        this.peer = peer; this.id = id;
        const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, metadata: { name }, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => { clearTimeout(to); res(); });
        conn.on('data', (msg) => this.onData(msg));
        conn.on('close', () => this.emit('closed'));
        conn.on('error', (e) => this.emit('error', e));
      });
      peer.on('error', (e) => { clearTimeout(to); if (e && e.type === 'peer-unavailable') rej(new Error(`Room ${code} not found.`)); else rej(e); });
    });
    this.code = code;
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000);
    return this.id;
  }

  onData(msg) {
    if (msg && msg.t === 'pong') { const r = (performance.now() - msg.c) / 1000; this.rtt = this.rtt * 0.7 + r * 0.3; return; }
    this.emit('msg', msg);
  }
  send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) { /* ignore */ } } }
  close() { clearInterval(this.pingTimer); try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (e) { /* ignore */ } }
}
