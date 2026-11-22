/* Torneios — Falta 1
 *
 * Formatos:
 *  - americano     individual; os parceiros rodam e NUNCA se repete parceiro dentro do torneio.
 *                  Classificação por jogos ganhos (soma dos jogos de cada partida).
 *  - grupos        duplas; grupos todos-contra-todos, os 2 primeiros de cada grupo passam às eliminatórias.
 *  - eliminatoria  duplas; quem perde sai. Cabeças de série para as melhores só se encontrarem no fim.
 *
 * Modo de emparelhamento (escolha do organizador):
 *  - ranking  a app sugere: duplas equilibradas (o mais forte com o mais fraco), cabeças de série pelo nível,
 *             no americano junta jogadores de nível parecido e equilibra cada jogo.
 *  - sorteio  aleatório. Nunca repete duplas dentro do mesmo torneio (torneios passados não contam).
 *             Nas eliminatórias as duplas podem voltar a encontrar-se.
 *
 * Resultados: um jogador do jogo regista, um jogador da outra equipa confirma ou contesta (como nos jogos
 * casuais). O organizador, se não jogar nesse jogo, regista ou valida diretamente. Só os confirmados contam.
 *
 * O torneio é um objeto simples (guardado tal como está no Backend). Os jogos de eliminatória referem-se
 * a "lugares" (cabeça de série n, 1.º do grupo A, vencedor do jogo X) que resolve() transforma em equipas.
 */
