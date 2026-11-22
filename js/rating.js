/* Motor de nível — Falta 1 (POC)
 *
 * Elo adaptado a pares. Internamente cada jogador tem um rating (1000 = nível 0, 2400 = nível 7);
 * a app mostra sempre a escala 0–7.
 *
 *  - Força de uma equipa = média dos ratings dos dois jogadores.
 *  - Probabilidade de a equipa A ganhar:  E_A = 1 / (1 + 10^((R_B − R_A) / 400))
 *  - Depois do jogo, cada jogador:        ΔR = K · M · (S − E)
 *      S = 1 ganhou, 0 perdeu
 *      K = 48 nos primeiros 10 jogos, 32 até 30 jogos, 16 depois (o nível assenta com o tempo)
 *      M = multiplicador pela margem, de 1,0 (jogo renhido) a 1,5 (6-0 6-0)
 *  - A PARELHA tem o seu próprio rating, que começa na média dos dois e evolui com a mesma fórmula
 *    contra o rating da parelha adversária. Química = rating da parelha − média individual atual.
 *
 * Só entram resultados confirmados pelas duas equipas. Os valores são pontos de partida, a afinar com o piloto.
 */
(function (root) {
  const BASE = 1000, PER_LEVEL = 200, SCALE = 400;
  const MAX_MARGIN_BONUS = 0.5;
  const PROVISIONAL_GAMES = 5;   // abaixo disto o nível é mostrado como provisório
  const DEFAULT_LEVEL = 3;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const levelToRating = (level) => BASE + clamp(Number(level), 0, 7) * PER_LEVEL;
  const ratingToLevel = (r) => clamp((r - BASE) / PER_LEVEL, 0, 7);
  const expected = (rA, rB) => 1 / (1 + Math.pow(10, (rB - rA) / SCALE));
  const kFactor = (games) => (games < 10 ? 48 : games < 30 ? 32 : 16);
  const pairKey = (a, b) => [a, b].sort().join('|');

  // Um super tie-break (ex.: 10-8) conta como um jogo para quem o ganhou.
  function gamesTotals(sets) {
    let a = 0, b = 0;
    for (const [x, y] of sets || []) {
      if (Math.max(x, y) >= 10) { if (x > y) a++; else b++; }
      else { a += x; b += y; }
    }
    return { a, b };
  }

  function marginMultiplier(sets, winner) {
    const t = gamesTotals(sets);
    const total = t.a + t.b;
    if (!total) return 1;
    const share = (winner === 'a' ? t.a : t.b) / total; // 0,5 = renhido · 1 = sem perder um jogo
    return 1 + clamp((share - 0.5) * 2, 0, 1) * MAX_MARGIN_BONUS;
  }

  // Vencedor a partir dos sets: quem ganhou mais sets.
  function winnerFromSets(sets) {
    let a = 0, b = 0;
    for (const [x, y] of sets || []) { if (x > y) a++; else if (y > x) b++; }
    return a > b ? 'a' : b > a ? 'b' : null;
  }

  function newPlayer(level) {
    return { rating: levelToRating(level), startLevel: level, games: 0, wins: 0, losses: 0, history: [] };
  }

  /**
   * Recalcula tudo a partir do zero, por ordem cronológica.
   * @param {object} opts
   * @param {Object<string, number>} opts.initialLevels  id → nível inicial (autoavaliação, 0–7)
   * @param {object[]} opts.results  [{ id, date:'AAAA-MM-DD', teamA:[id,id], teamB:[id,id], sets:[[6,4],[6,3]], winner?:'a'|'b' }]
   * @param {function} [opts.onGame]  chamada antes de cada jogo contar: onGame(result, { winner, eA })
   * @returns {{ players: Object<string, object>, pairs: Object<string, object> }}
   */
  function computeRatings({ initialLevels = {}, results = [], onGame = null }) {
    const players = {}, pairs = {};
    const player = (id) => players[id] || (players[id] = newPlayer(id in initialLevels ? initialLevels[id] : DEFAULT_LEVEL));
    Object.keys(initialLevels).forEach(player);

    const ordered = results.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.id).localeCompare(String(y.id))));
    for (const r of ordered) {
      const winner = r.winner || winnerFromSets(r.sets);
      if (!winner || r.teamA.length !== 2 || r.teamB.length !== 2) continue;
      const A = r.teamA.map(player), B = r.teamB.map(player);
      const rA = (A[0].rating + A[1].rating) / 2, rB = (B[0].rating + B[1].rating) / 2;
      const eA = expected(rA, rB);
      const M = marginMultiplier(r.sets, winner);
      const sA = winner === 'a' ? 1 : 0;
      // Gancho para a época: probabilidade de cada equipa ganhar ANTES do jogo (para o bónus de surpresa).
      if (onGame) onGame(r, { winner, eA });

      // Parelhas: começam na média individual no momento do primeiro jogo juntos.
      const pair = (ids, avgRating) => {
        const k = pairKey(ids[0], ids[1]);
        return pairs[k] || (pairs[k] = { key: k, ids: ids.slice().sort(), rating: avgRating, games: 0, wins: 0, losses: 0, lastDate: null });
      };
      const pA = pair(r.teamA, rA), pB = pair(r.teamB, rB);
      const ePA = expected(pA.rating, pB.rating);

      const apply = (p, s, e) => {
        p.rating += kFactor(p.games) * M * (s - e);
        p.games++; if (s) p.wins++; else p.losses++;
      };
      A.forEach(p => apply(p, sA, eA));
      B.forEach(p => apply(p, 1 - sA, 1 - eA));
      apply(pA, sA, ePA);
      apply(pB, 1 - sA, 1 - ePA);
      pA.lastDate = pB.lastDate = r.date;
      [...r.teamA, ...r.teamB].forEach(id => players[id].history.push({ date: r.date, level: ratingToLevel(players[id].rating) }));
    }

    Object.values(players).forEach(p => {
      p.level = ratingToLevel(p.rating);
      p.provisional = p.games < PROVISIONAL_GAMES;
      const h = p.history;
      p.trend = h.length >= 2 ? h[h.length - 1].level - h[Math.max(0, h.length - 4)].level : 0; // últimos 3 jogos
    });
    Object.values(pairs).forEach(pr => {
      const avg = (players[pr.ids[0]].rating + players[pr.ids[1]].rating) / 2;
      pr.level = ratingToLevel(pr.rating);
      pr.chemistry = (pr.rating - avg) / PER_LEVEL; // em pontos de nível: +0,3 = jogam 0,3 acima da média deles
    });
    return { players, pairs };
  }

  // Rankings: só quem já jogou; parelhas com pelo menos 2 jogos juntas.
  function rankPlayers(players, minGames = 1) {
    return Object.entries(players).filter(([, p]) => p.games >= minGames)
      .map(([id, p]) => ({ id, ...p })).sort((a, b) => b.rating - a.rating);
  }
  function rankPairs(pairs, minGames = 2) {
    return Object.values(pairs).filter(p => p.games >= minGames).sort((a, b) => b.rating - a.rating);
  }

  // Previsão para mostrar antes do jogo: probabilidade de a equipa A ganhar (0–1).
  function winProbability(teamALevels, teamBLevels) {
    const r = (ls) => ls.reduce((s, l) => s + levelToRating(l), 0) / ls.length;
    return expected(r(teamALevels), r(teamBLevels));
  }

  const api = { computeRatings, rankPlayers, rankPairs, winProbability, winnerFromSets, marginMultiplier, gamesTotals,
    levelToRating, ratingToLevel, expected, kFactor, pairKey, PROVISIONAL_GAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rating = api;
})(typeof window !== 'undefined' ? window : globalThis);
