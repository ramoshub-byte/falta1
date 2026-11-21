/* Marcador de padel — I Want to Play Padle (POC)
 *
 * O jogo guarda só a lista de pontos ('a' ou 'b'). O marcador é recalculado a partir dela,
 * por isso "anular" é só tirar o último ponto, e o estado sobrevive a um recarregar da página.
 *
 * Regras:
 *  - jogos a 15/30/40; em 40-40, ponto de ouro (o próximo ponto ganha) ou vantagens, conforme a configuração;
 *  - sets a 6 jogos com 2 de diferença; em 6-6, tie-break a 7 pontos com 2 de diferença (o set fica 7-6);
 *  - à melhor de 3 sets; com super tie-break, o 3.º set é um tie-break a 10 pontos (fica registado como 10-8, por ex.).
 */
(function (root) {
  const DEFAULTS = { goldenPoint: true, superTiebreak: true, setsToWin: 2 };
  const LABELS = ['0', '15', '30', '40'];
  const other = (t) => (t === 'a' ? 'b' : 'a');

  function compute(points, config) {
    const cfg = { ...DEFAULTS, ...(config || {}) };
    const s = { sets: [], setsWon: { a: 0, b: 0 }, games: { a: 0, b: 0 }, pts: { a: 0, b: 0 },
      tiebreak: false, superTiebreak: false, finished: false, winner: null, config: cfg };

    const resetGame = () => { s.pts = { a: 0, b: 0 }; };
    function winSet(t, record) {
      s.sets.push(record); s.setsWon[t]++;
      s.games = { a: 0, b: 0 }; resetGame(); s.tiebreak = false; s.superTiebreak = false;
      if (s.setsWon[t] >= cfg.setsToWin) { s.finished = true; s.winner = t; return; }
      if (cfg.superTiebreak && s.setsWon.a === cfg.setsToWin - 1 && s.setsWon.b === cfg.setsToWin - 1) s.superTiebreak = true;
    }

    for (const t of points) {
      if (s.finished) break;
      if (t !== 'a' && t !== 'b') continue;
      const o = other(t);
      s.pts[t]++;
      if (s.tiebreak || s.superTiebreak) {
        const target = s.superTiebreak ? 10 : 7;
        if (s.pts[t] >= target && s.pts[t] - s.pts[o] >= 2) {
          if (s.superTiebreak) winSet(t, [s.pts.a, s.pts.b]);
          else { s.games[t]++; winSet(t, [s.games.a, s.games.b]); }
        }
        continue;
      }
      const gameWon = cfg.goldenPoint ? s.pts[t] >= 4 && (s.pts[t] - s.pts[o] >= 2 || s.pts[o] === 3)
                                      : s.pts[t] >= 4 && s.pts[t] - s.pts[o] >= 2;
      if (!gameWon) continue;
      s.games[t]++; resetGame();
      if (s.games[t] >= 6 && s.games[t] - s.games[o] >= 2) winSet(t, [s.games.a, s.games.b]);
      else if (s.games.a === 6 && s.games.b === 6) s.tiebreak = true;
    }
    return s;
  }

  // Texto dos pontos do jogo atual, para cada equipa, e uma nota (ponto de ouro, vantagem…).
  function pointDisplay(s) {
    const { a, b } = s.pts;
    if (s.finished) return { a: '', b: '', note: 'Jogo terminado' };
    if (s.tiebreak || s.superTiebreak) return { a: String(a), b: String(b), note: s.superTiebreak ? 'Super tie-break (a 10)' : 'Tie-break (a 7)' };
    if (a >= 3 && b >= 3) {
      if (a === b) return { a: '40', b: '40', note: s.config.goldenPoint ? 'Ponto de ouro' : 'Iguais' };
      return a > b ? { a: 'AD', b: '40', note: 'Vantagem' } : { a: '40', b: 'AD', note: 'Vantagem' };
    }
    return { a: LABELS[a], b: LABELS[b], note: '' };
  }

  // Sets fechados + o set em curso (se já houver jogos), ex.: "6-4, 3-6, 2-1".
  function format(s, { includeCurrent = false } = {}) {
    const parts = s.sets.map(([x, y]) => `${x}-${y}`);
    if (includeCurrent && !s.finished && (s.games.a || s.games.b)) parts.push(`${s.games.a}-${s.games.b}`);
    return parts.join(', ');
  }

  // Lê um resultado escrito à mão ("6-4, 3-6, 10-8") → [[6,4],[3,6],[10,8]] ou null se não fizer sentido.
  function parseSets(text) {
    const parts = String(text || '').split(/[,;\s]+/).filter(Boolean);
    if (!parts.length || parts.length > 3) return null;
    const sets = [];
    for (const p of parts) {
      const m = p.match(/^(\d{1,2})[-–/:](\d{1,2})$/);
      if (!m) return null;
      const x = +m[1], y = +m[2];
      if (x === y || Math.max(x, y) > 20) return null;
      sets.push([x, y]);
    }
    return sets;
  }

  const api = { compute, pointDisplay, format, parseSets, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scorer = api;
})(typeof window !== 'undefined' ? window : globalThis);
