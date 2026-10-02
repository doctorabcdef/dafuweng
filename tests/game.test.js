import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, PLAYER_COLORS, ANIMALS, createGame, applyAction, getCurrentPlayer, getPlayerAnimal, getRollMovement, getRent, getNetWorth, canBuild, validateState } from '../src/game.js';

const fresh = (names = ['阿橙', '阿蓝']) => createGame({ names }, { id: 'test-game', now: '2026-10-02T00:00:00.000Z' });
const act = (state, type, extra = {}) => applyAction(state, { type, ...extra });
const own = (state, tileId, ownerId = 'p1', level = 0) => Object.assign(state.properties[tileId], { ownerId, level });

test('creates a JSON round-trippable board and stable initial state', () => {
  const state = fresh();
  assert.equal(BOARD.length, 32);
  assert.equal(new Set(BOARD.map(tile => tile.id)).size, 32);
  assert.equal(PLAYER_COLORS.length, 4);
  assert.equal(validateState(JSON.parse(JSON.stringify(state))), true);
  assert.equal(state.players.length, 2);
  assert.equal(state.phase, 'roll');
  assert.equal(getNetWorth(state, 'p1'), 15000);
  assert.throws(() => fresh(['一人']));
  assert.throws(() => createGame({ names: ['甲', '乙'], startingCash: -1 }));
});

test('roll, buy and turn transitions are atomic and do not mutate source or dice', () => {
  const initial = fresh();
  const snapshot = JSON.stringify(initial);
  const dice = [1, 2];
  let state = act(initial, 'ROLL', { dice });
  assert.equal(JSON.stringify(initial), snapshot);
  dice[0] = 6;
  assert.deepEqual(state.dice, [1, 2]);
  assert.equal(state.phase, 'buy');
  assert.equal(getCurrentPlayer(state).position, 3);
  assert.throws(() => act(state, 'END_TURN'));
  state = act(state, 'BUY');
  assert.equal(state.properties[3].ownerId, 'p1');
  assert.equal(state.players[0].cash, 13800);
  assert.equal(getNetWorth(state, 'p1'), 15000);
  state = act(state, 'END_TURN');
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.phase, 'roll');
  assert.equal(state.dice, null);
  state = act(state, 'ROLL', { dice: [1, 2] });
  assert.equal(state.players[1].cash, 14820);
  assert.equal(state.players[0].cash, 13980);
  state = act(state, 'END_TURN');
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.round, 2);
  assert.equal(validateState(state), true);
});

test('invalid actions reject without changing the original state', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  for (const action of [
    { type: 'ROLL', dice: [0, 3] }, { type: 'ROLL', dice: [1.5, 2] },
    { type: 'ROLL', dice: [1, 2], playerId: 'p2' }, { type: 'BUY' },
    { type: 'END_TURN' }, { type: 'PAY_BAIL' }, { type: 'MORTGAGE', tileId: 1 },
    { type: 'BANKRUPT' }, { type: 'NOT_REAL' },
  ]) assert.throws(() => applyAction(state, action));
  assert.equal(JSON.stringify(state), before);
  const rolled = act(state, 'ROLL', { dice: [1, 2] });
  assert.throws(() => act(rolled, 'ROLL', { dice: [1, 2] }));
});

test('unaffordable land can be declined and passing start pays exactly once', () => {
  let state = fresh();
  state.players[0].cash = 100;
  state = act(state, 'ROLL', { dice: [1, 2] });
  assert.throws(() => act(state, 'BUY'));
  state = act(state, 'SKIP_BUY');
  state = act(state, 'END_TURN');
  state.players[1].position = 30;
  state = act(state, 'ROLL', { dice: [1, 1] });
  assert.equal(state.players[1].position, 0);
  assert.equal(state.players[1].cash, 17000);
  assert.equal(state.phase, 'end');
});

test('full groups, upgrades, mortgages and redemption use consistent rents and money', () => {
  let state = fresh();
  own(state, 1);
  assert.equal(getRent(state, 1), 150);
  assert.equal(canBuild(state, 1), false);
  own(state, 3);
  assert.equal(getRent(state, 1), 300);
  assert.equal(canBuild(state, 1), true);
  state = act(state, 'BUILD', { tileId: 1 });
  state = act(state, 'BUILD', { tileId: 1 });
  state = act(state, 'BUILD', { tileId: 1 });
  assert.equal(state.properties[1].level, 3);
  assert.equal(getRent(state, 1), 1050);
  assert.equal(canBuild(state, 1), false);
  assert.throws(() => act(state, 'BUILD', { tileId: 1 }));
  const cash = state.players[0].cash;
  state = act(state, 'MORTGAGE', { tileId: 1 });
  assert.equal(state.players[0].cash, cash + 500 + 750);
  assert.equal(state.properties[1].level, 0);
  assert.equal(getRent(state, 1), 0);
  assert.equal(getRent(state, 3), 180);
  assert.equal(canBuild(state, 3), false);
  assert.throws(() => act(state, 'MORTGAGE', { tileId: 1 }));
  state = act(state, 'REDEEM', { tileId: 1 });
  assert.equal(state.players[0].cash, cash + 1250 - 550);
  assert.equal(getRent(state, 1), 300);
  assert.equal(validateState(state), true);
});

