// Correr com: node tests/rating.test.js
const assert = require('assert');
const R = require('../js/rating.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('escala: nível 0 = 1000, nível 7 = 2400, e volta', () => {
  assert.strictEqual(R.levelToRating(0), 1000);
  assert.strictEqual(R.levelToRating(7), 2400);
  assert(near(R.ratingToLevel(R.levelToRating(3.25)), 3.25));
});

test('equipas iguais: 50% de probabilidade', () => {
  assert(near(R.winProbability([3, 3], [3, 3]), 0.5));
});

test('equipa mais forte é favorita', () => {
  assert(R.winProbability([4, 4], [3, 3]) > 0.7);
});

test('multiplicador: 6-0 6-0 vale 1,5; jogo renhido fica perto de 1', () => {
  assert(near(R.marginMultiplier([[6, 0], [6, 0]], 'a'), 1.5));
  const tight = R.marginMultiplier([[7, 6], [6, 7], [10, 8]], 'a');
  assert(tight >= 1 && tight < 1.1, tight);
});

test('vencedor a partir dos sets, incluindo super tie-break', () => {
  assert.strictEqual(R.winnerFromSets([[6, 4], [3, 6], [10, 7]]), 'a');
  assert.strictEqual(R.winnerFromSets([[4, 6], [2, 6]]), 'b');
});

const lv = { a: 3, b: 3, c: 3, d: 3 };

test('jogo entre iguais: quem ganha sobe, quem perde desce o mesmo', () => {
  const { players } = R.computeRatings({ initialLevels: lv,
    results: [{ id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 4], [6, 4]] }] });
  const up = players.a.rating - 1600, down = players.c.rating - 1600;
  assert(up > 0 && near(up, -down));
  assert.strictEqual(players.a.wins, 1);
  assert.strictEqual(players.c.losses, 1);
});

test('vitória inesperada vale mais do que vitória esperada', () => {
  const surprise = R.computeRatings({ initialLevels: { a: 2, b: 2, c: 4, d: 4 },
    results: [{ id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 4], [6, 4]] }] }).players;
  const normal = R.computeRatings({ initialLevels: { a: 4, b: 4, c: 2, d: 2 },
    results: [{ id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 4], [6, 4]] }] }).players;
  assert((surprise.a.rating - R.levelToRating(2)) > (normal.a.rating - R.levelToRating(4)));
});

test('K desce com a experiência: o 40.º jogo mexe menos do que o 1.º', () => {
  const results = [];
  for (let i = 0; i < 40; i++) {
    const day = String(i + 1).padStart(2, '0');
    // alterna vencedores para os ratings ficarem parecidos
    results.push({ id: i, date: `2026-10-${day > '31' ? '31' : day}`, teamA: ['a', 'b'], teamB: ['c', 'd'], sets: i % 2 ? [[4, 6], [4, 6]] : [[6, 4], [6, 4]] });
  }
  assert.strictEqual(R.kFactor(0), 48);
  assert.strictEqual(R.kFactor(40), 16);
  const { players } = R.computeRatings({ initialLevels: lv, results });
  assert.strictEqual(players.a.games, 40);
  assert(!players.a.provisional);
});

test('parelha tem rating próprio e química positiva quando ganha mais do que o esperado', () => {
  // a+b ganham sempre juntos; separados, a e b perdem.
  const results = [
    { id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 2], [6, 3]] },
    { id: 2, date: '2026-11-02', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 3], [6, 2]] },
    { id: 3, date: '2026-11-03', teamA: ['a', 'e'], teamB: ['c', 'd'], sets: [[2, 6], [3, 6]] },
    { id: 4, date: '2026-11-04', teamA: ['b', 'f'], teamB: ['c', 'd'], sets: [[2, 6], [3, 6]] }
  ];
  const { pairs } = R.computeRatings({ initialLevels: { ...lv, e: 3, f: 3 }, results });
  const ab = pairs[R.pairKey('a', 'b')];
  assert.strictEqual(ab.games, 2);
  assert(ab.chemistry > 0, ab.chemistry);
  const ranked = R.rankPairs(pairs);
  assert.strictEqual(ranked[0].key, R.pairKey('a', 'b'));
});

test('a ordem de entrada não interessa: os resultados são ordenados por data', () => {
  const r1 = { id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 4], [6, 4]] };
  const r2 = { id: 2, date: '2026-11-02', teamA: ['a', 'c'], teamB: ['b', 'd'], sets: [[6, 1], [6, 1]] };
  const x = R.computeRatings({ initialLevels: lv, results: [r1, r2] }).players;
  const y = R.computeRatings({ initialLevels: lv, results: [r2, r1] }).players;
  assert(near(x.a.rating, y.a.rating));
});

test('jogo sem vencedor ou incompleto é ignorado', () => {
  const { players } = R.computeRatings({ initialLevels: lv,
    results: [{ id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 6]] }] });
  assert.strictEqual(players.a.games, 0);
});

test('ranking só inclui quem já jogou', () => {
  const { players } = R.computeRatings({ initialLevels: { ...lv, e: 5 },
    results: [{ id: 1, date: '2026-11-01', teamA: ['a', 'b'], teamB: ['c', 'd'], sets: [[6, 4], [6, 4]] }] });
  const ids = R.rankPlayers(players).map(p => p.id);
  assert(!ids.includes('e'));
  assert.strictEqual(ids.length, 4);
});

console.log(`\n${passed} testes passaram.\n`);
