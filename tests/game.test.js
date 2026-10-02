import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, PLAYER_COLORS, ANIMALS, CHANCE_CARDS, createGame, applyAction, getCurrentPlayer, getPlayerAnimal, getChanceCard, getRollMovement, getChanceMovement, getRent, getNetWorth, canBuild, validateState } from '../src/game.js';

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
    const pending = applyAction(state, action);
    assert.equal(pending.phase, 'chance');
    assert.equal(pending.players[0].cash, state.players[0].cash);
    assert.equal(pending.players[0].position, 2);
    assert.equal(pending.chanceCard, null);
    const result = act(pending, 'DRAW_CHANCE');
    assert.deepEqual(result, act(pending, 'DRAW_CHANCE'));
    assert.equal(validateState(result), true);
    assert.equal(result.phase, 'end');
    const card = getChanceCard(result);
    assert.ok(CHANCE_CARDS.includes(card));
    assert.equal(result.players[0].cash, state.players[0].cash + (card.amount ?? 0));
    outcomes.add(card.id);
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
    if (state.phase === 'chance') state = act(state, 'DRAW_CHANCE');
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

test('roll and card movement traces separately stop on chance then return to start or enter jail', () => {
  const before = fresh();
  before.round = 8; // [1,1] landing on 2 selects the existing return-to-start card.
  const pendingHome = act(before, 'ROLL', { dice: [1, 1] });
  assert.deepEqual(getRollMovement(before, pendingHome), { playerId: 'p1', steps: [1, 2] });
  const home = act(pendingHome, 'DRAW_CHANCE');
  assert.equal(home.players[0].position, 0);
  assert.deepEqual(getChanceMovement(pendingHome, home), {
    playerId: 'p1', steps: [0], redirects: [{ index: 0, from: 2, to: 0, reason: 'chance' }],
  });
  before.round = 1;
  const pendingJail = act(before, 'ROLL', { dice: [1, 1] });
  const jailed = act(pendingJail, 'DRAW_CHANCE');
  assert.deepEqual(getChanceMovement(pendingJail, jailed), {
    playerId: 'p1', steps: [7], redirects: [{ index: 0, from: 2, to: 7, reason: 'jail' }],
  });
  before.round = 5;
  before.players[0].position = 31;
  const pendingWrapped = act(before, 'ROLL', { dice: [1, 2] });
  assert.deepEqual(getRollMovement(before, pendingWrapped), { playerId: 'p1', steps: [0, 1, 2] });
  const wrappedHome = act(pendingWrapped, 'DRAW_CHANCE');
  assert.deepEqual(getChanceMovement(pendingWrapped, wrappedHome), {
    playerId: 'p1', steps: [0], redirects: [{ index: 0, from: 2, to: 0, reason: 'chance' }],
  });
  assert.equal(wrappedHome.players[0].cash, before.players[0].cash + 4000);
});

test('chance must be drawn explicitly and pending or resolved reloads cannot pay twice', () => {
  const initial = fresh();
  initial.round = 4; // Dividend card: +1200.
  const pending = act(initial, 'ROLL', { dice: [1, 1] });
  const pendingJSON = JSON.stringify(pending);
  const reloadedPending = JSON.parse(pendingJSON);
  assert.equal(validateState(reloadedPending), true);
  assert.equal(getChanceCard(reloadedPending), null);
  assert.throws(() => act(reloadedPending, 'END_TURN'));
  assert.throws(() => act(reloadedPending, 'ROLL', { dice: [1, 2] }));
  assert.throws(() => act(reloadedPending, 'DRAW_CHANCE', { playerId: 'p2' }));
  const drawn = act(reloadedPending, 'DRAW_CHANCE');
  assert.equal(JSON.stringify(pending), pendingJSON);
  assert.equal(drawn.players[0].cash, 16200);
  assert.deepEqual(drawn.chanceCard, { id: 'dividend', playerId: 'p1' });
  assert.equal(getChanceCard(drawn).title, '创业分红');
  const reloadedDrawn = JSON.parse(JSON.stringify(drawn));
  assert.equal(validateState(reloadedDrawn), true);
  assert.equal(getChanceCard(reloadedDrawn).amount, 1200);
  assert.throws(() => act(reloadedDrawn, 'DRAW_CHANCE'));
  assert.equal(reloadedDrawn.players[0].cash, 16200);
  assert.deepEqual(getChanceMovement(reloadedPending, drawn), { playerId: 'p1', steps: [] });
  const changedAnimal = act(drawn, 'SET_ANIMAL', { playerId: 'p1', animalId: 'fox' });
  assert.deepEqual(changedAnimal.chanceCard, drawn.chanceCard);
  const nextTurn = act(changedAnimal, 'END_TURN');
  assert.deepEqual(nextTurn.chanceCard, drawn.chanceCard);
  const nextRoll = act(nextTurn, 'ROLL', { dice: [1, 3] });
  assert.equal(nextRoll.chanceCard, null);
});