test('tax debt blocks ending a turn but can be paid through mortgage', () => {
  let state = fresh();
  state.players[0].cash = 400;
  own(state, 1);
  state = act(state, 'ROLL', { dice: [2, 2] });
  assert.equal(state.players[0].cash, -400);
  assert.throws(() => act(state, 'END_TURN'));
  state = act(state, 'MORTGAGE', { tileId: 1 });
  assert.equal(state.players[0].cash, 100);
  state = act(state, 'END_TURN');
  assert.equal(state.currentPlayer, 1);
});

test('redemption fee avoids floating point rounding up an extra yuan', () => {
  let state = fresh();
  own(state, 29);
  state = act(state, 'MORTGAGE', { tileId: 29 });
  assert.equal(state.players[0].cash, 16800);
  state = act(state, 'REDEEM', { tileId: 29 });
  assert.equal(state.players[0].cash, 14820);
});

test('rent debt is credited, bankruptcy releases assets, and the survivor wins', () => {
  let state = fresh();
  state.players[0].cash = 10;
  own(state, 1);
  own(state, 3, 'p2');
  state = act(state, 'ROLL', { dice: [1, 2] });
  assert.equal(state.players[0].cash, -170);
  assert.equal(state.players[1].cash, 15180);
  state = act(state, 'BANKRUPT');
  assert.equal(state.players[0].bankrupt, true);
  assert.equal(state.players[0].cash, 0);
  assert.deepEqual(state.properties[1], { ownerId: null, level: 0, mortgaged: false });
  assert.equal(state.phase, 'gameover');
  assert.equal(state.winnerId, 'p2');
  assert.equal(validateState(state), true);
  assert.throws(() => act(state, 'ROLL', { dice: [1, 2] }));
});

test('turn progression skips bankrupt players and advances the round on wrap', () => {
  let state = fresh(['甲', '乙', '丙']);
  state.currentPlayer = 1;
  state.players[1].cash = -1;
  state.phase = 'end';
  state = act(state, 'BANKRUPT');
  assert.equal(state.currentPlayer, 2);
  assert.equal(state.phase, 'roll');
  state = act(state, 'ROLL', { dice: [1, 3] });
  state = act(state, 'END_TURN');
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.round, 2);
  state = act(state, 'ROLL', { dice: [1, 3] });
  state = act(state, 'END_TURN');
  assert.equal(state.currentPlayer, 2);
});

test('jail requires two missed turns, doubles or paying bail before rolling', () => {
  let state = fresh();
  state.players[0].position = 23;
  state = act(state, 'ROLL', { dice: [1, 1] });
  assert.equal(state.players[0].position, 7);
  assert.equal(state.players[0].jailed, 2);
  assert.equal(state.players[0].cash, 15000);
  const incarcerated = structuredClone(state);
  state.phase = 'roll';
  state = act(state, 'ROLL', { dice: [1, 2] });
  assert.equal(state.players[0].position, 7);
  assert.equal(state.players[0].jailed, 1);
  state.phase = 'roll';
  state = act(state, 'ROLL', { dice: [1, 2] });
  assert.equal(state.players[0].jailed, 0);
  assert.equal(state.players[0].position, 7);
  incarcerated.phase = 'roll';
  const doubled = act(incarcerated, 'ROLL', { dice: [2, 2] });
  assert.equal(doubled.players[0].jailed, 0);
  assert.equal(doubled.players[0].position, 11);
  const bailed = act(incarcerated, 'PAY_BAIL');
  assert.equal(bailed.players[0].cash, 14500);
  assert.equal(bailed.players[0].jailed, 0);
  assert.equal(bailed.phase, 'roll');
});

test('chance outcomes are deterministic and every card leaves a valid state', () => {
  const outcomes = new Set();
  for (let round = 1; round <= 8; round += 1) {
    const state = fresh();
    state.round = round;
    const action = { type: 'ROLL', dice: [1, 1] };
    const result = applyAction(state, action);
    assert.deepEqual(result, applyAction(state, action));
    assert.equal(validateState(result), true);
    outcomes.add(result.lastEvent);
  }
  assert.equal(outcomes.size, 8);
});

