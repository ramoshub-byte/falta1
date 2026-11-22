// Correr com: node tests/tournament.test.js
const assert = require('assert');
const T = require('../js/tournament.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

const players = (n) => [...Array(n)].map((_, i) => ({ id: 'p' + (i + 1), level: 5 - i * 0.25 }));
// Preenche resultados: ganha sempre a equipa A (ou a função dada).
function playAll(t, pick = () => 'a') {
  for (let guard = 0; guard < 50; guard++) {
    const r = T.resolve(t);
    const open = r.playable.filter(m => !m.result);
    if (!open.length) break;
    open.forEach(rm => {
      const m = t.matches.find(x => x.id === rm.id);
      const w = pick(rm);
      m.teamA = rm.teamA; m.teamB = rm.teamB;
      m.result = { sets: [w === 'a' ? [6, 3] : [3, 6]], winner: w };
    });
  }
  return T.resolve(t);
}

test('americano com 8 jogadores, sorteio: 7 rondas e nenhum parceiro repetido', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = T.create({ format: 'americano', mode: 'sorteio', players: players(8), courts: 2, seed });
    assert.strictEqual(t.config.rounds, 7, 'seed ' + seed);
    const p = T.partnerships(t);
    assert(Object.values(p).every(c => c === 1), 'parceiro repetido com seed ' + seed);
    assert.strictEqual(Object.keys(p).length, 28); // 8×7/2: toda a gente joga com toda a gente
    // cada ronda tem os 8 jogadores, cada um uma vez
    for (let r = 1; r <= 7; r++) {
      const ids = t.matches.filter(m => m.round === r).flatMap(m => [...m.teamA, ...m.teamB]);
      assert.strictEqual(new Set(ids).size, 8);
    }
  }
});

test('americano pelo ranking: sem parceiros repetidos e 1.ª ronda equilibrada', () => {
  const t = T.create({ format: 'americano', mode: 'ranking', players: players(8), courts: 2, seed: 3 });
  assert(Object.values(T.partnerships(t)).every(c => c === 1));
  const m1 = t.matches.find(m => m.id === 'r1-1');
  // os 4 melhores jogam juntos: 1.º + 4.º contra 2.º + 3.º
  assert.deepStrictEqual([m1.teamA, m1.teamB], [['p1', 'p4'], ['p2', 'p3']]);
});

test('americano com 10 jogadores e 2 campos: descansam 2 por ronda, à vez', () => {
  const t = T.create({ format: 'americano', mode: 'sorteio', players: players(10), courts: 2, rounds: 5, seed: 7 });
  assert.strictEqual(t.rounds.length, 5);
  t.rounds.forEach(r => assert.strictEqual(r.sitting.length, 2));
  const sat = t.rounds.flatMap(r => r.sitting);
  assert.strictEqual(new Set(sat).size, 10); // em 5 rondas, todos descansam uma vez
});

test('americano: classificação por jogos ganhos e posições finais', () => {
  const t = T.create({ format: 'americano', mode: 'sorteio', players: players(4), courts: 1, seed: 1 });
  assert.strictEqual(t.config.rounds, 3);
  const r = playAll(t, rm => (rm.teamA.includes('p1') ? 'a' : rm.teamB.includes('p1') ? 'b' : 'a'));
  assert(r.finished);
  const st = T.americanoStandings(t);
  assert.strictEqual(st[0].id, 'p1');
  assert.strictEqual(st[0].points, 18);
  const pl = T.placements(t);
  assert.strictEqual(pl.p1, 'campeao');
  assert.strictEqual(Object.values(pl).filter(x => x === 'meias').length, 2);
});

test('formar duplas pelo ranking: o mais forte com o mais fraco', () => {
  const pairs = T.formPairs(players(8), 'ranking');
  assert.deepStrictEqual(pairs[0], ['p1', 'p8']);
  assert.deepStrictEqual(pairs[3], ['p4', 'p5']);
});

