// Season mode: 8 teams, 7-game round robin, top-4 playoff, saved in localStorage.
import { storeGet, storeSet, storeDel } from './config.js';
import { getTeams } from './teams.js';

function roundRobin(n) {
  const ids = [...Array(n).keys()], rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i], b = ids[n - 1 - i];
      games.push(r % 2 ? { home: b, away: a } : { home: a, away: b });
    }
    rounds.push(games);
    ids.splice(1, 0, ids.pop());
  }
  return rounds;
}

function simScore(rating) {
  let pts = 0;
  const poss = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < poss; i++) {
    if (Math.random() < 0.2 + (rating - 70) * 0.015) { pts += 6; pts += Math.random() < 0.75 ? 1 : Math.random() < 0.5 ? 2 : 0; }
    else if (Math.random() < 0.03) pts += 2;
  }
  return pts;
}

export class Season {
  constructor(data) { Object.assign(this, data); }
  static create(userTeam) {
    const rounds = roundRobin(8).map(games => games.map(g => ({ ...g, s: null })));
    return new Season({ userTeam, rounds, round: 0, phase: 'regular', playoffs: null, champion: null, difficulty: null });
  }
  static load() { const d = storeGet('season', null); return d ? new Season(d) : null; }
  save() { storeSet('season', { userTeam: this.userTeam, rounds: this.rounds, round: this.round, phase: this.phase, playoffs: this.playoffs, champion: this.champion, difficulty: this.difficulty }); }
  static clear() { storeDel('season'); }

  standings() {
    const teams = getTeams();
    const rows = teams.map((t, i) => ({ i, team: t, w: 0, l: 0, pf: 0, pa: 0 }));
    for (const r of this.rounds) for (const g of r) {
      if (!g.s) continue;
      const [a, b] = g.s;
      rows[g.home].pf += a; rows[g.home].pa += b; rows[g.away].pf += b; rows[g.away].pa += a;
      if (a > b) { rows[g.home].w++; rows[g.away].l++; } else { rows[g.away].w++; rows[g.home].l++; }
    }
    return rows.sort((x, y) => (y.w - x.w) || ((y.pf - y.pa) - (x.pf - x.pa)) || (y.pf - x.pf));
  }

  nextGame() {
    if (this.phase === 'regular') {
      const g = this.rounds[this.round].find(g => g.home === this.userTeam || g.away === this.userTeam);
      return { home: g.home, away: g.away, label: `Week ${this.round + 1} of 7` };
    }
    if (this.phase === 'semis' || this.phase === 'final') {
      const g = this.playoffs[this.phase].find(g => g.home === this.userTeam || g.away === this.userTeam);
      if (!g) return null;
      return { home: g.home, away: g.away, label: this.phase === 'semis' ? 'Playoff Semifinal' : 'Championship: The Blitz Bowl' };
    }
    return null;
  }

  simGame(g) {
    const teams = getTeams();
    let a = simScore(teams[g.home].rating + 2), b = simScore(teams[g.away].rating);
    while (a === b) { if (Math.random() < 0.5) a += 6; else b += 6; }
    g.s = [a, b];
  }

  // record user's result (scores ordered home, away) and advance the calendar
  record(homeScore, awayScore) {
    if (this.phase === 'regular') {
      for (const g of this.rounds[this.round]) {
        if (g.home === this.userTeam || g.away === this.userTeam) g.s = [homeScore, awayScore];
        else this.simGame(g);
      }
      this.round++;
      if (this.round >= this.rounds.length) this.startPlayoffs();
    } else if (this.phase === 'semis' || this.phase === 'final') {
      for (const g of this.playoffs[this.phase]) {
        if (g.home === this.userTeam || g.away === this.userTeam) g.s = [homeScore, awayScore];
        else if (!g.s) this.simGame(g);
      }
      this.advancePlayoffs();
    }
    this.save();
  }

  startPlayoffs() {
    const st = this.standings();
    const seeds = st.slice(0, 4).map(r => r.i);
    this.playoffs = { seeds, semis: [{ home: seeds[0], away: seeds[3], s: null }, { home: seeds[1], away: seeds[2], s: null }], final: null };
    this.phase = 'semis';
    if (!seeds.includes(this.userTeam)) { this.simRest(); }
  }

  advancePlayoffs() {
    const win = g => (g.s[0] > g.s[1] ? g.home : g.away);
    if (this.phase === 'semis') {
      const [a, b] = this.playoffs.semis.map(win);
      this.playoffs.final = [{ home: a, away: b, s: null }];
      this.phase = 'final';
      if (a !== this.userTeam && b !== this.userTeam) this.simRest();
    } else if (this.phase === 'final') {
      this.champion = win(this.playoffs.final[0]);
      this.phase = 'done';
    }
  }

  simRest() {
    if (this.phase === 'semis') { this.playoffs.semis.forEach(g => { if (!g.s) this.simGame(g); }); this.userEliminated = true; this.advancePlayoffs(); }
    if (this.phase === 'final') { this.playoffs.final.forEach(g => { if (!g.s) this.simGame(g); }); this.advancePlayoffs(); }
  }

  userAlive() { return this.nextGame() != null; }
}