test('a card expense creates debt only on drawing and still requires mortgage or bankruptcy', () => {
  const initial = fresh();
  initial.round = 7; // Travel expense: -1000.
  initial.players[0].cash = 100;
  own(initial, 11); // Mortgage value 1000.
  const pending = act(initial, 'ROLL', { dice: [1, 1] });
  assert.equal(pending.players[0].cash, 100);
  const drawn = act(pending, 'DRAW_CHANCE');
  assert.equal(drawn.players[0].cash, -900);
  assert.equal(drawn.chanceCard.id, 'travel');
  assert.throws(() => act(drawn, 'END_TURN'));
  assert.throws(() => act(drawn, 'DRAW_CHANCE'));
  const funded = act(drawn, 'MORTGAGE', { tileId: 11 });
  assert.equal(funded.players[0].cash, 100);
  assert.equal(funded.chanceCard.id, 'travel');
  assert.equal(act(funded, 'END_TURN').currentPlayer, 1);
});

test('schema version 1 saves without chance cards or animals remain playable', () => {
  const legacy = fresh();
  delete legacy.chanceCard;
  legacy.players.forEach(player => { delete player.animal; });
  assert.equal(validateState(legacy), true);
  const pending = act(legacy, 'ROLL', { dice: [1, 1] });
  assert.equal(pending.schemaVersion, 1);
  assert.equal(pending.phase, 'chance');
  const drawn = act(pending, 'DRAW_CHANCE');
  assert.equal(validateState(drawn), true);
  assert.equal(drawn.players[0].jailed, 2);

  // An old version already settled its card while landing. Reading that saved
  // end phase must never reinterpret the tile as a new card to pay again.
  legacy.round = 4;
  legacy.players[0].position = 2;
  legacy.players[0].cash = 16200;
  legacy.phase = 'end';
  legacy.dice = [1, 1];
  assert.equal(validateState(legacy), true);
  assert.equal(getChanceCard(legacy), null);
  assert.throws(() => act(legacy, 'DRAW_CHANCE'));
  assert.equal(act(legacy, 'END_TURN').players[0].cash, 16200);
});

test('invalid chance phases and unknown card records cannot enter saved state', () => {
  const invalid = [
    state => { state.phase = 'chance'; },
    state => { state.chanceCard = { id: 'fake', playerId: 'p1' }; },
    state => { state.chanceCard = { id: 'dividend', playerId: 'missing' }; },
    state => { state.chanceCard = []; },
  ];
  for (const mutate of invalid) {
    const state = fresh();
    mutate(state);
    assert.equal(validateState(state), false);
  }
  const pending = act(fresh(), 'ROLL', { dice: [1, 1] });
  const alreadyDrawn = structuredClone(pending);
  alreadyDrawn.chanceCard = { id: 'dividend', playerId: 'p1' };
  assert.equal(validateState(alreadyDrawn), false);
  pending.dice = null;
  assert.equal(validateState(pending), false);
});