(function (root) {
  const Rating = root.Rating || (typeof require !== 'undefined' ? require('./rating.js') : null);

  const FORMATS = {
    americano: { id: 'americano', label: 'Americano', entry: 'individual', min: 4,
      desc: 'Individual. Os parceiros vão rodando: cada ronda jogas com alguém diferente e nunca repetes parceiro. Ganha quem somar mais jogos.' },
    grupos: { id: 'grupos', label: 'Grupos + eliminatórias', entry: 'pairs', min: 4,
      desc: 'Duplas. Fase de grupos todos contra todos; as 2 primeiras duplas de cada grupo passam às eliminatórias.' },
    eliminatoria: { id: 'eliminatoria', label: 'Eliminatória', entry: 'pairs', min: 2,
      desc: 'Duplas. Quem perde sai. As duplas mais fortes só se encontram no fim (cabeças de série).' }
  };
  const MODES = {
    ranking: { id: 'ranking', label: 'Sugerido pelo ranking', desc: 'Duplas e jogos equilibrados pelo nível de cada jogador.' },
    sorteio: { id: 'sorteio', label: 'Sorteio', desc: 'Aleatório, sem repetir duplas dentro do torneio.' }
  };
  const BYE = 'BYE';

  // ---------- utilitários ----------
  function makeRand(seed) {
    if (seed == null) return Math.random;
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const pairKey = (a, b) => [a, b].sort().join('|');
  const teamKey = (t) => t.slice().sort().join('|');
  const avg = (ids, levels) => ids.reduce((s, id) => s + (levels[id] != null ? levels[id] : 3), 0) / ids.length;
  const groupName = (i) => String.fromCharCode(65 + i);
  // Um resultado só conta quando está confirmado. Resultados sem estado (organizador, versões antigas) contam.
  const isConfirmed = (m) => !!(m && m.result && (m.result.status || 'confirmado') === 'confirmado');

  // Duplas a partir de jogadores individuais (formatos de duplas).
  function formPairs(players, mode, rand = Math.random) {
    if (mode === 'ranking') {
      const s = players.slice().sort((a, b) => b.level - a.level);
      const out = [];
      for (let i = 0; i < Math.floor(s.length / 2); i++) out.push([s[i].id, s[s.length - 1 - i].id]);
      return out;
    }
    const s = shuffle(players, rand), out = [];
    for (let i = 0; i + 1 < s.length; i += 2) out.push([s[i].id, s[i + 1].id]);
    return out;
  }

  // ---------- americano ----------
  // Emparelha uma lista em duplas sem repetir parceiros já usados (backtracking com limite).
  function pairUp(list, used, budget) {
    if (!list.length) return [];
    if (budget.n-- <= 0) return null;
    const [x, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      const y = rest[i];
      if (used.has(pairKey(x, y))) continue;
      const sub = pairUp(rest.filter((_, j) => j !== i), used, budget);
      if (sub) return [[x, y], ...sub];
    }
    return null;
  }
  function randomRound(active, used, rand) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const teams = pairUp(shuffle(active, rand), used, { n: 4000 });
      if (!teams) continue;
      const t = shuffle(teams, rand), matches = [];
      for (let i = 0; i + 1 < t.length; i += 2) matches.push([t[i], t[i + 1]]);
      return matches;
    }
    return null;
  }
  // Grupos de 4 de nível parecido; em cada grupo a divisão mais equilibrada que ainda não tenha duplas repetidas.
  function rankingRound(active, used, levels, rand) {
    const s = active.slice().sort((a, b) => (levels[b] || 0) - (levels[a] || 0));
    const options = [[[0, 3], [1, 2]], [[0, 2], [1, 3]], [[0, 1], [2, 3]]];
    const matches = [];
    for (let g = 0; g + 3 < s.length; g += 4) {
      const q = s.slice(g, g + 4);
      const opt = options.find(([a, b]) => !used.has(pairKey(q[a[0]], q[a[1]])) && !used.has(pairKey(q[b[0]], q[b[1]])));
      if (!opt) return randomRound(active, used, rand); // grupo esgotado: sorteia esta ronda (continua sem repetir)
      matches.push([[q[opt[0][0]], q[opt[0][1]]], [q[opt[1][0]], q[opt[1][1]]]]);
    }
    return matches;
  }
  // Tenta várias vezes e fica com o calendário mais comprido (o sorteio ronda a ronda pode encravar).
  // Com todos a jogar em todas as rondas, o sorteio usa o método do círculo: garante n−1 rondas sem repetir parceiro.
  function americanoSchedule(ids, levels, opts) {
    const n = ids.length, perRound = Math.min(opts.courts, Math.floor(n / 4)) * 4;
    if (opts.mode !== 'ranking' && perRound === n) return circleSchedule(ids, opts);
    let best = [];
    for (let attempt = 0; attempt < 60 && best.length < opts.rounds; attempt++) {
      const s = greedySchedule(ids, levels, opts);
      if (s.length > best.length) best = s;
    }
    return best;
  }
  function circleSchedule(ids, { rounds, rand }) {
    const labels = shuffle(ids, rand);
    const order = shuffle(roundRobin(labels.length), rand).slice(0, rounds);
    return order.map((games, r) => {
      const teams = shuffle(games.map(([x, y]) => [labels[x], labels[y]]), rand), matches = [];
      for (let i = 0; i + 1 < teams.length; i += 2) matches.push([teams[i], teams[i + 1]]);
      return { round: r + 1, matches, sitting: [] };
    });
  }
  function greedySchedule(ids, levels, { rounds, courts, mode, rand }) {
    const n = ids.length;
    const perRound = Math.min(courts, Math.floor(n / 4)) * 4;
    const used = new Set(), byes = Object.fromEntries(ids.map(id => [id, 0]));
    const out = [];
    for (let r = 1; r <= rounds; r++) {
      // Descansa quem descansou menos vezes (empates ao acaso).
      const order = shuffle(ids, rand).sort((a, b) => byes[a] - byes[b]);
      const sitting = order.slice(0, n - perRound), active = order.slice(n - perRound);
      const matches = mode === 'ranking' ? rankingRound(active, used, levels, rand) : randomRound(active, used, rand);
      if (!matches) break; // não há maneira de fazer mais rondas sem repetir parceiro
      matches.forEach(([a, b]) => { used.add(pairKey(a[0], a[1])); used.add(pairKey(b[0], b[1])); });
      sitting.forEach(id => byes[id]++);
      out.push({ round: r, matches, sitting });
    }
    return out;
  }

  // ---------- eliminatórias ----------
  function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const m = order.length * 2 + 1;
      order = order.flatMap(s => [s, m - s]);
    }
    return order;
  }
  function buildKnockout(nSeeds) {
    let size = 2; while (size < nSeeds) size *= 2;
    const order = seedOrder(size), matches = [];
    let prev = [];
    for (let r = 1, inRound = size / 2; inRound >= 1; r++, inRound /= 2) {
      const cur = [];
      for (let i = 0; i < inRound; i++) {
        const m = { id: `k${r}-${i + 1}`, stage: 'eliminatoria', round: r, inRound,
          slotA: r === 1 ? { seed: order[2 * i] } : { winnerOf: prev[2 * i].id },
          slotB: r === 1 ? { seed: order[2 * i + 1] } : { winnerOf: prev[2 * i + 1].id },
          teamA: null, teamB: null, result: null };
        cur.push(m);
      }
      matches.push(...cur); prev = cur;
    }
    return matches;
  }
  function koRoundName(inRound) {
    return { 1: 'Final', 2: 'Meias-finais', 4: 'Quartos de final', 8: 'Oitavos de final' }[inRound] || `Ronda de ${inRound * 2}`;
  }

  // Todos contra todos (método do círculo) → lista de rondas, cada uma com pares de índices.
  function roundRobin(n) {
    const idx = [...Array(n).keys()];
    if (n % 2) idx.push(-1);
    const m = idx.length, rounds = [];
    for (let r = 0; r < m - 1; r++) {
      const games = [];
      for (let i = 0; i < m / 2; i++) {
        const a = idx[i], b = idx[m - 1 - i];
        if (a !== -1 && b !== -1) games.push([a, b]);
      }
      rounds.push(games);
      idx.splice(1, 0, idx.pop());
    }
    return rounds;
  }

  // ---------- criar ----------
  /**
   * @param {object} o
   * @param {'americano'|'grupos'|'eliminatoria'} o.format
   * @param {'ranking'|'sorteio'} o.mode
   * @param {{id:string, level:number}[]} o.players   participantes individuais
   * @param {string[][]} [o.pairs]  duplas definidas pelo organizador (formatos de duplas); se faltar, a app forma-as
   * @param {number} [o.courts=2]
   * @param {number} [o.rounds]  só americano (por defeito, até 7 rondas sem repetir parceiro)
   * @param {number} [o.seed]    para resultados reproduzíveis (testes)
   */
  function create({ format, mode = 'ranking', players, pairs, courts = 2, rounds, seed }) {
    const F = FORMATS[format]; if (!F) throw new Error('Formato desconhecido');
    const rand = makeRand(seed);
    const levels = Object.fromEntries(players.map(p => [p.id, Number(p.level) || 0]));
    const t = { format, mode, levels, config: { courts }, matches: [], groups: null, seeds: null, entries: {} };

    if (format === 'americano') {
      if (players.length < 4) throw new Error('O americano precisa de pelo menos 4 jogadores');
      const ids = players.map(p => p.id);
      const nRounds = Math.max(1, Math.min(rounds || Math.min(ids.length - 1, 7), ids.length - 1));
      const sched = americanoSchedule(ids, levels, { rounds: nRounds, courts, mode, rand });
      t.config.rounds = sched.length;
      t.entries.players = ids;
      t.rounds = sched.map(r => ({ round: r.round, sitting: r.sitting }));
      sched.forEach(r => r.matches.forEach(([a, b], i) => t.matches.push({
        id: `r${r.round}-${i + 1}`, stage: 'ronda', round: r.round, court: i + 1, teamA: a, teamB: b, result: null })));
      return t;
    }

    let list = pairs && pairs.length ? pairs.map(p => p.slice()) : formPairs(players, mode, rand);
    const seen = new Set();
    list.forEach(p => { if (p.length !== 2 || p[0] === p[1]) throw new Error('Cada dupla tem 2 jogadores diferentes'); p.forEach(id => { if (seen.has(id)) throw new Error('Há um jogador em duas duplas'); seen.add(id); }); });
    if (list.length < F.min) throw new Error(`${F.label} precisa de pelo menos ${F.min} duplas`);
    // Ordem de cabeças de série: pelo nível da dupla (ranking) ou ao acaso (sorteio).
    list = mode === 'ranking' ? list.slice().sort((a, b) => avg(b, levels) - avg(a, levels)) : shuffle(list, rand);
    t.entries.pairs = list;

    if (format === 'eliminatoria') {
      t.seeds = list.map((_, i) => ({ pair: i }));
      t.matches = buildKnockout(list.length);
      return t;
    }

    // grupos
    const n = list.length;
    const g = n <= 5 ? 1 : n < 12 ? 2 : 4;
    const groups = [...Array(g)].map((_, i) => ({ name: groupName(i), pairs: [] }));
    list.forEach((_, i) => { const row = Math.floor(i / g), col = i % g; groups[row % 2 ? g - 1 - col : col].pairs.push(i); }); // serpentina
    t.groups = groups;
    let court = 0;
    groups.forEach(gr => roundRobin(gr.pairs.length).forEach((games, r) => games.forEach(([x, y]) => {
      t.matches.push({ id: `g${gr.name}-${r + 1}-${x}${y}`, stage: 'grupo', group: gr.name, round: r + 1,
        court: (court++ % courts) + 1, teamA: list[gr.pairs[x]], teamB: list[gr.pairs[y]], result: null });
    })));
    // 1.os de todos os grupos, depois os 2.os (A1, B1, A2, B2 → A1×B2 e B1×A2).
    t.seeds = [...groups.map(gr => ({ group: gr.name, place: 1 })), ...groups.map(gr => ({ group: gr.name, place: 2 }))];
    t.matches.push(...buildKnockout(t.seeds.length));
    return t;
  }

  // ---------- classificações ----------
  function sideTotals(sets) {
    let a = 0, b = 0; for (const [x, y] of sets || []) { a += x; b += y; } return { a, b };
  }
  function americanoStandings(t) {
    const rows = Object.fromEntries((t.entries.players || []).map(id => [id, { id, points: 0, against: 0, wins: 0, played: 0 }]));
    t.matches.forEach(m => {
      if (!isConfirmed(m)) return;
      const tot = sideTotals(m.result.sets);
      [[m.teamA, tot.a, tot.b, 'a'], [m.teamB, tot.b, tot.a, 'b']].forEach(([team, f, ag, side]) => team.forEach(id => {
        const r = rows[id]; if (!r) return;
        r.points += f; r.against += ag; r.played++; if (m.result.winner === side) r.wins++;
      }));
    });
    return Object.values(rows).sort((x, y) => y.points - x.points || y.wins - x.wins || (y.points - y.against) - (x.points - x.against) || String(x.id).localeCompare(String(y.id)));
  }
  function groupStandings(t, name) {
    const gr = t.groups.find(g => g.name === name);
    const rows = gr.pairs.map(i => ({ team: t.entries.pairs[i], key: teamKey(t.entries.pairs[i]), wins: 0, losses: 0, played: 0, gf: 0, ga: 0 }));
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
    t.matches.filter(m => m.stage === 'grupo' && m.group === name && isConfirmed(m)).forEach(m => {
      const tot = Rating.gamesTotals(m.result.sets);
      [[m.teamA, tot.a, tot.b, 'a'], [m.teamB, tot.b, tot.a, 'b']].forEach(([team, f, ag, side]) => {
        const r = byKey[teamKey(team)]; if (!r) return;
        r.played++; r.gf += f; r.ga += ag; if (m.result.winner === side) r.wins++; else r.losses++;
      });
    });
    return rows.sort((x, y) => y.wins - x.wins || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.key.localeCompare(y.key));
  }

  // ---------- resolver lugares → equipas ----------
  function resolve(t) {
    const out = { matches: [], groupTables: null, groupsDone: true, finished: false };
    if (t.groups) {
      out.groupTables = Object.fromEntries(t.groups.map(g => [g.name, groupStandings(t, g.name)]));
      out.groupsDone = t.matches.filter(m => m.stage === 'grupo').every(isConfirmed);
    }
    const byId = {};
    const winnerTeam = (rm) => !rm ? null : rm.bye ? rm.byeWinner : isConfirmed(rm) ? (rm.result.winner === 'a' ? rm.teamA : rm.teamB) : null;
    const slotTeam = (slot) => {
      if (slot.seed) {
        const s = t.seeds[slot.seed - 1];
        if (!s) return { team: BYE };
        if (s.pair != null) return { team: t.entries.pairs[s.pair] };
        const label = `${s.place}.º do grupo ${s.group}`;
        if (!out.groupsDone) return { team: null, label };
        const row = out.groupTables[s.group][s.place - 1];
        return row ? { team: row.team, label } : { team: BYE };
      }
      const src = byId[slot.winnerOf];
      const w = winnerTeam(src);
      return { team: w, label: src ? `Vencedor ${src.stage === 'eliminatoria' ? koRoundName(src.inRound).toLowerCase() + ' ' + src.id.split('-')[1] : ''}`.trim() : '' };
    };
    for (const m of t.matches) {
      if (m.stage !== 'eliminatoria') { const rm = { ...m }; out.matches.push(rm); byId[m.id] = rm; continue; }
      const A = slotTeam(m.slotA), B = slotTeam(m.slotB);
      const rm = { ...m, teamA: m.result && Array.isArray(m.teamA) ? m.teamA : A.team, teamB: m.result && Array.isArray(m.teamB) ? m.teamB : B.team, labelA: A.label, labelB: B.label };
      if (rm.teamA === BYE || rm.teamB === BYE) {
        rm.bye = true;
        rm.byeWinner = rm.teamA === BYE ? rm.teamB : rm.teamA; // pode ser null (ainda por decidir) ou BYE
      }
      out.matches.push(rm); byId[m.id] = rm;
    }
    out.playable = out.matches.filter(m => !m.bye && Array.isArray(m.teamA) && Array.isArray(m.teamB));
    out.finished = out.matches.every(m => m.bye ? m.byeWinner !== null : isConfirmed(m));
    out.pending = out.matches.filter(m => m.result && !isConfirmed(m));
    return out;
  }

  // ---------- posições finais (para a época) ----------
  function placements(t) {
    const res = resolve(t);
    if (!res.finished) return null;
    const out = {};
    const set = (team, place) => (team || []).forEach(id => { if (id !== BYE && !out[id]) out[id] = place; });
    if (t.format === 'americano') {
      americanoStandings(t).forEach((r, i) => { out[r.id] = i === 0 ? 'campeao' : i === 1 ? 'finalista' : i < 4 ? 'meias' : i < 8 ? 'quartos' : 'participacao'; });
      return out;
    }
    const ko = res.matches.filter(m => m.stage === 'eliminatoria' && !m.bye && isConfirmed(m));
    const final = res.matches.find(m => m.stage === 'eliminatoria' && m.inRound === 1);
    if (final && isConfirmed(final)) {
      const w = final.result.winner === 'a' ? final.teamA : final.teamB, l = final.result.winner === 'a' ? final.teamB : final.teamA;
      set(w, 'campeao'); set(l, 'finalista');
    } else if (final && final.bye) set(final.byeWinner, 'campeao');
    ko.forEach(m => {
      const loser = m.result.winner === 'a' ? m.teamB : m.teamA;
      if (m.inRound === 2) set(loser, 'meias'); else if (m.inRound === 4) set(loser, 'quartos');
    });
    (t.entries.pairs || []).forEach(p => set(p, 'participacao'));
    return out;
  }

  // Duplas usadas no torneio (para verificar que não se repetem fora das eliminatórias).
  function partnerships(t) {
    const out = {};
    t.matches.filter(m => m.stage !== 'eliminatoria').forEach(m => [m.teamA, m.teamB].forEach(team => {
      if (!Array.isArray(team)) return; const k = teamKey(team); out[k] = (out[k] || 0) + 1;
    }));
    return out;
  }

  const api = { FORMATS, MODES, BYE, isConfirmed, create, resolve, placements, americanoStandings, groupStandings, formPairs,
    seedOrder, roundRobin, koRoundName, partnerships, makeRand, teamKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tournament = api;
})(typeof window !== 'undefined' ? window : globalThis);