test('cabeças de série: 1 e 2 só se encontram na final', () => {
  assert.deepStrictEqual(T.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const pairs = [['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2'], ['d1', 'd2']];
  const lv = { a1: 6, a2: 6, b1: 5, b2: 5, c1: 4, c2: 4, d1: 3, d2: 3 };
  const t = T.create({ format: 'eliminatoria', mode: 'ranking', players: Object.entries(lv).map(([id, level]) => ({ id, level })), pairs });
  const r = T.resolve(t);
  const semis = r.matches.filter(m => m.round === 1);
  assert.deepStrictEqual(semis[0].teamA, ['a1', 'a2']);
  assert.deepStrictEqual(semis[0].teamB, ['d1', 'd2']);
});

test('eliminatória com 6 duplas: 2 isenções para as melhores e final com campeão', () => {
  const t = T.create({ format: 'eliminatoria', mode: 'ranking', players: players(12) });
  const r0 = T.resolve(t);
  assert.strictEqual(r0.matches.filter(m => m.bye).length, 2);
  assert.strictEqual(r0.playable.length, 2); // só os 2 jogos dos quartos sem isenção
  const r = playAll(t);
  assert(r.finished);
  const pl = T.placements(t);
  assert.strictEqual(Object.values(pl).filter(x => x === 'campeao').length, 2);
  assert.strictEqual(Object.values(pl).filter(x => x === 'finalista').length, 2);
  assert.strictEqual(Object.values(pl).filter(x => x === 'meias').length, 4);
  assert.strictEqual(Object.values(pl).filter(x => x === 'quartos').length, 4);
});

test('grupos + eliminatórias com 8 duplas: 2 grupos, todos contra todos, cruzamento A1×B2', () => {
  const t = T.create({ format: 'grupos', mode: 'ranking', players: players(16), courts: 3 });
  assert.strictEqual(t.groups.length, 2);
  assert.strictEqual(t.matches.filter(m => m.stage === 'grupo').length, 12); // 2 × (4×3/2)
  const r0 = T.resolve(t);
  const semi1 = r0.matches.find(m => m.id === 'k1-1');
  assert.strictEqual(semi1.teamA, null);
  assert.strictEqual(semi1.labelA, '1.º do grupo A');
  assert.strictEqual(semi1.labelB, '2.º do grupo B');
  const r = playAll(t);
  assert(r.finished);
  const pl = T.placements(t);
  assert.strictEqual(Object.keys(pl).length, 16);
  assert.strictEqual(Object.values(pl).filter(x => x === 'participacao').length, 8);
});

test('grupos com 4 duplas: 1 grupo e final entre os 2 primeiros', () => {
  const t = T.create({ format: 'grupos', mode: 'sorteio', players: players(8), seed: 2 });
  assert.strictEqual(t.groups.length, 1);
  assert.strictEqual(t.matches.filter(m => m.stage === 'eliminatoria').length, 1);
  assert(playAll(t).finished);
});

test('duplas escolhidas pelo organizador: valida jogador repetido', () => {
  assert.throws(() => T.create({ format: 'eliminatoria', players: players(4), pairs: [['p1', 'p2'], ['p2', 'p3']] }), /duas duplas/);
});

test('todos contra todos: cada par joga uma vez', () => {
  [3, 4, 5, 6].forEach(n => {
    const games = T.roundRobin(n).flat().map(([a, b]) => [a, b].sort().join('-'));
    assert.strictEqual(games.length, n * (n - 1) / 2);
    assert.strictEqual(new Set(games).size, games.length);
  });
});

test('só os resultados confirmados contam (classificação e avanço na chave)', () => {
  const t = T.create({ format: 'eliminatoria', mode: 'ranking', players: players(8) });
  let r = T.resolve(t);
  const semi = t.matches.find(m => m.id === 'k1-1'), rs = r.matches.find(m => m.id === 'k1-1');
  semi.teamA = rs.teamA; semi.teamB = rs.teamB;
  semi.result = { sets: [[6, 3], [6, 3]], winner: 'a', status: 'pendente', submittedTeam: 'a' };
  r = T.resolve(t);
  assert.strictEqual(r.matches.find(m => m.id === 'k2-1').teamA, null); // ainda não avança
  assert.strictEqual(r.pending.length, 1);
  semi.result.status = 'contestado';
  assert.strictEqual(T.resolve(t).matches.find(m => m.id === 'k2-1').teamA, null);
  semi.result.status = 'confirmado';
  assert.deepStrictEqual(T.resolve(t).matches.find(m => m.id === 'k2-1').teamA, rs.teamA);
  const am = T.create({ format: 'americano', mode: 'sorteio', players: players(4), courts: 1, seed: 1 });
  am.matches[0].result = { sets: [[6, 0]], winner: 'a', status: 'pendente' };
  assert(T.americanoStandings(am).every(x => x.points === 0));
});

console.log(`\n${passed} testes passaram.\n`);