test('a six-card offer is committed with the roll and survives reloads without reshuffling', () => {
  const initial = fresh();
  const cards = ['treasure', 'dividend', 'travel', 'return-start', 'go-to-jail', 'repairs'];
  const expectedCards = [...cards];
  const pending = act(initial, 'ROLL', { dice: [1, 1], chanceCards: cards });
  cards[0] = 'lottery';
  assert.equal(pending.phase, 'chance');
  assert.equal(pending.players[0].cash, initial.players[0].cash);
  assert.equal(pending.players[0].position, 2);
  assert.deepEqual(pending.chanceOffer, expectedCards);
  assert.equal(new Set(pending.chanceOffer).size, 6);
  assert.equal(pending.chanceCard, null);
  assert.equal(initial.chanceOffer, null);

  const restored = JSON.parse(JSON.stringify(pending));
  assert.equal(validateState(restored), true);
  assert.deepEqual(restored.chanceOffer, expectedCards);
  const changedAnimal = act(restored, 'SET_ANIMAL', { playerId: 'p2', animalId: 'panda' });
  assert.deepEqual(changedAnimal.chanceOffer, expectedCards);
  const beforeRetry = JSON.stringify(restored);
  assert.throws(() => act(restored, 'PREPARE_CHANCE', { chanceCards: expectedCards }));
  assert.throws(() => act(restored, 'PREPARE_CHANCE', { chanceCards: [...expectedCards].reverse() }));
  assert.equal(JSON.stringify(restored), beforeRetry);

  const drawn = act(restored, 'DRAW_CHANCE', { cardIndex: 1 });
  assert.deepEqual(drawn.chanceOffer, expectedCards);
  assert.equal(drawn.chanceCard.id, 'dividend');
  const reloadedDrawn = JSON.parse(JSON.stringify(drawn));
  assert.throws(() => act(reloadedDrawn, 'DRAW_CHANCE', { cardIndex: 0 }));
  assert.equal(reloadedDrawn.players[0].cash, 16200);
  const next = act(reloadedDrawn, 'END_TURN');
  assert.deepEqual(next.chanceOffer, expectedCards);
  const rolledAgain = act(next, 'ROLL', { dice: [1, 3], chanceCards: expectedCards });
  assert.equal(rolledAgain.chanceOffer, null);
  assert.equal(rolledAgain.chanceCard, null);
});

test('each of the six indexes selects its own effect and movement replays the selected card', () => {
  const cards = ['treasure', 'dividend', 'travel', 'return-start', 'go-to-jail', 'repairs'];
  const pending = act(fresh(), 'ROLL', { dice: [1, 1], chanceCards: cards });
  const pendingJSON = JSON.stringify(pending);
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const drawn = act(pending, 'DRAW_CHANCE', { cardIndex });
    const card = CHANCE_CARDS.find(item => item.id === cards[cardIndex]);
    assert.equal(drawn.phase, 'end');
    assert.deepEqual(drawn.chanceCard, { id: card.id, playerId: 'p1' });
    assert.equal(drawn.players[0].cash, 15000 + (card.amount ?? 0));
    assert.equal(drawn.players[0].position, card.destination ?? 2);
    assert.equal(drawn.players[0].jailed, card.kind === 'jail' ? 2 : 0);
    assert.equal(validateState(drawn), true);
    const movement = card.destination === undefined ? { playerId: 'p1', steps: [] } : {
      playerId: 'p1', steps: [card.destination],
      redirects: [{ index: 0, from: 2, to: card.destination, reason: card.kind === 'jail' ? 'jail' : 'chance' }],
    };
    assert.deepEqual(getChanceMovement(pending, drawn), movement);
    assert.equal(JSON.stringify(pending), pendingJSON);
  }
  const legacyAction = act(pending, 'DRAW_CHANCE');
  assert.equal(legacyAction.chanceCard.id, cards[0]);
  assert.equal(legacyAction.players[0].cash, 15500);
});

