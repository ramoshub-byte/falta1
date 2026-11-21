// Correr com: node tests/matchmaking.test.js
const assert = require('assert');
const { CLUBS, PLAYERS, CITY_CENTER } = require('../js/data.js');
const { suggestMatches, haversineKm } = require('../js/matchmaking.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

const me = {
  id: 'me', name: 'Eu', level: 3.0, side: 'direita',
  lat: CITY_CENTER.lat, lng: CITY_CENTER.lng,
  availability: ['seg-noite', 'qua-noite', 'sab-manha'], radiusKm: 6
};

test('distância Chaves → Verín ronda 23 km', () => {
  const km = haversineKm(CITY_CENTER, CLUBS.find(c => c.id === 'verin'));
  assert(km > 18 && km < 28, km);
});

test('sozinho: devolve até 3 jogos com 4 jogadores distintos', () => {
  const { matches } = suggestMatches({ me, players: PLAYERS, clubs: CLUBS });
  assert(matches.length >= 1 && matches.length <= 3);
  for (const m of matches) {
    const ids = [...m.teamA, ...m.teamB].map(p => p.id);
    assert.strictEqual(new Set(ids).size, 4);
    assert(ids.includes('me'));
  }
});

test('todos os 4 estão disponíveis no horário proposto', () => {
  const { matches } = suggestMatches({ me, players: PLAYERS, clubs: CLUBS });
  for (const m of matches) for (const p of [...m.teamA, ...m.teamB]) {
    const avail = p.id === 'me' ? me.availability : p.availability;
    assert(avail.includes(m.slot), `${p.name} não está livre em ${m.slot}`);
  }
});

test('o clube sugerido está dentro do raio de todos', () => {
  const { matches } = suggestMatches({ me, players: PLAYERS, clubs: CLUBS });
  for (const m of matches) {
    const club = m.clubs[0].club;
    for (const p of [...m.teamA, ...m.teamB]) assert(haversineKm(p, club) <= p.radiusKm);
  }
});

test('diferença de nível dentro do jogo nunca passa de 2', () => {
  const { matches } = suggestMatches({ me, players: PLAYERS, clubs: CLUBS });
  for (const m of matches) assert(m.spread <= 2.0);
});

test('com parceiro: a dupla fica sempre na mesma equipa', () => {
  const partner = PLAYERS.find(p => p.id === 'p20'); // Joana, livre seg/qua noite e sáb manhã
  const { matches } = suggestMatches({ me, partner, players: PLAYERS, clubs: CLUBS });
  assert(matches.length >= 1);
  for (const m of matches) {
    const a = m.teamA.map(p => p.id);
    assert(a.includes('me') && a.includes('p20'));
  }
});

test('sem clube ao alcance: zero jogos e diagnóstico claro', () => {
  const far = { ...me, lat: 41.3, lng: -7.7, radiusKm: 3 };
  const { matches, diagnostics } = suggestMatches({ me: far, players: PLAYERS, clubs: CLUBS });
  assert.strictEqual(matches.length, 0);
  assert(diagnostics.noClubInRange);
});

test('nível 7 sem ninguém parecido: zero jogos', () => {
  const pro = { ...me, level: 7 };
  const { matches } = suggestMatches({ me: pro, players: PLAYERS, clubs: CLUBS });
  assert.strictEqual(matches.length, 0);
});

test('feedback: jogador pouco fiável deixa de ser sugerido quando há alternativa', () => {
  const before = suggestMatches({ me, players: PLAYERS, clubs: CLUBS }).matches;
  const firstOther = before[0].playerIds.find(id => id !== 'me');
  const players = PLAYERS.map(p => p.id === firstOther ? { ...p, reliability: 0.2 } : p);
  const after = suggestMatches({ me, players, clubs: CLUBS }).matches;
  assert(!after[0].playerIds.includes(firstOther), 'continua a sugerir ' + firstOther);
});

test('feedback: clube bem avaliado ganha o desempate de distância', () => {
  const { matches } = suggestMatches({ me, players: PLAYERS, clubs: CLUBS });
  const [first, second] = matches[0].clubs;
  assert(second, 'precisa de 2 clubes');
  const clubs = CLUBS.map(c => c.id === second.club.id ? { ...c, rating: 5 } : c.id === first.club.id ? { ...c, rating: 1.5 } : c);
  const again = suggestMatches({ me, players: PLAYERS, clubs }).matches.find(m => m.playerIds.join() === matches[0].playerIds.join());
  assert.strictEqual(again.clubs[0].club.id, second.club.id);
});

console.log(`\n${passed} testes passaram.\n`);

// Mostra um exemplo legível
const { matches } = suggestMatches({ me, players: PLAYERS, clubs: CLUBS });
for (const m of matches) {
  const t = (team) => team.map(p => `${p.name} (${p.level}, ${p.side})`).join(' + ');
  console.log(`${m.slot}: ${t(m.teamA)}  vs  ${t(m.teamB)}`);
  console.log(`   equilíbrio ${m.balance}% · clube: ${m.clubs[0].club.name} (${m.clubs[0].avgKm.toFixed(1)} km em média)`);
}
