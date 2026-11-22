/* Campeonato da época — Falta 1
 *
 * A época é o ano civil. É separada do nível (Elo, js/rating.js): o nível mede quanto jogas e serve
 * o matchmaking; a época mede o que fazes este ano e recomeça a zeros em janeiro.
 *
 * Pontos (valores em DEFAULT_RULES, um só sítio para afinar):
 *  - Jogo casual confirmado: vitória 10, derrota 3.
 *  - Bónus de surpresa: +5 a quem ganha quando a app lhe dava menos de 40% de probabilidade.
 *  - Anti-repetição: contra os MESMOS 4 jogadores só contam 2 jogos por semana para os pontos
 *    (os jogos a mais contam nas estatísticas, não nos pontos).
 *  - Torneio: pontos pela posição final — campeão 60, finalista 40, meias 25, quartos 15, participação 10.
 *    Os jogos de um torneio não dão os 10/3 (para não contar duas vezes), mas contam para jogos e vitórias.
 *
 * Divisões (A ≥ 4,5 · B ≥ 3 · C abaixo): pelo nível no início da época, fixas o ano todo.
 * Quem começa a época com menos de 5 jogos no total (nível provisório) fica na divisão do nível
 * que tiver ao 5.º jogo — assim ninguém se declara mais fraco para ganhar uma divisão abaixo.
 *
 * Desempate: vitórias → % de vitórias → saldo de jogos (games). Só entra na tabela quem tem pelo menos 3 jogos.
 */