test('invalid offers and indexes cannot be saved or replace a valid pending choice', () => {
  const cards = ['treasure', 'dividend', 'travel', 'return-start', 'go-to-jail', 'repairs'];
  const invalidOffers = [
    null, [], cards.slice(0, 5), [...cards, 'lottery'],
    ['treasure', 'treasure', ...cards.slice(2)],
    ['unknown-card', ...cards.slice(1)],
    [, ...cards.slice(1)],
  ];
  const initial = fresh();
  const pending = act(initial, 'ROLL', { dice: [1, 1], chanceCards: cards });
  const legacy = structuredClone(pending);
  delete legacy.chanceOffer;
  assert.equal(validateState(legacy), true);
  for (const chanceCards of invalidOffers) {
    assert.throws(() => act(initial, 'ROLL', { dice: [1, 1], chanceCards }));
    assert.throws(() => act(legacy, 'PREPARE_CHANCE', { chanceCards }));
    if (chanceCards !== null) {
      const invalid = structuredClone(pending);
      invalid.chanceOffer = chanceCards;
      assert.equal(validateState(invalid), false);
    }
  }
  for (const cardIndex of [-1, 6, 1.5, NaN, Infinity, '2', null, {}]) {
    assert.throws(() => act(pending, 'DRAW_CHANCE', { cardIndex }));
  }
  assert.equal(pending.phase, 'chance');
  assert.equal(pending.chanceCard, null);
  assert.equal(pending.players[0].cash, 15000);
  const outsideOffer = act(pending, 'DRAW_CHANCE', { cardIndex: 0 });
  outsideOffer.chanceCard.id = 'lottery';
  assert.equal(validateState(outsideOffer), false);
});

test('old pending games may receive an offer once without changing their economic progress', () => {
  const legacy = act(fresh(), 'ROLL', { dice: [1, 1] });
  delete legacy.chanceOffer;
  const original = structuredClone(legacy);
  const cards = ['dividend', 'repairs', 'lottery', 'travel', 'return-start', 'go-to-jail'];
  const prepared = act(legacy, 'PREPARE_CHANCE', { chanceCards: cards });
  const expected = structuredClone(original);
  expected.chanceOffer = [...cards];
  expected.updatedAt = prepared.updatedAt;
  assert.deepEqual(prepared, expected);
  assert.deepEqual(legacy, original);
  assert.equal(validateState(JSON.parse(JSON.stringify(prepared))), true);
  assert.throws(() => act(prepared, 'PREPARE_CHANCE', { chanceCards: [...cards].reverse() }));
  const drawn = act(prepared, 'DRAW_CHANCE', { cardIndex: 4 });
  assert.equal(drawn.chanceCard.id, 'return-start');
  assert.equal(drawn.players[0].position, 0);
  assert.deepEqual(getChanceMovement(prepared, drawn), {
    playerId: 'p1', steps: [0], redirects: [{ index: 0, from: 2, to: 0, reason: 'chance' }],
  });

  // Older callers can still draw without PREPARE_CHANCE or an explicit index.
  const oldDraw = act(legacy, 'DRAW_CHANCE');
  assert.equal(oldDraw.chanceCard.id, 'go-to-jail');
  assert.equal(oldDraw.chanceOffer.length, 6);
  assert.deepEqual(getChanceMovement(legacy, oldDraw), {
    playerId: 'p1', steps: [7], redirects: [{ index: 0, from: 2, to: 7, reason: 'jail' }],
  });
  const oldResolved = structuredClone(oldDraw);
  delete oldResolved.chanceOffer;
  assert.equal(validateState(oldResolved), true);
  assert.throws(() => act(oldResolved, 'PREPARE_CHANCE', { chanceCards: cards }));
  assert.throws(() => act(oldResolved, 'DRAW_CHANCE', { cardIndex: 0 }));
});