test('rejects corrupted saves, impossible ownership, phases and winners', () => {
  const mutations = [
    state => { state.schemaVersion = 2; },
    state => { state.players[0].cash = Infinity; },
    state => { state.players[0].position = 32; },
    state => { state.players[0].jailed = 1; },
    state => { state.players[1].id = 'p1'; },
    state => { state.currentPlayer = 9; },
    state => { state.properties[1].ownerId = 'intruder'; },
    state => { state.properties[1].level = 1; },
    state => { delete state.properties[3]; },
    state => { state.dice = [8, 2]; },
    state => { state.phase = 'buy'; },
    state => { state.phase = 'gameover'; state.winnerId = 'p1'; },
    state => { state.logs = []; },
    state => { state.updatedAt = 'yesterday'; },
  ];
  for (const mutate of mutations) {
    const state = fresh();
    mutate(state);
    assert.equal(validateState(state), false);
    assert.throws(() => act(state, 'ROLL', { dice: [1, 2] }));
  }
  assert.equal(validateState(null), false);
  assert.equal(validateState({}), false);
});

test('timestamps stay monotonic and bounded logs survive a long game', () => {
  let state = fresh();
  state = act(state, 'ROLL', { dice: [1, 2], now: '2026-10-03T00:00:00Z' });
  assert.equal(state.updatedAt, '2026-10-03T00:00:00.000Z');
  state = act(state, 'SKIP_BUY', { now: '2026-10-01T00:00:00Z' });
  assert.equal(state.updatedAt, '2026-10-03T00:00:00.001Z');
  state = act(state, 'END_TURN');
  for (let index = 0; index < 100; index += 1) {
    state = act(state, 'ROLL', { dice: [1 + index % 6, 1 + (index * 3) % 6] });
    if (getCurrentPlayer(state).cash < 0) break;
    if (state.phase === 'buy') state = act(state, 'SKIP_BUY');
    state = act(state, 'END_TURN');
  }
  assert.equal(state.logs.length, 60);
  assert.equal(new Set(state.logs.map(log => log.id)).size, 60);
  assert.equal(validateState(state), true);
});

test('country names retain existing board positions, purchase costs and groups', () => {
  const countries = BOARD.filter(tile => tile.type === 'property');
  assert.deepEqual(countries.map(tile => tile.name), [
    '中国', '日本', '韩国', '新加坡', '泰国', '印度', '法国', '德国', '意大利', '西班牙',
    '英国', '瑞士', '美国', '加拿大', '巴西', '阿根廷', '澳大利亚', '新西兰', '埃及', '南非',
  ]);
  assert.deepEqual(countries.map(tile => [tile.id, tile.price, tile.group]), [
    [1, 1000, 'coast'], [3, 1200, 'coast'], [5, 1400, 'garden'], [6, 1600, 'garden'],
    [8, 1800, 'river'], [9, 1800, 'river'], [11, 2000, 'food'], [12, 2200, 'food'],
    [14, 2400, 'history'], [15, 2400, 'history'], [16, 2600, 'bay'], [18, 2800, 'bay'],
    [20, 3000, 'capital'], [21, 3200, 'capital'], [23, 2600, 'holiday'], [24, 2800, 'holiday'],
    [26, 3000, 'nature'], [27, 3200, 'nature'], [29, 3600, 'gold'], [31, 4000, 'gold'],
  ]);
  assert.equal(BOARD[7].type, 'jail');
  assert.equal(BOARD[25].type, 'goToJail');
});

test('animal choices persist while older saves keep working with indexed defaults', () => {
  assert.equal(ANIMALS.length, 16);
  assert.equal(new Set(ANIMALS.map(animal => animal.id)).size, ANIMALS.length);
  assert.ok(ANIMALS.every(animal => animal.name && animal.emoji));
  const created = createGame({ names: ['甲', '乙', '丙'], animals: ['panda', 'fox'] });
  const restored = JSON.parse(JSON.stringify(created));
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.players[0].animal, 'panda');
  assert.equal(restored.players[1].animal, 'fox');
  assert.equal(restored.players[2].animal, ANIMALS[2].id);
  assert.equal(getPlayerAnimal(restored.players[0]).emoji, '🐼');
  assert.equal(validateState(restored), true);

  const legacy = fresh();
  legacy.players.forEach(player => { delete player.animal; });
  const before = JSON.stringify(legacy);
  assert.equal(validateState(legacy), true);
  assert.equal(getPlayerAnimal(legacy.players[1], 1).id, ANIMALS[1].id);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(validateState(act(legacy, 'ROLL', { dice: [1, 2] })), true);
  const customized = act(legacy, 'SET_ANIMAL', { playerId: 'p2', animalId: 'penguin' });
  assert.equal(customized.players[1].animal, 'penguin');
  assert.equal(legacy.players[1].animal, undefined);
});