(function (root) {
  const Rating = root.Rating || (typeof require !== 'undefined' ? require('./rating.js') : null);

  const DEFAULT_RULES = {
    casual: { win: 10, loss: 3, upsetBonus: 5, upsetBelow: 0.40, maxSameFourPerWeek: 2 },
    tournament: { campeao: 60, finalista: 40, meias: 25, quartos: 15, participacao: 10 },
    divisions: [
      { id: 'A', name: 'Divisão A', min: 4.5 },
      { id: 'B', name: 'Divisão B', min: 3 },
      { id: 'C', name: 'Divisão C', min: 0 }
    ],
    minGames: 3,
    provisionalGames: 5
  };

  const PLACE_LABELS = { campeao: 'Campeão', finalista: 'Finalista', meias: 'Meias-finais', quartos: 'Quartos de final', participacao: 'Participação' };
  const PLACE_ORDER = ['campeao', 'finalista', 'meias', 'quartos', 'participacao'];

  // Semana ISO (segunda a domingo) como 'AAAA-Wnn'.
  function isoWeek(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = (dt.getUTCDay() + 6) % 7;            // 0 = segunda
    dt.setUTCDate(dt.getUTCDate() - day + 3);        // quinta-feira desta semana
    const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function divisionFor(level, rules) {
    return rules.divisions.find(d => level >= d.min) || rules.divisions[rules.divisions.length - 1];
  }

  /**
   * @param {object} o
   * @param {number} o.year
   * @param {object[]} o.results  resultados confirmados (como em rating.js); os de torneio trazem tournamentId
   * @param {Object<string,number>} o.initialLevels  id → nível declarado
   * @param {object[]} [o.tournaments]  torneios terminados: [{ id, name, date, placements: { id: 'campeao'|… } }]
   * @param {object} [o.rules]
   */
  function computeSeason({ year, results = [], initialLevels = {}, tournaments = [], rules = DEFAULT_RULES }) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const upToEnd = results.filter(r => r.date <= end);
    const prior = upToEnd.filter(r => r.date < start);

    const startRatings = Rating.computeRatings({ initialLevels, results: prior }).players;
    const rows = {};
    const row = (id) => rows[id] || (rows[id] = {
      id, points: 0, casualPoints: 0, tournamentPoints: 0, bonuses: 0, capped: 0,
      games: 0, wins: 0, losses: 0, gamesFor: 0, gamesAgainst: 0, tournaments: [], division: null
    });

    const weekly = {};
    const full = Rating.computeRatings({
      initialLevels, results: upToEnd,
      onGame(r, { winner, eA }) {
        if (r.date < start) return;
        const totals = Rating.gamesTotals(r.sets);
        const sides = [{ ids: r.teamA, won: winner === 'a', e: eA, gf: totals.a, ga: totals.b },
                       { ids: r.teamB, won: winner === 'b', e: 1 - eA, gf: totals.b, ga: totals.a }];
        let counts = true;
        if (!r.tournamentId) {
          const key = isoWeek(r.date) + '|' + [...r.teamA, ...r.teamB].slice().sort().join(',');
          weekly[key] = (weekly[key] || 0) + 1;
          counts = weekly[key] <= rules.casual.maxSameFourPerWeek;
        }
        for (const s of sides) for (const id of s.ids) {
          const p = row(id);
          p.games++; if (s.won) p.wins++; else p.losses++;
          p.gamesFor += s.gf; p.gamesAgainst += s.ga;
          if (r.tournamentId) continue;
          if (!counts) { p.capped++; continue; }
          let pts = s.won ? rules.casual.win : rules.casual.loss;
          if (s.won && s.e < rules.casual.upsetBelow) { pts += rules.casual.upsetBonus; p.bonuses++; }
          p.casualPoints += pts; p.points += pts;
        }
      }
    }).players;

    for (const t of tournaments) {
      if (!t.placements || !t.date || t.date < start || t.date > end) continue;
      for (const [id, place] of Object.entries(t.placements)) {
        const pts = rules.tournament[place] || 0;
        const p = row(id);
        p.tournamentPoints += pts; p.points += pts;
        p.tournaments.push({ id: t.id, name: t.name, date: t.date, place, points: pts });
      }
    }

    // Divisão de cada jogador (fixa na época).
    Object.values(rows).forEach(p => {
      const s = startRatings[p.id];
      const priorGames = s ? s.games : 0;
      let level;
      p.divisionProvisional = false;
      if (priorGames >= rules.provisionalGames) level = s.level;
      else {
        const h = full[p.id] ? full[p.id].history : [];
        const idx = rules.provisionalGames - 1;
        level = h[idx] ? h[idx].level : (full[p.id] ? full[p.id].level : (initialLevels[p.id] != null ? initialLevels[p.id] : 3));
        p.divisionProvisional = !h[idx]; // ainda não chegou ao 5.º jogo: a divisão pode mudar
      }
      p.divisionLevel = level;
      p.division = divisionFor(level, rules).id;
      p.winPct = p.games ? p.wins / p.games : 0;
      p.diff = p.gamesFor - p.gamesAgainst;
    });

    const cmp = (a, b) => b.points - a.points || b.wins - a.wins || b.winPct - a.winPct || b.diff - a.diff || String(a.id).localeCompare(String(b.id));
    const all = Object.values(rows).sort(cmp);
    const divisions = rules.divisions.map(d => {
      const inDiv = all.filter(p => p.division === d.id);
      const ranked = inDiv.filter(p => p.games >= rules.minGames);
      ranked.forEach((p, i) => { p.position = i + 1; });
      return { ...d, ranked, pending: inDiv.filter(p => p.games < rules.minGames) };
    });
    const top = (key, n = 5) => all.filter(p => p.games > 0).slice().sort((a, b) => b[key] - a[key] || cmp(a, b)).slice(0, n);
    return { year, rules, rows, divisions, leaders: { points: top('points'), wins: top('wins'), games: top('games') } };
  }

  // Texto da explicação, mostrado no rodapé do ranking e na página de cada torneio.
  function explain(rules = DEFAULT_RULES) {
    const c = rules.casual, t = rules.tournament, pct = Math.round(c.upsetBelow * 100);
    const divs = rules.divisions.map((d, i) => {
      const next = rules.divisions[i - 1];
      return next ? `${d.name}: nível ${fmt(d.min)} a ${fmt(next.min - 0.01)}` : `${d.name}: nível ${fmt(d.min)} ou mais`;
    });
    return {
      title: 'Como se calcula o ranking da época',
      items: [
        `A época é o ano civil e recomeça a zeros em janeiro. Só contam resultados confirmados pelas duas equipas.`,
        `Jogo casual: vitória ${c.win} pontos, derrota ${c.loss} pontos.`,
        `Bónus de surpresa: +${c.upsetBonus} pontos a quem ganha quando a app lhe dava menos de ${pct}% de probabilidade de ganhar.`,
        `Contra os mesmos 4 jogadores contam no máximo ${c.maxSameFourPerWeek} jogos por semana para os pontos. Os jogos a mais contam nas estatísticas.`,
        `Torneio, pela posição final: campeão ${t.campeao}, finalista ${t.finalista}, meias-finais ${t.meias}, quartos de final ${t.quartos}, participação ${t.participacao}. Os jogos do torneio contam para jogos e vitórias, mas não dão os ${c.win}/${c.loss} pontos dos jogos casuais.`,
        `Divisões pelo nível no início da época, fixas o ano todo — ${divs.join(' · ')}. Quem começa com menos de ${rules.provisionalGames} jogos fica na divisão do nível que tiver ao ${rules.provisionalGames}.º jogo.`,
        `Desempate: mais vitórias, depois maior % de vitórias, depois maior saldo de jogos. Aparece na tabela quem tiver pelo menos ${rules.minGames} jogos.`
      ]
    };
  }
  function fmt(n) { return Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }

  const api = { DEFAULT_RULES, PLACE_LABELS, PLACE_ORDER, computeSeason, explain, isoWeek, divisionFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Season = api;
})(typeof window !== 'undefined' ? window : globalThis);
