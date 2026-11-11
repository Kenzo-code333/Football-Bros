// DOM UI: menus with animated transitions, lobby, season, editor, settings,
// and the TV-broadcast-style HUD (score bug, down & distance, clocks, stamina, play calls).
import { getTeams, getTeam, logoDataURL, HELMETS, JERSEYS, baseTeam, playerNumber } from './teams.js';
import { OFF_PLAYS, DEF_PLAYS, DEF_LIST, drawPlayDiagram } from './plays.js';
import { DIFFICULTY, QUALITY } from './config.js';
import { KEYMAPS } from './input.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ord = n => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
const fmtClock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const EMOJIS = ['🔥', '😂', '😱', '👏', '💪', '😎', '🏈', '😤'];

export class UI {
  constructor(app) {
    this.app = app;
    this.root = $('#ui');
    this.root.innerHTML = '';
    this.screens = {};
    this.current = null;
    this.hudEl = null;
    this.buildHud();
    this.lastMsgId = -1;
    this.pickCanvasKey = '';
    this.toastEl = h('<div class="toasts"></div>');
    this.root.appendChild(this.toastEl);
    this.fpsEl = h('<div class="fps hidden"></div>');
    this.root.appendChild(this.fpsEl);
  }

  // ---------- screen management ----------
  show(name, data = {}) {
    const prev = this.current;
    if (prev && this.screens[prev]) {
      const el = this.screens[prev];
      el.classList.remove('active'); el.classList.add('leaving');
      setTimeout(() => { el.classList.remove('leaving'); if (this.current !== prev) el.remove(); }, 350);
    }
    this.current = name;
    if (!name) return;
    const builder = this['screen_' + name];
    const el = document.createElement('div');
    el.className = 'screen screen-' + name;
    el.appendChild(builder.call(this, data));
    this.screens[name] = el;
    this.root.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('active')));
    this.app.onScreen(name);
    const first = el.querySelector('button:not([disabled])');
    if (first && name !== 'lobby') setTimeout(() => first.focus({ preventScroll: true }), 50);
  }
  refresh(data) { if (this.current) { const n = this.current; const el = this.screens[n]; const ne = this['screen_' + n].call(this, data); el.replaceChildren(ne); } }

  btn(label, fn, cls = '', attrs = '') {
    const b = h(`<button class="btn ${cls}" ${attrs}>${label}</button>`);
    b.addEventListener('click', (e) => { this.app.audio.blip(660, 0.05, 'square', 0.06); fn(e); });
    b.addEventListener('mouseenter', () => this.app.audio.blip(990, 0.03, 'sine', 0.03));
    return b;
  }

  // ---------- main menu ----------
  screen_main() {
    const el = h(`<div class="menu-main">
      <div class="title-wrap">
        <div class="title-kicker">3 ON 3 ARCADE FOOTBALL</div>
        <h1 class="title">GRIDIRON<span>BLITZ</span></h1>
        <div class="title-stripe"></div>
      </div>
      <div class="menu-buttons"></div>
      <div class="menu-foot">Chromebook-friendly · No installs · Press <b>Enter</b> to select</div>
    </div>`);
    const mb = $('.menu-buttons', el);
    const items = [
      ['Quick Play', 'vs AI', () => this.show('setup', { mode: 'ai' })],
      ['Local 2 Player', 'same keyboard', () => this.show('setup', { mode: 'local2' })],
      ['Online', 'play with friends', () => this.show('online')],
      ['Season', '7 games + playoffs', () => this.app.openSeason()],
      ['Team Editor', 'colors · helmets · number', () => this.show('editor')],
      ['Settings', 'quality · audio', () => this.show('settings')],
      ['How to Play', 'controls', () => this.show('help')],
    ];
    items.forEach(([t, s, f], i) => { const b = this.btn(`<span class="bt">${t}</span><span class="bs">${s}</span>`, f, 'menu-btn'); b.style.animationDelay = `${0.08 + i * 0.05}s`; mb.appendChild(b); });
    return el;
  }

  // ---------- team setup ----------
  teamPicker(label, idx, onChange, color) {
    const teams = getTeams();
    let i = idx;
    const el = h(`<div class="team-pick" style="--tc:${color || '#ffd21f'}"><div class="tp-label">${label}</div>
      <div class="tp-row"><button class="arrow" data-d="-1">◀</button><div class="tp-card"></div><button class="arrow" data-d="1">▶</button></div></div>`);
    const render = () => {
      const t = teams[i];
      $('.tp-card', el).innerHTML = `<img src="${logoDataURL(t, 160)}" alt=""><div class="tp-city">${esc(t.city)}</div><div class="tp-name" style="color:${t.primary}">${esc(t.name)}</div>
        <div class="tp-swatches"><i style="background:${t.primary}"></i><i style="background:${t.secondary}"></i><i style="background:${t.accent}"></i></div>
        <div class="tp-rating">OVR ${t.rating}</div>`;
      $('.tp-card', el).style.setProperty('--glow', t.primary);
      onChange(i);
    };
    el.querySelectorAll('.arrow').forEach(b => b.addEventListener('click', () => { i = (i + +b.dataset.d + 8) % 8; this.app.audio.blip(520, 0.04); const c = $('.tp-card', el); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); render(); }));
    render();
    return el;
  }

  diffPicker(cur, onChange) {
    const el = h(`<div class="seg"></div>`);
    for (const k of Object.keys(DIFFICULTY)) {
      const b = h(`<button class="seg-b ${k === cur ? 'on' : ''}">${DIFFICULTY[k].name}</button>`);
      b.addEventListener('click', () => { el.querySelectorAll('.seg-b').forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(k); this.app.audio.blip(700, 0.04); });
      el.appendChild(b);
    }
    return el;
  }

  screen_setup({ mode }) {
    const s = this.app.settings;
    let a = s.lastTeam ?? 0, b = (a + 3) % 8, diff = s.difficulty;
    const el = h(`<div class="panel setup"><h2>${mode === 'local2' ? 'Local 2 Player' : mode === 'season' ? 'New Season' : 'Quick Play'}</h2>
      <div class="setup-teams"></div><div class="setup-opts"></div><div class="setup-actions"></div></div>`);
    const st = $('.setup-teams', el);
    st.appendChild(this.teamPicker(mode === 'local2' ? 'PLAYER 1 · WASD' : 'YOUR TEAM', a, v => { a = v; }, '#4fd8ff'));
    if (mode !== 'season') { st.appendChild(h('<div class="vs">VS</div>')); st.appendChild(this.teamPicker(mode === 'local2' ? 'PLAYER 2 · ARROWS' : 'OPPONENT', b, v => { b = v; }, '#ff9a3c')); }
    const so = $('.setup-opts', el);
    so.appendChild(h(`<div class="opt-label">${mode === 'local2' ? 'AI teammates' : 'Difficulty'}</div>`));
    so.appendChild(this.diffPicker(diff, v => { diff = v; }));
    const sa = $('.setup-actions', el);
    sa.appendChild(this.btn('Back', () => this.show(mode === 'season' ? 'season' : 'main'), 'ghost'));
    sa.appendChild(this.btn(mode === 'season' ? 'Start Season' : 'Kick Off ▶', () => {
      s.difficulty = diff; s.lastTeam = a; this.app.saveSettings();
      if (mode === 'season') this.app.newSeason(a, diff);
      else this.app.startLocalMatch(mode, a, b, diff);
    }, 'primary'));
    return el;
  }

  // ---------- online ----------
  screen_online(data = {}) {
    const s = this.app.settings;
    const el = h(`<div class="panel online"><h2>Online</h2>
      <p class="muted">Host a room and share the code or link. Up to 6 players (3 per team) — empty spots are filled by AI.</p>
      <label class="field">Your name <input id="nm" maxlength="14" value="${esc(s.name)}"></label>
      <div class="online-grid">
        <div class="card"><h3>Host a game</h3><p class="muted">Creates a 4-letter room code.</p><div class="host-b"></div></div>
        <div class="card"><h3>Join a game</h3><input id="code" class="code-in" maxlength="4" placeholder="CODE" value="${esc(data.code || '')}"><div class="join-b"></div></div>
      </div>
      <div class="status muted"></div>
      <div class="setup-actions back"></div></div>`);
    const name = () => { const v = ($('#nm', el).value || '').trim().slice(0, 14) || 'Player'; s.name = v; this.app.saveSettings(); return v; };
    const status = (t, err) => { const st = $('.status', el); st.textContent = t; st.classList.toggle('err', !!err); };
    $('.host-b', el).appendChild(this.btn('Host Room', async (e) => { e.target.disabled = true; status('Contacting matchmaking server…'); try { await this.app.hostOnline(name()); } catch (err) { status(String(err.message || err), true); e.target.disabled = false; } }, 'primary'));
    $('.join-b', el).appendChild(this.btn('Join', async (e) => {
      const code = $('#code', el).value.trim().toUpperCase();
      if (code.length !== 4) { status('Enter the 4-letter room code.', true); return; }
      e.target.disabled = true; status('Connecting…');
      try { await this.app.joinOnline(code, name()); } catch (err) { status(String(err.message || err), true); e.target.disabled = false; }
    }, 'primary'));
    $('#code', el).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('.back', el).appendChild(this.btn('Back', () => this.show('main'), 'ghost'));
    return el;
  }

  screen_lobby() {
    const app = this.app, L = app.lobby, net = app.net;
    if (!L) return h('<div class="panel"><p>Connecting…</p></div>');
    const me = L.players.find(p => p.id === net.id) || {};
    const teams = getTeams();
    const tObj = (k) => (L.teamObjs ? L.teamObjs[k] : teams[L.teams[k]]);
    const el = h(`<div class="panel lobby"><div class="lobby-head"><div><div class="muted">ROOM CODE</div><div class="room-code">${L.code}</div></div>
      <div class="lobby-link"><input readonly value="${esc(app.roomLink || '')}"><span class="copy"></span></div></div>
      <div class="lobby-teams"></div>
      <div class="lobby-bottom"><div class="emoji-bar"></div><div class="lobby-opts"></div></div>
      <div class="setup-actions"></div></div>`);
    const copyB = this.btn('Copy Link', () => { const inp = $('.lobby-link input', el); inp.select(); try { navigator.clipboard.writeText(inp.value); } catch (e) { document.execCommand && document.execCommand('copy'); } this.toast('Link copied!'); }, 'small');
    $('.copy', el).appendChild(copyB);
    const lt = $('.lobby-teams', el);
    for (const k of [0, 1]) {
      const t = tObj(k);
      const col = h(`<div class="lobby-team" style="--tc:${t.primary}"><div class="lt-head"><img src="${logoDataURL(t, 96)}"><div><div class="tp-city">${esc(t.city)}</div><div class="tp-name">${esc(t.name)}</div></div></div><div class="slots"></div><div class="lt-act"></div></div>`);
      if (net.isHost) {
        const sel = h(`<select class="team-sel">${teams.map((tt, i) => `<option value="${i}" ${i === L.teams[k] ? 'selected' : ''}>${esc(tt.city)} ${esc(tt.name)}</option>`).join('')}</select>`);
        sel.addEventListener('change', () => app.lobbySetTeam(k, +sel.value));
        $('.lt-head', col).appendChild(sel);
      }
      const slots = $('.slots', col);
      const ps = L.players.filter(p => p.team === k);
      for (let i = 0; i < 3; i++) {
        const p = ps[i];
        slots.appendChild(h(p ? `<div class="slot filled ${p.id === net.id ? 'me' : ''}"><span class="pname">${esc(p.name)}${p.host ? ' <em>HOST</em>' : ''}</span><span class="ready ${p.ready ? 'on' : ''}">${p.ready ? 'READY' : 'NOT READY'}</span></div>`
          : `<div class="slot empty"><span class="pname">AI Player</span><span class="ready ai">CPU</span></div>`));
      }
      if (me.team !== k && ps.length < 3) $('.lt-act', col).appendChild(this.btn('Switch Here', () => app.lobbySend({ t: 'team', team: k }), 'small'));
      lt.appendChild(col);
    }
    const eb = $('.emoji-bar', el);
    EMOJIS.forEach(e => eb.appendChild(this.btn(e, () => app.sendEmoji(e), 'emoji')));
    const lo = $('.lobby-opts', el);
    if (net.isHost) {
      lo.appendChild(h('<span class="muted">AI difficulty</span>'));
      lo.appendChild(this.diffPicker(L.difficulty, v => app.lobbySetDiff(v)));
    } else lo.appendChild(h(`<span class="muted">AI difficulty: ${DIFFICULTY[L.difficulty].name}</span>`));
    const sa = $('.setup-actions', el);
    sa.appendChild(this.btn('Leave', () => app.leaveOnline(), 'ghost'));
    if (!net.isHost) sa.appendChild(this.btn(me.ready ? 'Not Ready' : 'Ready!', () => app.lobbySend({ t: 'ready', ready: !me.ready }), me.ready ? '' : 'primary'));
    if (net.isHost) {
      const allReady = L.players.every(p => p.ready || p.host);
      sa.appendChild(this.btn(allReady ? 'Start Game ▶' : 'Waiting for ready…', () => app.startOnlineMatch(), allReady ? 'primary' : '', allReady ? '' : 'disabled'));
    }
    return el;
  }

  floatEmoji(name, e) {
    const el = h(`<div class="float-emoji"><span>${esc(e)}</span><small>${esc(name)}</small></div>`);
    el.style.left = (20 + Math.random() * 60) + '%';
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---------- season ----------
  screen_season({ season }) {
    const app = this.app;
    const el = h(`<div class="panel season"><h2>Season</h2><div class="season-body"></div><div class="setup-actions"></div></div>`);
    const body = $('.season-body', el), sa = $('.setup-actions', el);
    sa.appendChild(this.btn('Back', () => this.show('main'), 'ghost'));
    if (!season) {
      body.appendChild(h(`<p class="muted">Pick a team and battle through a 7-game regular season. The top 4 make the playoffs — win two more to lift the Blitz Bowl trophy. Progress saves automatically.</p>`));
      sa.appendChild(this.btn('New Season', () => this.show('setup', { mode: 'season' }), 'primary'));
      return el;
    }
    const teams = getTeams();
    const st = season.standings();
    const user = teams[season.userTeam];
    const next = season.nextGame();
    const header = h(`<div class="season-head"><img src="${logoDataURL(user, 96)}"><div><div class="tp-city">${esc(user.city)}</div><div class="tp-name" style="color:${user.primary}">${esc(user.name)}</div>
      <div class="muted">${season.phase === 'regular' ? `Week ${season.round + 1} of 7` : season.phase === 'semis' ? 'Playoffs: Semifinals' : season.phase === 'final' ? 'Blitz Bowl' : 'Season complete'}</div></div></div>`);
    body.appendChild(header);
    const grid = h(`<div class="season-grid"><table class="standings"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PF</th><th>PA</th></tr></thead><tbody></tbody></table><div class="season-side"></div></div>`);
    const tb = $('tbody', grid);
    st.forEach((r, k) => tb.appendChild(h(`<tr class="${r.i === season.userTeam ? 'me' : ''} ${k < 4 ? 'po' : ''}"><td>${k + 1}</td><td><img src="${logoDataURL(r.team, 48)}"> ${esc(r.team.name)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.pf}</td><td>${r.pa}</td></tr>`)));
    const side = $('.season-side', grid);
    if (next) {
      const ht = teams[next.home], at = teams[next.away];
      side.appendChild(h(`<div class="next-game"><div class="muted">${esc(next.label)}</div><div class="ng-row"><img src="${logoDataURL(ht, 96)}"><span>VS</span><img src="${logoDataURL(at, 96)}"></div><div class="ng-names">${esc(ht.name)} vs ${esc(at.name)}</div></div>`));
      sa.appendChild(this.btn('Play Game ▶', () => app.playSeasonGame(), 'primary'));
    } else {
      const champ = season.champion != null ? teams[season.champion] : null;
      side.appendChild(h(`<div class="next-game"><div class="trophy">🏆</div><div class="ng-names">${champ ? `${esc(champ.city)} ${esc(champ.name)} are champions!` : 'Season over'}</div>${season.champion === season.userTeam ? '<div class="champ">YOU WON THE BLITZ BOWL!</div>' : ''}</div>`));
    }
    // recent results
    const recent = [];
    season.rounds.forEach((r, ri) => r.forEach(g => { if (g.s && (g.home === season.userTeam || g.away === season.userTeam)) recent.push({ ...g, label: `W${ri + 1}` }); }));
    if (season.playoffs) for (const ph of ['semis', 'final']) (season.playoffs[ph] || []).forEach(g => { if (g.s && (g.home === season.userTeam || g.away === season.userTeam)) recent.push({ ...g, label: ph === 'semis' ? 'SF' : 'BB' }); });
    if (recent.length) {
      const list = h('<div class="results"></div>');
      recent.forEach(g => { const won = (g.home === season.userTeam) === (g.s[0] > g.s[1]); list.appendChild(h(`<div class="res ${won ? 'w' : 'l'}"><b>${g.label}</b> ${won ? 'W' : 'L'} ${g.s[0]}-${g.s[1]} vs ${esc(teams[g.home === season.userTeam ? g.away : g.home].name)}</div>`)); });
      side.appendChild(list);
    }
    body.appendChild(grid);
    const ab = this.btn('Abandon Season', () => {
      if (ab.dataset.armed) { app.abandonSeason(); return; }
      ab.dataset.armed = '1'; ab.textContent = 'Click again to delete';
      setTimeout(() => { if (ab.isConnected) { delete ab.dataset.armed; ab.textContent = 'Abandon Season'; } }, 3000);
    }, 'ghost danger');
    sa.appendChild(ab);
    return el;
  }

  // ---------- team editor ----------
  screen_editor() {
    const app = this.app;
    const teams = getTeams();
    let idx = app.settings.lastTeam ?? 0;
    const el = h(`<div class="panel editor"><h2>Team Editor</h2><div class="ed-body"><div class="ed-list"></div><div class="ed-form"></div></div><div class="setup-actions"></div></div>`);
    const list = $('.ed-list', el), form = $('.ed-form', el);
    let draft = null;
    const renderForm = () => {
      const t = getTeams()[idx];
      draft = { primary: t.primary, secondary: t.secondary, accent: t.accent, helmet: t.helmet, jersey: t.jersey, number: playerNumber() };
      form.innerHTML = '';
      const f = h(`<div><div class="ed-title"><img src="${logoDataURL(t, 96)}"><div><div class="tp-city">${esc(t.city)}</div><div class="tp-name">${esc(t.name)}</div></div></div>
        <div class="ed-row"><label>Primary<input type="color" data-k="primary" value="${t.primary}"></label><label>Secondary<input type="color" data-k="secondary" value="${t.secondary}"></label><label>Accent<input type="color" data-k="accent" value="${t.accent}"></label></div>
        <div class="ed-row"><label>Helmet<select data-k="helmet">${HELMETS.map(x => `<option ${x === t.helmet ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Jersey<select data-k="jersey">${JERSEYS.map(x => `<option ${x === t.jersey ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Your #<input type="number" min="0" max="99" data-k="number" value="${draft.number}"></label></div>
        <p class="muted small">Changes preview live on the field. Your number is worn by the player you control.</p></div>`);
      f.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('input', () => {
        const k = inp.dataset.k; draft[k] = k === 'number' ? Math.max(0, Math.min(99, parseInt(inp.value || '0', 10))) : inp.value;
        app.previewTeam(idx, draft);
      }));
      form.appendChild(f);
      app.previewTeam(idx, draft);
      list.querySelectorAll('.ed-team').forEach((b, i) => b.classList.toggle('on', i === idx));
    };
    teams.forEach((t, i) => {
      const b = h(`<button class="ed-team"><img src="${logoDataURL(t, 64)}"><span>${esc(t.name)}</span></button>`);
      b.addEventListener('click', () => { idx = i; renderForm(); });
      list.appendChild(b);
    });
    renderForm();
    const sa = $('.setup-actions', el);
    sa.appendChild(this.btn('Back', () => { app.endPreview(); this.show('main'); }, 'ghost'));
    sa.appendChild(this.btn('Reset Team', () => { app.resetTeam(idx); this.refresh(); }, ''));
    sa.appendChild(this.btn('Save', () => { app.saveTeam(idx, draft); this.toast('Team saved!'); }, 'primary'));
    return el;
  }

  // ---------- settings ----------
  screen_settings(data = {}) {
    const app = this.app, s = app.settings, vol = app.audio.vol;
    const el = h(`<div class="panel settings"><h2>Settings</h2>
      <div class="set-row"><span>Graphics quality</span><div class="seg q"></div></div>
      <p class="muted small">Low: no post-processing · Medium (default): bloom, FXAA, color grading · High: + shadows, denser crowd and grass, jumbotron live feed.</p>
      <div class="set-row"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" data-v="master" value="${vol.master}"></div>
      <div class="set-row"><span>Music</span><input type="range" min="0" max="1" step="0.05" data-v="music" value="${vol.music}"></div>
      <div class="set-row"><span>Sound effects</span><input type="range" min="0" max="1" step="0.05" data-v="sfx" value="${vol.sfx}"></div>
      <div class="set-row"><span>Crowd</span><input type="range" min="0" max="1" step="0.05" data-v="crowd" value="${vol.crowd}"></div>
      <div class="set-row"><span>Show FPS</span><label class="toggle"><input type="checkbox" id="fps" ${s.showFps ? 'checked' : ''}><i></i></label></div>
      <div class="setup-actions"></div></div>`);
    const q = $('.seg.q', el);
    for (const k of Object.keys(QUALITY)) {
      const b = h(`<button class="seg-b ${k === s.quality ? 'on' : ''}">${QUALITY[k].name}</button>`);
      b.addEventListener('click', () => { q.querySelectorAll('.seg-b').forEach(x => x.classList.remove('on')); b.classList.add('on'); app.setQuality(k); });
      q.appendChild(b);
    }
    el.querySelectorAll('[data-v]').forEach(r => r.addEventListener('input', () => app.audio.setVolume(r.dataset.v, +r.value)));
    $('#fps', el).addEventListener('change', (e) => { s.showFps = e.target.checked; app.saveSettings(); this.fpsEl.classList.toggle('hidden', !s.showFps); });
    $('.setup-actions', el).appendChild(this.btn('Back', () => (data.back ? data.back() : this.show('main')), 'ghost'));
    return el;
  }

  screen_help(data = {}) {
    const el = h(`<div class="panel help"><h2>How to Play</h2><div class="help-grid">
      <div class="card"><h3>Offense</h3><ul>
        <li><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint (stamina)</li>
        <li><kbd>Space</kbd> pass: <b>tap</b> = bullet, <b>hold</b> = lob</li>
        <li><kbd>Q</kbd>/<kbd>E</kbd> cycle receivers</li>
        <li><kbd>J</kbd> juke · <kbd>K</kbd> spin · <kbd>L</kbd> stiff-arm</li>
        <li><kbd>Ctrl</kbd> or <kbd>C</kbd> dive</li></ul></div>
      <div class="card"><h3>Defense</h3><ul>
        <li><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint</li>
        <li><kbd>Tab</kbd> switch to defender nearest the ball</li>
        <li><kbd>Space</kbd> tackle-dive</li>
        <li><kbd>J</kbd> jump to swat or intercept</li></ul></div>
      <div class="card"><h3>Player 2 (local)</h3><ul>
        <li><kbd>Arrows</kbd> move · <kbd>Right Shift</kbd> sprint</li>
        <li><kbd>Num0</kbd> or <kbd>/</kbd> pass / tackle</li>
        <li><kbd>Num1</kbd>/<kbd>.</kbd> juke·jump · <kbd>Num2</kbd>/<kbd>,</kbd> spin · <kbd>Num3</kbd>/<kbd>M</kbd> stiff-arm</li>
        <li><kbd>Right Ctrl</kbd>/<kbd>'</kbd> dive · <kbd>Enter</kbd> switch · <kbd>Num4/6</kbd> or <kbd>[ ]</kbd> cycle</li>
        <li>Play calls: <kbd>Num7 8 9</kbd></li></ul></div>
      <div class="card"><h3>Rules</h3><ul>
        <li>3 on 3, 60-yard field. 4 downs to gain 20 yards.</li>
        <li>Pick a play in 5 seconds: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> (or click).</li>
        <li>TD = 6, then go for 1 (from the 5) or 2 (from the 12).</li>
        <li>After scoring you may try an onside kick.</li>
        <li>4 × 2:00 quarters, clock runs during plays. OT is sudden death.</li>
        <li>Big hits can cause fumbles — the ball bounces wildly!</li></ul></div>
    </div><div class="setup-actions"></div></div>`);
    $('.setup-actions', el).appendChild(this.btn('Back', () => (data.back ? data.back() : this.show('main')), 'ghost'));
    void KEYMAPS;
    return el;
  }

  // ---------- HUD ----------
  buildHud() {
    const el = h(`<div id="hud" class="hidden">
      <div class="letterbox top"></div><div class="letterbox bot"></div>
      <div class="replay-tag hidden"><i></i> INSTANT REPLAY</div>
      <div class="pstat p0 hidden"><div class="pname">P1</div><div class="stam"><i></i></div><div class="cds"><span data-c="J">J</span><span data-c="K">K</span><span data-c="L">L</span></div></div>
      <div class="pstat p1 hidden"><div class="pname">P2</div><div class="stam"><i></i></div><div class="cds"><span data-c="J">.</span><span data-c="K">,</span><span data-c="L">M</span></div></div>
      <div class="banner-wrap"></div>
      <div class="hint"></div>
      <div class="scorebug">
        <div class="sb-team t0"><img><span class="abbr"></span><span class="score">0</span><b class="poss"></b></div>
        <div class="sb-team t1"><img><span class="abbr"></span><span class="score">0</span><b class="poss"></b></div>
        <div class="sb-clock"><span class="q">Q1</span><span class="clk">2:00</span></div>
        <div class="sb-down"><span class="dd">1st & 20</span><span class="bo">OWN 15</span></div>
        <div class="sb-play"><span class="pc">:05</span></div>
      </div>
      <div class="calls"></div>
      <div class="choice hidden"></div>
      <div class="pause hidden"></div>
      <div class="gameover hidden"></div>
      <div class="online-emoji hidden"></div>
    </div>`);
    this.root.appendChild(el);
    this.hudEl = el;
    const oe = $('.online-emoji', el);
    EMOJIS.slice(0, 6).forEach(e => { const b = h(`<button>${e}</button>`); b.addEventListener('click', () => this.app.sendEmoji(e)); oe.appendChild(b); });
  }

  showHud(on, ctx = {}) {
    this.hudEl.classList.toggle('hidden', !on);
    if (on) {
      const [a, b] = ctx.teams;
      for (const [k, t] of [[0, a], [1, b]]) {
        const tEl = $(`.sb-team.t${k}`, this.hudEl);
        $('img', tEl).src = logoDataURL(t, 64); $('.abbr', tEl).textContent = t.abbr; tEl.style.setProperty('--tc', t.primary); tEl.style.setProperty('--tc2', t.secondary);
      }
      $('.online-emoji', this.hudEl).classList.toggle('hidden', !ctx.online);
      this.lastMsgId = -1; this.pickCanvasKey = ''; this.choiceKey = '';
      $('.gameover', this.hudEl).classList.add('hidden');
      $('.pause', this.hudEl).classList.add('hidden');
      $('.calls', this.hudEl).innerHTML = '';
    }
  }

  banner(text, sub, color) {
    const wrap = $('.banner-wrap', this.hudEl);
    wrap.innerHTML = '';
    const el = h(`<div class="banner"><div class="b-main" style="--bc:${color || '#ffd21f'}">${esc(text)}</div>${sub ? `<div class="b-sub">${esc(sub)}</div>` : ''}</div>`);
    wrap.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1900);
    setTimeout(() => el.remove(), 2400);
  }

  toast(text) {
    const t = h(`<div class="toast">${esc(text)}</div>`);
    this.toastEl.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  // per-frame HUD update
  updateHud(g, view, ctx) {
    if (!g) return;
    const el = this.hudEl;
    const teams = ctx.teams;
    $('.t0 .score', el).textContent = g.score[0]; $('.t1 .score', el).textContent = g.score[1];
    $('.t0 .poss', el).classList.toggle('on', g.pos === 0); $('.t1 .poss', el).classList.toggle('on', g.pos === 1);
    $('.sb-clock .q', el).textContent = g.ot ? 'OT' : `Q${Math.min(4, g.q)}`;
    $('.sb-clock .clk', el).textContent = fmtClock(g.clock);
    const dd = g.conv ? `${g.conv}-PT TRY` : `${ord(g.down)} & ${g.toGo}`;
    $('.dd', el).textContent = dd;
    const bo = g.ballOn === 30 ? 'MID 30' : g.ballOn < 30 ? `OWN ${g.ballOn}` : `OPP ${60 - g.ballOn}`;
    $('.bo', el).textContent = bo;
    const showPick = g.phase === 'select';
    $('.sb-play', el).classList.toggle('on', showPick);
    $('.pc', el).textContent = showPick ? `:${String(Math.ceil(g.pickTimer)).padStart(2, '0')}` : '';
    // replay
    const replay = g.phase === 'replay';
    $('.replay-tag', el).classList.toggle('hidden', !replay);
    el.classList.toggle('cinema', replay || g.phase === 'td' || g.phase === 'cine');
    // banners
    if (g.msg && g.msg.id !== this.lastMsgId) { this.lastMsgId = g.msg.id; if (!ctx.demo) this.banner(g.msg.text, g.msg.sub, g.msg.color); }
    // player panels
    ctx.locals.forEach((lh, k) => {
      const ps = $(`.pstat.p${k}`, el);
      const hum = g.humans.find(x => x.id === lh.id);
      const p = hum && hum.pIdx >= 0 && view ? view.players[hum.pIdx] : null;
      ps.classList.toggle('hidden', !p || replay);
      if (!p) return;
      $('.pname', ps).textContent = ctx.locals.length > 1 ? `P${k + 1} · ${teams[lh.team].abbr}` : (ctx.myName || 'YOU');
      ps.style.setProperty('--tc', k ? '#ff9a3c' : '#4fd8ff');
      const st = $('.stam i', ps); st.style.width = `${Math.round(p.stamina * 100)}%`; st.classList.toggle('low', p.stamina < 0.25);
      const cds = ps.querySelectorAll('.cds span');
      const vals = [p.cdJ, p.cdS, p.cdL];
      cds.forEach((c, i) => c.classList.toggle('cool', vals[i] > 0));
      $('.cds', ps).classList.toggle('hidden', !p.hasBall);
    });
    // hints
    let hint = '';
    if (!replay && ctx.locals.length === 1 && !ctx.demo) {
      const lh = ctx.locals[0];
      const hum = g.humans.find(x => x.id === lh.id);
      const p = hum && view ? view.players[hum.pIdx] : null;
      if (g.phase === 'live' && p) {
        if (p.hasBall && g.passAllowed && hum.pIdx % 3 === 0) hint = '<kbd>SPACE</kbd> tap = bullet · hold = lob &nbsp; <kbd>Q</kbd>/<kbd>E</kbd> target';
        else if (p.hasBall) hint = '<kbd>J</kbd> juke · <kbd>K</kbd> spin · <kbd>L</kbd> stiff-arm · <kbd>CTRL</kbd> dive';
        else if (g.ballTeam !== lh.team) hint = '<kbd>SPACE</kbd> tackle dive · <kbd>J</kbd> jump · <kbd>TAB</kbd> switch';
      } else if (g.phase === 'presnap' && g.pos === lh.team) hint = '<kbd>SPACE</kbd> snap';
      else if (g.phase === 'replay' || g.phase === 'cine') hint = '<kbd>SPACE</kbd> skip';
    }
    const he = $('.hint', el);
    if (he.dataset.h !== hint) { he.innerHTML = hint; he.dataset.h = hint; }
    this.updateCalls(g, ctx);
    this.updateChoice(g, ctx);
  }

  updateCalls(g, ctx) {
    const wrap = $('.calls', this.hudEl);
    if (g.phase !== 'select' || ctx.demo) { if (wrap.childElementCount) { wrap.innerHTML = ''; this.pickCanvasKey = ''; } return; }
    const key = g.opts.join(',') + '|' + g.pos + '|' + ctx.locals.map(l => l.team).join(',') + '|' + JSON.stringify(g.picks);
    if (key === this.pickCanvasKey) { wrap.querySelectorAll('.timer i').forEach(t => { t.style.width = `${(g.pickTimer / 5) * 100}%`; }); return; }
    this.pickCanvasKey = key;
    wrap.innerHTML = '';
    const dual = ctx.locals.length > 1;
    ctx.locals.forEach((lh, k) => {
      const off = g.pos === lh.team;
      const locked = off ? g.picks.off : g.picks.def;
      const ids = off ? g.opts : DEF_LIST;
      const keys = dual ? (k === 0 ? ['1', '2', '3'] : ['7', '8', '9']) : ['1', '2', '3'];
      const team = ctx.teams[lh.team];
      const panel = h(`<div class="call-panel ${dual ? (k ? 'right' : 'left') : ''}" style="--tc:${team.primary}">
        <div class="call-head"><span>${off ? 'OFFENSE' : 'DEFENSE'}</span><b>${dual ? `P${k + 1} · ` : ''}${esc(team.name)}</b></div>
        <div class="cards"></div><div class="timer"><i style="width:${(g.pickTimer / 5) * 100}%"></i></div></div>`);
      if (locked) { $('.cards', panel).innerHTML = `<div class="locked">PLAY CALLED ✓</div>`; }
      else ids.forEach((id, i) => {
        const play = off ? OFF_PLAYS[id] : DEF_PLAYS[id];
        const card = h(`<button class="call-card"><div class="cc-key">${keys[i]}</div><canvas width="150" height="110"></canvas><div class="cc-name">${esc(play.name)}</div><div class="cc-tag">${play.tag}</div><div class="cc-desc">${esc(play.desc)}</div></button>`);
        drawPlayDiagram($('canvas', card), id, !off, team.primary, lh.team === 1);
        card.style.animationDelay = `${i * 0.06}s`;
        card.addEventListener('click', () => this.app.pickPlay(lh.id, id));
        $('.cards', panel).appendChild(card);
      });
      wrap.appendChild(panel);
    });
  }

  updateChoice(g, ctx) {
    const el = $('.choice', this.hudEl);
    const ch = g.choice;
    const mine = ch && ctx.locals.find(l => l.team === ch.team);
    if (!ch || (g.phase !== 'convChoice' && g.phase !== 'kickChoice') || ctx.demo) { el.classList.add('hidden'); this.choiceKey = ''; return; }
    const key = ch.kind + ch.team + (mine ? 'm' : '') + ch.value;
    el.classList.remove('hidden');
    if (key !== this.choiceKey) {
      this.choiceKey = key;
      el.innerHTML = '';
      const team = ctx.teams[ch.team];
      if (!mine || ch.value != null) {
        el.appendChild(h(`<div class="choice-wait">${esc(team.name)} ${ch.kind === 'conv' ? 'are deciding: 1 or 2 points…' : 'are lining up the kick…'}</div>`));
      } else {
        const keys = ctx.locals.length > 1 && ctx.locals.indexOf(mine) === 1 ? ['7', '8'] : ['1', '2'];
        const title = ch.kind === 'conv' ? 'CONVERSION' : 'KICKOFF';
        const opts = ch.kind === 'conv'
          ? [['1 POINT', 'Run it in from the 5', { type: 'conv', pts: 1 }], ['2 POINTS', 'From the 12 — riskier', { type: 'conv', pts: 2 }]]
          : [['KICK AWAY', 'Opponent starts at their 15', { type: 'kick', onside: false }], ['ONSIDE KICK', 'Recover it to keep the ball!', { type: 'kick', onside: true }]];
        const box = h(`<div class="choice-box" style="--tc:${team.primary}"><div class="ch-title">${title}</div><div class="ch-opts"></div><div class="ch-timer"></div></div>`);
        opts.forEach(([t, s, cmd], i) => {
          const b = this.btn(`<span class="ck">${keys[i]}</span><span class="bt">${t}</span><span class="bs">${s}</span>`, () => this.app.matchCommand(mine.id, cmd), 'choice-btn');
          $('.ch-opts', box).appendChild(b);
        });
        el.appendChild(box);
      }
    }
    const tm = $('.ch-timer', el); if (tm) tm.textContent = `${Math.ceil(ch.timer)}`;
  }

  showPause(on, online) {
    const el = $('.pause', this.hudEl);
    el.classList.toggle('hidden', !on);
    if (!on) return;
    el.innerHTML = '';
    const box = h(`<div class="pause-box"><h2>${online ? 'Menu' : 'Paused'}</h2><div class="pb"></div><p class="muted small">${online ? 'The game keeps running while this menu is open.' : ''}</p></div>`);
    const pb = $('.pb', box);
    pb.appendChild(this.btn('Resume', () => this.app.togglePause(false), 'primary'));
    pb.appendChild(this.btn('Settings', () => { this.app.pauseSub('settings'); }, ''));
    pb.appendChild(this.btn('Controls', () => { this.app.pauseSub('help'); }, ''));
    pb.appendChild(this.btn(online ? 'Leave Game' : 'Quit to Menu', () => this.app.quitMatch(), 'ghost danger'));
    el.appendChild(box);
    setTimeout(() => { const b = box.querySelector('button'); b && b.focus(); }, 30);
  }

  showGameOver(info) {
    const el = $('.gameover', this.hudEl);
    el.classList.remove('hidden');
    const [a, b] = info.teams;
    const w = info.teams[info.winner];
    const st = info.stats;
    const row = (label, k) => `<tr><td>${st[0][k]}</td><th>${label}</th><td>${st[1][k]}</td></tr>`;
    el.innerHTML = '';
    const box = h(`<div class="go-box" style="--tc:${w.primary}"><div class="go-kicker">FINAL${info.ot ? ' / OT' : ''}</div>
      <div class="go-score"><div><img src="${logoDataURL(a, 96)}"><span>${info.score[0]}</span></div><div class="dash">–</div><div><span>${info.score[1]}</span><img src="${logoDataURL(b, 96)}"></div></div>
      <div class="go-win">${esc(w.city)} ${esc(w.name)} WIN!</div>
      ${info.headline ? `<div class="go-head">${esc(info.headline)}</div>` : ''}
      <table class="go-stats"><tr><td>${esc(a.abbr)}</td><th></th><td>${esc(b.abbr)}</td></tr>${row('Touchdowns', 'tds')}${row('Pass Yds', 'passYds')}${row('Rush Yds', 'rushYds')}${row('Completions', 'comp')}${row('Interceptions thrown', 'ints')}${row('Fumbles', 'fumbles')}${row('Sacks', 'sacks')}${row('Big Hits', 'bigHits')}</table>
      <div class="go-actions"></div></div>`);
    const act = $('.go-actions', box);
    for (const [label, fn, cls] of info.actions) act.appendChild(this.btn(label, fn, cls));
    el.appendChild(box);
    setTimeout(() => { const bt = box.querySelector('button.primary') || box.querySelector('button'); bt && bt.focus(); }, 50);
  }
  hideGameOver() { $('.gameover', this.hudEl).classList.add('hidden'); }
  setFps(v) { this.fpsEl.textContent = `${v} FPS`; }
}

export { getTeam, baseTeam };
