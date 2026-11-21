/* Motor de matchmaking — Falta 1 (POC)
 *
 * Entrada: o jogador que quer jogar (sozinho ou com parceiro), a lista de jogadores e de clubes.
 * Saída: até N jogos propostos. Cada jogo tem um horário, duas equipas e os clubes possíveis
 * ordenados pela distância total dos 4 jogadores.
 *
 * Regras:
 *  - os 4 têm de estar disponíveis no mesmo dia/bloco;
 *  - tem de haver pelo menos um clube dentro do raio de TODOS os 4;
 *  - diferença máxima de nível entre o melhor e o pior: MAX_SPREAD;
 *  - pontuação (menor = melhor) combina equilíbrio das equipas, homogeneidade de nível,
 *    compatibilidade de lado (direita/esquerda) e distância a percorrer;
 *  - feedback: jogadores menos fiáveis que quem pede jogo penalizam (junta fiáveis com fiáveis);
 *    clubes bem avaliados contam como se estivessem um pouco mais perto (desempate).
 */
(function (root) {
  const MAX_SPREAD = 2.0;     // diferença máxima de nível dentro do jogo
  const MAX_CANDIDATES = 14;  // limite por horário, para as combinações não explodirem

  const WEIGHTS = {
    teamDiff: 3.0,   // por ponto de diferença entre médias das equipas
    spread: 0.8,     // por ponto entre o melhor e o pior jogador
    sideConflict: 0.7, // por equipa com dois jogadores do mesmo lado fixo
    travelKm: 0.08,  // por km médio até ao clube
    keepPair: -0.4,  // bónus se uma dupla habitual fica junta
    reliability: 2.0 // por ponto (0–1) de fiabilidade abaixo da de quem pede jogo
  };
  const DEFAULT_RELIABILITY = 0.8; // jogador sem avaliações
  const CLUB_RATING_KM = 0.5;      // cada estrela acima/abaixo de 3 vale 0,5 km no total

  function haversineKm(a, b) {
    const R = 6371, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function sidesConflict(a, b) {
    return a.side !== 'ambos' && b.side !== 'ambos' && a.side === b.side;
  }

  function avg(team) { return team.reduce((s, p) => s + p.level, 0) / team.length; }

  function combinations(arr, k) {
    const out = [];
    (function rec(start, acc) {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
    })(0, []);
    return out;
  }

  function clubsInRange(player, clubs) {
    return new Set(clubs.filter(c => haversineKm(player, c) <= player.radiusKm).map(c => c.id));
  }

  // Clubes ao alcance dos 4, ordenados pela distância total.
  function rankClubs(four, clubs) {
    return clubs
      .filter(c => four.every(p => haversineKm(p, c) <= p.radiusKm))
      .map(c => {
        const distances = four.map(p => ({ playerId: p.id, km: haversineKm(p, c) }));
        const totalKm = distances.reduce((s, d) => s + d.km, 0);
        const adjustedKm = totalKm - (typeof c.rating === 'number' ? (c.rating - 3) * CLUB_RATING_KM : 0);
        return { club: c, totalKm, adjustedKm, avgKm: totalKm / 4, distances };
      })
      .sort((a, b) => a.adjustedKm - b.adjustedKm);
  }

  function scoreTeams(teamA, teamB, rankedClubs) {
    const all = [...teamA, ...teamB];
    const levels = all.map(p => p.level);
    const teamDiff = Math.abs(avg(teamA) - avg(teamB));
    const spread = Math.max(...levels) - Math.min(...levels);
    const conflicts = (sidesConflict(teamA[0], teamA[1]) ? 1 : 0) + (sidesConflict(teamB[0], teamB[1]) ? 1 : 0);
    const keptPairs = [teamA, teamB].filter(t => t[0].pairId && t[0].pairId === t[1].pairId).length;
    const travel = rankedClubs.length ? rankedClubs[0].avgKm : 99;
    const score =
      WEIGHTS.teamDiff * teamDiff + WEIGHTS.spread * spread + WEIGHTS.sideConflict * conflicts +
      WEIGHTS.travelKm * travel + WEIGHTS.keepPair * keptPairs;
    // "Equilíbrio" em % para mostrar ao utilizador: 100% = médias iguais, 0% = 1,5 pontos ou mais.
    const balance = Math.max(0, Math.round(100 - (teamDiff / 1.5) * 100));
    return { score, teamDiff, spread, conflicts, balance };
  }

  // Divide 4 jogadores nas 3 combinações possíveis de equipas e devolve a melhor.
  // Se "fixedTeam" for dado (dupla que pediu jogo), essa equipa não se separa.
  function bestSplit(four, rankedClubs, fixedTeam) {
    const [a, b, c, d] = four;
    let splits = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
    if (fixedTeam) {
      const ids = new Set(fixedTeam.map(p => p.id));
      const rest = four.filter(p => !ids.has(p.id));
      splits = [[fixedTeam, rest]];
    }
    let best = null;
    for (const [tA, tB] of splits) {
      const s = scoreTeams(tA, tB, rankedClubs);
      if (!best || s.score < best.score) best = { teamA: tA, teamB: tB, ...s };
    }
    return best;
  }

  /**
   * @param {object} opts
   * @param {object} opts.me        jogador que pede jogo
   * @param {object|null} opts.partner  parceiro (modo dupla) ou null (modo sozinho)
   * @param {object[]} opts.players todos os jogadores registados
   * @param {object[]} opts.clubs
   * @param {number} [opts.max=3]
   * @returns {{matches: object[], diagnostics: object}}
   */
  function suggestMatches({ me, partner = null, players, clubs, max = 3 }) {
    const anchors = partner ? [me, partner] : [me];
    const anchorIds = new Set(anchors.map(p => p.id));
    const anchorLevel = avg(anchors);
    const rel = (p) => (typeof p.reliability === 'number' ? p.reliability : DEFAULT_RELIABILITY);
    const anchorRel = Math.min(...anchors.map(rel));
    const anchorClubs = anchors.map(p => clubsInRange(p, clubs));
    const sharedAnchorClubs = [...anchorClubs[0]].filter(id => anchorClubs.every(s => s.has(id)));

    const diagnostics = { slotsChecked: 0, noClubInRange: sharedAnchorClubs.length === 0, slotsWithoutPlayers: [] };
    if (diagnostics.noClubInRange) return { matches: [], diagnostics };

    const slots = me.availability.filter(s => !partner || partner.availability.includes(s));
    diagnostics.noCommonSlot = slots.length === 0;

    const pool = players.filter(p => !anchorIds.has(p.id));
    const found = [];

    for (const slot of slots) {
      diagnostics.slotsChecked++;
      const candidates = pool
        .filter(p => p.availability.includes(slot))
        .filter(p => Math.abs(p.level - anchorLevel) <= MAX_SPREAD)
        .filter(p => { const r = clubsInRange(p, clubs); return sharedAnchorClubs.some(id => r.has(id)); })
        .sort((x, y) => Math.abs(x.level - anchorLevel) - Math.abs(y.level - anchorLevel))
        .slice(0, MAX_CANDIDATES);

      const need = 4 - anchors.length;
      if (candidates.length < need) { diagnostics.slotsWithoutPlayers.push(slot); continue; }

      for (const others of combinations(candidates, need)) {
        const four = [...anchors, ...others];
        const levels = four.map(p => p.level);
        if (Math.max(...levels) - Math.min(...levels) > MAX_SPREAD) continue;
        const ranked = rankClubs(four, clubs);
        if (!ranked.length) continue;
        const split = bestSplit(four, ranked, partner ? anchors : null);
        const relGap = others.reduce((sum, p) => sum + Math.max(0, anchorRel - rel(p)), 0);
        split.score += WEIGHTS.reliability * relGap;
        found.push({ slot, ...split, relGap, clubs: ranked, playerIds: four.map(p => p.id).sort() });
      }
    }

    found.sort((x, y) => x.score - y.score);

    // Escolher propostas variadas: horários diferentes primeiro, e nunca o mesmo grupo de 4.
    const picked = [];
    const usedSlots = new Set(), usedGroups = new Set();
    for (const pass of [true, false]) {
      for (const m of found) {
        if (picked.length >= max) break;
        const g = m.playerIds.join(',');
        if (usedGroups.has(g)) continue;
        if (pass && usedSlots.has(m.slot)) continue;
        picked.push(m); usedSlots.add(m.slot); usedGroups.add(g);
      }
    }
    diagnostics.combinationsScored = found.length;
    return { matches: picked, diagnostics };
  }

  const api = { suggestMatches, haversineKm, rankClubs, sidesConflict, WEIGHTS, MAX_SPREAD, DEFAULT_RELIABILITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Matchmaking = api;
})(typeof window !== 'undefined' ? window : globalThis);
