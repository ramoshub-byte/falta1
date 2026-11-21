/* Dados do piloto: Chaves.
 * As coordenadas dos clubes são APROXIMADAS — confirmar no Google Maps antes de usar com jogadores reais.
 * Os jogadores são fictícios, só para testar o matchmaking.
 */
(function (root) {
  const CITY_CENTER = { lat: 41.7404, lng: -7.4702 }; // Chaves

  const DAYS = [
    { id: 'seg', label: 'Seg' }, { id: 'ter', label: 'Ter' }, { id: 'qua', label: 'Qua' },
    { id: 'qui', label: 'Qui' }, { id: 'sex', label: 'Sex' }, { id: 'sab', label: 'Sáb' },
    { id: 'dom', label: 'Dom' }
  ];
  const BLOCKS = [
    { id: 'manha', label: 'Manhã', hours: '9h–13h' },
    { id: 'tarde', label: 'Tarde', hours: '13h–19h' },
    { id: 'noite', label: 'Noite', hours: '19h–23h' }
  ];

  const LEVELS = [
    [0, 'Nunca joguei'], [1, 'Iniciante'], [2, 'Iniciante com alguns jogos'],
    [3, 'Intermédio — mantenho a bola em jogo'], [4, 'Intermédio-avançado — uso paredes e vólei'],
    [5, 'Avançado — jogo torneios locais'], [6, 'Muito avançado — competição regular'],
    [7, 'Profissional / federado de topo']
  ];

  const CLUBS = [
    {
      id: 'cpc', name: 'Chaves Padel Center', short: 'Padel Center',
      address: 'R. Dom Afonso III 44, 5400-027 Chaves',
      lat: 41.7445, lng: -7.4640, approx: true,
      courts: '3 campos indoor', hours: '09:00–23:00',
      bookingUrl: 'https://playtomic.com/clubs/chaves-padel-center'
    },
    {
      id: 'aquae-hospicio', name: 'Aquae Padel — Quinta do Hospício', short: 'Aquae Hospício',
      address: 'Vilar de Nantes, Chaves',
      lat: 41.7280, lng: -7.4520, approx: true,
      courts: '2 cobertos + 1 descoberto', hours: '08:00–01:00',
      bookingUrl: 'https://playtomic.com/clubs/aquae-padel'
    },
    {
      id: 'aquae-caldas', name: 'Aquae Padel — Caldas', short: 'Aquae Caldas',
      address: 'Zona das Caldas, Chaves',
      lat: 41.7378, lng: -7.4670, approx: true,
      courts: '2 campos descobertos', hours: '08:00–01:00',
      bookingUrl: 'https://playtomic.com/clubs/aquae-padel'
    },
    {
      id: 'verin', name: 'Verín Pádel Indoor (ES)', short: 'Verín',
      address: 'Polígono Ciudad del Transporte, Nave 4, 32600 Verín',
      lat: 41.9480, lng: -7.4260, approx: true,
      courts: '4 campos', hours: '—',
      bookingUrl: 'https://www.google.com/maps/search/?api=1&query=Ver%C3%ADn+P%C3%A1del+Indoor'
    }
  ];

  // Jogadores fictícios à volta de Chaves.
  // a = disponibilidade: lista de "dia-bloco"
  const W = ['seg', 'ter', 'qua', 'qui', 'sex'];
  const nights = (days) => days.map(d => d + '-noite');
  const P = (id, name, level, side, dLat, dLng, a, radius, pairId) => ({
    id, name, level, side,
    lat: +(CITY_CENTER.lat + dLat).toFixed(5), lng: +(CITY_CENTER.lng + dLng).toFixed(5),
    availability: a, radiusKm: radius, pairId: pairId || null, fake: true
  });

  const PLAYERS = [
    P('p1', 'Rui Teixeira', 3.0, 'direita', 0.004, 0.002, [...nights(W), 'sab-manha'], 8),
    P('p2', 'Ana Morais', 3.5, 'esquerda', -0.003, 0.006, [...nights(['seg', 'qua', 'sex']), 'sab-manha', 'dom-manha'], 6),
    P('p3', 'Tiago Pereira', 4.0, 'esquerda', 0.010, -0.004, [...nights(['ter', 'qui']), 'sab-tarde'], 10, 'dupla-1'),
    P('p4', 'João Carvalho', 4.0, 'direita', 0.011, -0.003, [...nights(['ter', 'qui']), 'sab-tarde'], 10, 'dupla-1'),
    P('p5', 'Marta Alves', 2.5, 'direita', -0.006, -0.008, ['qua-noite', 'sab-manha', 'dom-manha', 'dom-tarde'], 5),
    P('p6', 'Pedro Gonçalves', 2.0, 'ambos', -0.002, 0.012, ['seg-noite', 'qua-noite', 'sab-manha'], 6),
    P('p7', 'Sofia Rodrigues', 3.0, 'esquerda', 0.006, 0.009, [...nights(['seg', 'ter', 'qui']), 'dom-manha'], 7),
    P('p8', 'Miguel Sousa', 5.0, 'esquerda', 0.015, 0.001, [...nights(W)], 15),
    P('p9', 'Carlos Fernandes', 4.5, 'direita', -0.012, 0.003, [...nights(['seg', 'qua', 'sex']), 'sab-tarde'], 12),
    P('p10', 'Inês Machado', 1.5, 'ambos', 0.001, -0.006, ['sab-manha', 'dom-manha', 'qua-tarde'], 4),
    P('p11', 'Bruno Lopes', 3.5, 'direita', -0.008, -0.002, [...nights(['ter', 'qua', 'qui']), 'sab-manha'], 8),
    P('p12', 'Diogo Barros', 3.0, 'ambos', 0.003, 0.015, [...nights(['seg', 'qui', 'sex'])], 6),
    P('p13', 'Catarina Fontes', 2.5, 'esquerda', -0.004, -0.011, ['ter-noite', 'qui-noite', 'sab-manha', 'dom-tarde'], 5),
    P('p14', 'Nuno Ferreira', 4.5, 'esquerda', 0.020, -0.010, [...nights(['seg', 'qua', 'sex']), 'dom-manha'], 20),
    P('p15', 'Hugo Dias', 3.5, 'esquerda', -0.010, 0.010, [...nights(['seg', 'ter', 'qua']), 'sab-manha'], 9, 'dupla-2'),
    P('p16', 'Filipe Costa', 3.5, 'direita', -0.010, 0.011, [...nights(['seg', 'ter', 'qua']), 'sab-manha'], 9, 'dupla-2'),
    P('p17', 'Rita Pinto', 2.0, 'direita', 0.007, -0.009, ['seg-noite', 'sab-manha', 'dom-manha'], 5),
    P('p18', 'André Ribeiro', 5.5, 'direita', 0.025, 0.020, [...nights(['ter', 'qui']), 'sab-tarde', 'dom-tarde'], 25),
    P('p19', 'Luís Martins', 3.0, 'direita', -0.001, 0.003, [...nights(['qua', 'qui', 'sex']), 'sab-tarde'], 6),
    P('p20', 'Joana Silva', 3.0, 'ambos', 0.002, -0.002, [...nights(['seg', 'qua']), 'sab-manha', 'sab-tarde'], 5),
    P('p21', 'Ricardo Moura', 4.0, 'ambos', -0.015, -0.006, [...nights(['qua', 'sex']), 'sab-tarde', 'dom-manha'], 12),
    P('p22', 'Vasco Antunes', 2.5, 'esquerda', 0.009, 0.004, ['ter-noite', 'qua-noite', 'sab-manha'], 6),
    P('p23', 'Daniela Nogueira', 3.5, 'esquerda', 0.012, 0.012, [...nights(['seg', 'qui']), 'dom-tarde'], 8),
    P('p24', 'Manuel Gomes', 2.0, 'esquerda', -0.005, 0.001, ['seg-noite', 'qua-noite', 'sex-noite', 'dom-manha'], 5)
  ];

  // Avaliações fictícias de jogos anteriores (só jogadores de teste — os clubes começam sem avaliações).
  // forms = nº de avaliações recebidas; yes/total = respostas "sim" às perguntas pontual / fair play / voltava a jogar.
  const SEED_PLAYER_RATINGS = {
    p8: { forms: 6, yes: 17, total: 18 },
    p3: { forms: 4, yes: 12, total: 12 },
    p4: { forms: 4, yes: 11, total: 12 },
    p20: { forms: 3, yes: 9, total: 9 },
    p19: { forms: 3, yes: 4, total: 9 },
    p12: { forms: 5, yes: 7, total: 15 }
  };

  // Resultados fictícios de jogos anteriores (15 set – 14 nov 2026), para o ranking não começar vazio.
  // Gerados sempre iguais (semente fixa). Cada jogador tem um "nível real" um pouco diferente do que declarou,
  // para se ver o nível a corrigir-se com os jogos. As duplas habituais (dupla-1, dupla-2) jogam muitas vezes juntas.
  const SEED_RESULTS = (function () {
    let seed = 20261116;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const trueLevel = Object.fromEntries(PLAYERS.map(p => [p.id, p.level + (rnd() - 0.5) * 1.2]));
    const byId = Object.fromEntries(PLAYERS.map(p => [p.id, p]));
    const duos = [['p3', 'p4'], ['p15', 'p16']];
    const out = [];
    const start = new Date(2026, 8, 15);
    for (let i = 0; i < 48; i++) {
      const d = new Date(start); d.setDate(start.getDate() + Math.floor(i * 60 / 48));
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // Âncora + 3 jogadores de nível parecido.
      const anchorPair = i % 4 === 0 ? duos[(i / 4) % 2] : null;
      const anchor = anchorPair ? byId[anchorPair[0]] : pick(PLAYERS);
      const near = PLAYERS.filter(p => p.id !== anchor.id && (!anchorPair || p.id !== anchorPair[1]) && Math.abs(p.level - anchor.level) <= 1)
        .sort(() => rnd() - 0.5);
      const need = anchorPair ? 2 : 3;
      if (near.length < need) continue;
      let teamA, teamB;
      if (anchorPair) { teamA = anchorPair.slice(); teamB = near.slice(0, 2).map(p => p.id); }
      else {
        const four = [anchor, ...near.slice(0, 3)].sort((x, y) => y.level - x.level).map(p => p.id);
        teamA = [four[0], four[3]]; teamB = [four[1], four[2]]; // o melhor com o pior, para equilibrar
      }
      const avg = (t) => t.reduce((s, id) => s + trueLevel[id], 0) / 2;
      const pA = 1 / (1 + Math.pow(10, (avg(teamB) - avg(teamA)) * 200 / 400));
      const aWins = rnd() < pA;
      const loserGames = () => pick([1, 2, 3, 3, 4, 4, 5]);
      const set = (aWon) => { const g = loserGames(); const w = g === 5 ? 7 : 6; return aWon ? [w, g] : [g, w]; };
      let sets;
      if (rnd() < 0.3) sets = [set(aWins), set(!aWins), aWins ? [10, pick([5, 6, 7, 8])] : [pick([5, 6, 7, 8]), 10]];
      else sets = [set(aWins), set(aWins)];
      out.push({ id: 'seed' + i, date, teamA, teamB, sets, winner: aWins ? 'a' : 'b' });
    }
    return out;
  })();

  const api = { CITY_CENTER, DAYS, BLOCKS, LEVELS, CLUBS, PLAYERS, SEED_PLAYER_RATINGS, SEED_RESULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PadelData = api;
})(typeof window !== 'undefined' ? window : globalThis);
