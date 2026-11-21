// Correr com: node tests/scorer.test.js
const assert = require('assert');
const S = require('../js/scorer.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
const rep = (t, n) => Array(n).fill(t);
const game = (t) => rep(t, 4);                         // jogo ganho a zero
const games = (t, n) => [].concat(...Array.from({ length: n }, () => game(t)));

test('pontos: 0, 15, 30, 40', () => {
  assert.deepStrictEqual(S.pointDisplay(S.compute([])), { a: '0', b: '0', note: '' });
  assert.strictEqual(S.pointDisplay(S.compute(['a', 'a', 'b'])).a, '30');
  assert.strictEqual(S.pointDisplay(S.compute(['a', 'a', 'a'])).a, '40');
});

test('ponto de ouro: em 40-40 o ponto seguinte ganha o jogo', () => {
  const deuce = ['a', 'a', 'a', 'b', 'b', 'b'];
  assert.strictEqual(S.pointDisplay(S.compute(deuce)).note, 'Ponto de ouro');
  const s = S.compute([...deuce, 'b']);
  assert.deepStrictEqual(s.games, { a: 0, b: 1 });
});

test('vantagens: sem ponto de ouro, é preciso ganhar por 2', () => {
  const cfg = { goldenPoint: false };
  const deuce = ['a', 'a', 'a', 'b', 'b', 'b'];
  assert.strictEqual(S.pointDisplay(S.compute([...deuce, 'a'], cfg)).a, 'AD');
  assert.deepStrictEqual(S.compute([...deuce, 'a', 'b'], cfg).games, { a: 0, b: 0 });
  assert.deepStrictEqual(S.compute([...deuce, 'a', 'a'], cfg).games, { a: 1, b: 0 });
});

test('set a 6 com 2 de diferença: 6-4 fecha, 6-5 não', () => {
  const s64 = S.compute([...games('a', 5), ...games('b', 4), ...game('a')]);
  assert.deepStrictEqual(s64.sets, [[6, 4]]);
  const s65 = S.compute([...games('a', 5), ...games('b', 5), ...game('a')]);
  assert.deepStrictEqual(s65.sets, []);
  assert.deepStrictEqual(s65.games, { a: 6, b: 5 });
});

test('6-6: tie-break a 7, set fica 7-6', () => {
  const toSix = [...games('a', 5), ...games('b', 5), ...game('a'), ...game('b')];
  const s = S.compute(toSix);
  assert(s.tiebreak);
  const done = S.compute([...toSix, ...rep('b', 7)]);
  assert.deepStrictEqual(done.sets, [[6, 7]]);
});

test('tie-break precisa de 2 de diferença (8-6)', () => {
  const toSix = [...games('a', 5), ...games('b', 5), ...game('a'), ...game('b')];
  const tb = [...rep('a', 6), ...rep('b', 6), 'a'];
  assert.deepStrictEqual(S.compute([...toSix, ...tb]).sets, []);
  assert.deepStrictEqual(S.compute([...toSix, ...tb, 'a']).sets, [[7, 6]]);
});

test('jogo à melhor de 3, com super tie-break no 3.º set', () => {
  const set1 = games('a', 6), set2 = games('b', 6);
  const s = S.compute([...set1, ...set2]);
  assert(s.superTiebreak);
  const done = S.compute([...set1, ...set2, ...rep('a', 8), ...rep('b', 8), 'a', 'a']);
  assert(done.finished);
  assert.strictEqual(done.winner, 'a');
  assert.deepStrictEqual(done.sets, [[6, 0], [0, 6], [10, 8]]);
  assert.strictEqual(S.format(done), '6-0, 0-6, 10-8');
});

test('sem super tie-break, o 3.º set é normal', () => {
  const s = S.compute([...games('a', 6), ...games('b', 6), ...games('a', 6)], { superTiebreak: false });
  assert.deepStrictEqual(s.sets, [[6, 0], [0, 6], [6, 0]]);
  assert.strictEqual(s.winner, 'a');
});

test('2-0 em sets acaba o jogo e ignora pontos a mais', () => {
  const s = S.compute([...games('a', 12), 'b', 'b']);
  assert(s.finished);
  assert.deepStrictEqual(s.sets, [[6, 0], [6, 0]]);
});

test('anular = tirar o último ponto', () => {
  const pts = [...games('a', 5), ...games('b', 4), ...game('a')];
  assert.deepStrictEqual(S.compute(pts.slice(0, -1)).games, { a: 5, b: 4 });
});

test('resultado escrito à mão', () => {
  assert.deepStrictEqual(S.parseSets('6-4, 3-6, 10-8'), [[6, 4], [3, 6], [10, 8]]);
  assert.deepStrictEqual(S.parseSets('6/2 6/1'), [[6, 2], [6, 1]]);
  assert.strictEqual(S.parseSets('6-6'), null);
  assert.strictEqual(S.parseSets('olá'), null);
});

console.log(`\n${passed} testes passaram.\n`);