test('changing any player animal preserves all economic and turn state, even after gameover', () => {
  const before = act(fresh(), 'ROLL', { dice: [1, 2] });
  own(before, 1);
  const changed = act(before, 'SET_ANIMAL', { playerId: 'p2', animalId: 'dolphin' });
  const expected = structuredClone(before);
  expected.players[1].animal = 'dolphin';
  expected.updatedAt = changed.updatedAt;
  assert.deepEqual(changed, expected);
  assert.equal(getNetWorth(changed, 'p1'), getNetWorth(before, 'p1'));
  assert.equal(getNetWorth(changed, 'p2'), getNetWorth(before, 'p2'));

  const debt = fresh();
  debt.players[0].cash = -1;
  debt.phase = 'end';
  const ended = act(debt, 'BANKRUPT');
  const afterGame = act(ended, 'SET_ANIMAL', { playerId: 'p1', animalId: 'elephant' });
  assert.equal(afterGame.players[0].animal, 'elephant');
  assert.equal(afterGame.players[0].bankrupt, true);
  assert.equal(afterGame.winnerId, ended.winnerId);
  assert.equal(afterGame.phase, 'gameover');
  assert.equal(validateState(afterGame), true);
});

test('unknown animals and players cannot enter saved state', () => {
  assert.throws(() => createGame({ animals: ['dragon'] }));
  assert.throws(() => createGame({ animals: null }));
  const state = fresh();
  assert.throws(() => act(state, 'SET_ANIMAL', { playerId: 'p2', animalId: 'dragon' }));
  assert.throws(() => act(state, 'SET_ANIMAL', { playerId: 'p5', animalId: 'cat' }));
  assert.throws(() => act(state, 'SET_ANIMAL', { animalId: 'cat' }));
  state.players[0].animal = 'dragon';
  assert.equal(validateState(state), false);
});

test('roll paths contain each visited tile and wrap without mutating or extending saved state', () => {
  const before = fresh();
  before.players[0].position = 31;
  const after = act(before, 'ROLL', { dice: [1, 3] });
  const beforeJSON = JSON.stringify(before), afterJSON = JSON.stringify(after);
  assert.deepEqual(getRollMovement(before, after), { playerId: 'p1', steps: [0, 1, 2, 3] });
  assert.equal(after.players[0].cash, before.players[0].cash + 2000);
  assert.equal(JSON.stringify(before), beforeJSON);
  assert.equal(JSON.stringify(after), afterJSON);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(getRollMovement(before, act(before, 'SET_ANIMAL', { playerId: 'p1', animalId: 'frog' })), { playerId: 'p1', steps: [] });
  const mismatched = structuredClone(after);
  mismatched.players[0].position = 1;
  assert.deepEqual(getRollMovement(before, mismatched), { playerId: 'p1', steps: [] });
});

test('roll paths distinguish walking into jail, staying jailed and walking out with doubles', () => {
  const before = fresh();
  before.players[0].position = 23;
  const jailed = act(before, 'ROLL', { dice: [1, 1] });
  assert.deepEqual(getRollMovement(before, jailed), {
    playerId: 'p1', steps: [24, 25, 7], redirects: [{ index: 2, from: 25, to: 7, reason: 'jail' }],
  });
  const inJail = structuredClone(jailed);
  inJail.phase = 'roll';
  const stayed = act(inJail, 'ROLL', { dice: [1, 2] });
  assert.deepEqual(getRollMovement(inJail, stayed), { playerId: 'p1', steps: [] });
  const released = act(inJail, 'ROLL', { dice: [2, 2] });
  assert.deepEqual(getRollMovement(inJail, released), { playerId: 'p1', steps: [8, 9, 10, 11] });
});

test('chance movement traces include the landing tile before returning to start or entering jail', () => {
  const before = fresh();
  before.round = 8; // [1,1] landing on 2 selects the existing return-to-start card.
  const home = act(before, 'ROLL', { dice: [1, 1] });
  assert.equal(home.players[0].position, 0);
  assert.deepEqual(getRollMovement(before, home), {
    playerId: 'p1', steps: [1, 2, 0], redirects: [{ index: 2, from: 2, to: 0, reason: 'chance' }],
  });
  before.round = 1;
  const jailed = act(before, 'ROLL', { dice: [1, 1] });
  assert.deepEqual(getRollMovement(before, jailed), {
    playerId: 'p1', steps: [1, 2, 7], redirects: [{ index: 2, from: 2, to: 7, reason: 'jail' }],
  });
  before.round = 5;
  before.players[0].position = 31;
  const wrappedHome = act(before, 'ROLL', { dice: [1, 2] });
  assert.deepEqual(getRollMovement(before, wrappedHome), {
    playerId: 'p1', steps: [0, 1, 2, 0], redirects: [{ index: 3, from: 2, to: 0, reason: 'chance' }],
  });
  assert.equal(wrappedHome.players[0].cash, before.players[0].cash + 4000);
});
