// Correr com: node tests/season.test.js
const assert = require('assert');
const S = require('../js/season.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

const L = { a: 3, b: 3, c: 3, d: 3, e: 5, f: 5, g: 2, h: 2 };
const g = (id, date, teamA, teamB, sets, extra = {}) => ({ id, date, teamA, teamB, sets, ...extra });

test('vitória 10, derrota 3 em jogo casual equilibrado (sem bónus)', () => {
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: [g('1', '2026-03-02', ['a', 'b'], ['c', 'd'], [[6, 4], [6, 4]])] });
  assert.strictEqual(s.rows.a.points, 10);
  assert.strictEqual(s.rows.c.points, 3);
  assert.strictEqual(s.rows.a.bonuses, 0);
});

test('bónus de surpresa quando a probabilidade era < 40%', () => {
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: [g('1', '2026-03-02', ['g', 'h'], ['e', 'f'], [[7, 6], [7, 6]])] });
  assert.strictEqual(s.rows.g.points, 15);
  assert.strictEqual(s.rows.e.points, 3);
  // os favoritos que ganham não têm bónus
  const s2 = S.computeSeason({ year: 2026, initialLevels: L, results: [g('1', '2026-03-02', ['e', 'f'], ['g', 'h'], [[6, 0], [6, 0]])] });
  assert.strictEqual(s2.rows.e.points, 10);
});

test('só 2 jogos por semana contra os mesmos 4 dão pontos', () => {
  const res = [1, 2, 3].map(i => g(String(i), '2026-03-0' + (i + 1), ['a', 'b'], ['c', 'd'], [[6, 4], [6, 4]]));
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: res });
  assert.strictEqual(s.rows.a.games, 3);
  assert.strictEqual(s.rows.a.points, 20);
  assert.strictEqual(s.rows.a.capped, 1);
  // na semana seguinte volta a contar
  res.push(g('4', '2026-03-10', ['a', 'b'], ['c', 'd'], [[6, 4], [6, 4]]));
  assert.strictEqual(S.computeSeason({ year: 2026, initialLevels: L, results: res }).rows.a.points, 30);
});

test('jogos de torneio não dão 10/3, mas a posição final dá pontos', () => {
  const res = [g('t:1', '2026-04-04', ['a', 'b'], ['c', 'd'], [[6, 2]], { tournamentId: 't' })];
  const tournaments = [{ id: 't', name: 'Americano', date: '2026-04-04', placements: { a: 'campeao', b: 'finalista', c: 'meias', d: 'participacao' } }];
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: res, tournaments });
  assert.strictEqual(s.rows.a.points, 60);
  assert.strictEqual(s.rows.d.points, 10);
  assert.strictEqual(s.rows.a.wins, 1);
  assert.strictEqual(s.rows.a.tournaments.length, 1);
});

test('a época só conta o próprio ano', () => {
  const res = [g('1', '2025-12-30', ['a', 'b'], ['c', 'd'], [[6, 4], [6, 4]]), g('2', '2026-01-05', ['a', 'b'], ['c', 'd'], [[6, 4], [6, 4]])];
  assert.strictEqual(S.computeSeason({ year: 2026, initialLevels: L, results: res }).rows.a.points, 10);
  assert.strictEqual(S.computeSeason({ year: 2025, initialLevels: L, results: res }).rows.a.points, 10);
});

test('divisões: A ≥ 4,5, B ≥ 3, C abaixo', () => {
  assert.strictEqual(S.divisionFor(4.5, S.DEFAULT_RULES).id, 'A');
  assert.strictEqual(S.divisionFor(4.49, S.DEFAULT_RULES).id, 'B');
  assert.strictEqual(S.divisionFor(3, S.DEFAULT_RULES).id, 'B');
  assert.strictEqual(S.divisionFor(2.9, S.DEFAULT_RULES).id, 'C');
});

test('divisão fixa pelo nível no início da época para quem já tinha 5 jogos', () => {
  // "g" começa em 2 e ganha 6 jogos em 2025 a jogadores de 5 → chega à época com nível alto
  const prior = [1, 2, 3, 4, 5, 6].map(i => g('p' + i, `2025-06-0${i}`, ['g', 'h'], ['e', 'f'], [[6, 0], [6, 0]]));
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: [...prior, g('x', '2026-02-01', ['g', 'h'], ['a', 'b'], [[6, 4], [6, 4]])] });
  assert(s.rows.g.divisionLevel > 3, 'nível ao início da época ' + s.rows.g.divisionLevel);
  assert.notStrictEqual(s.rows.g.division, 'C');
});

test('nível provisório: a divisão é a do nível ao 5.º jogo', () => {
  // "g" declara-se 2 mas ganha os 5 primeiros jogos a jogadores de nível 5
  const res = [1, 2, 3, 4, 5].map(i => g(String(i), `2026-02-0${i}`, ['g', 'a'], ['e', 'f'], [[6, 0], [6, 0]]));
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: res });
  assert(s.rows.g.divisionLevel > 3, 'nível ao 5.º jogo ' + s.rows.g.divisionLevel);
  assert.notStrictEqual(s.rows.g.division, 'C');
});

test('desempate por vitórias e mínimo de 3 jogos para entrar na tabela', () => {
  const res = [
    g('1', '2026-03-02', ['a', 'b'], ['c', 'd'], [[6, 4], [6, 4]]),
    g('2', '2026-03-09', ['a', 'c'], ['b', 'd'], [[6, 4], [6, 4]]),
    g('3', '2026-03-16', ['a', 'd'], ['b', 'c'], [[4, 6], [4, 6]])
  ];
  const s = S.computeSeason({ year: 2026, initialLevels: L, results: res });
  const B = s.divisions.find(d => d.id === 'B');
  // a, b e c têm 23 pontos e 2 vitórias; d perdeu os 3 e desceu abaixo de 3 → divisão C (nível provisório)
  assert.deepStrictEqual(B.ranked.map(p => p.points), [23, 23, 23]);
  assert.strictEqual(s.rows.d.division, 'C');
  assert.strictEqual(B.ranked[0].id, 'a');
  assert.strictEqual(B.ranked[0].position, 1);
  const s1 = S.computeSeason({ year: 2026, initialLevels: L, results: res.slice(0, 2) });
  assert.strictEqual(s1.divisions.find(d => d.id === 'B').ranked.length, 0);
  assert.strictEqual(s1.divisions.reduce((n, d) => n + d.pending.length, 0), 4);
});

test('explicação gerada a partir das regras', () => {
  const e = S.explain();
  assert(e.items.some(t => t.includes('vitória 10 pontos')));
  assert(e.items.some(t => t.includes('campeão 60')));
  const custom = JSON.parse(JSON.stringify(S.DEFAULT_RULES)); custom.casual.win = 12;
  assert(S.explain(custom).items.some(t => t.includes('vitória 12 pontos')));
});

test('semana ISO', () => {
  assert.strictEqual(S.isoWeek('2026-01-01'), '2026-W01');
  assert.strictEqual(S.isoWeek('2026-03-02'), S.isoWeek('2026-03-08'));
  assert.notStrictEqual(S.isoWeek('2026-03-08'), S.isoWeek('2026-03-09'));
  assert.strictEqual(S.isoWeek('2027-01-01'), '2026-W53');
});

console.log(`\n${passed} testes passaram.\n`);
