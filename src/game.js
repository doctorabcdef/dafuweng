// The complete, serializable game rules. No network or DOM dependencies.
export const PLAYER_COLORS = Object.freeze(['#fb923c', '#38bdf8', '#a78bfa', '#34d399']);
export const ANIMALS = Object.freeze([
  { id: 'cat', name: '小猫', emoji: '🐱' },
  { id: 'dog', name: '小狗', emoji: '🐶' },
  { id: 'rabbit', name: '兔子', emoji: '🐰' },
  { id: 'fox', name: '狐狸', emoji: '🦊' },
  { id: 'panda', name: '熊猫', emoji: '🐼' },
  { id: 'bear', name: '小熊', emoji: '🐻' },
  { id: 'tiger', name: '老虎', emoji: '🐯' },
  { id: 'lion', name: '狮子', emoji: '🦁' },
  { id: 'koala', name: '考拉', emoji: '🐨' },
  { id: 'frog', name: '青蛙', emoji: '🐸' },
  { id: 'pig', name: '小猪', emoji: '🐷' },
  { id: 'monkey', name: '猴子', emoji: '🐵' },
  { id: 'penguin', name: '企鹅', emoji: '🐧' },
  { id: 'chick', name: '小鸡', emoji: '🐤' },
  { id: 'elephant', name: '大象', emoji: '🐘' },
  { id: 'dolphin', name: '海豚', emoji: '🐬' },
].map(Object.freeze));
const ANIMAL_BY_ID = new Map(ANIMALS.map(animal => [animal.id, animal]));

export function getPlayerAnimal(player, index = 0) {
  return ANIMAL_BY_ID.get(player?.animal) ?? ANIMALS[(Number.isInteger(index) && index >= 0 ? index : 0) % ANIMALS.length];
}

export const CHANCE_CARDS = Object.freeze([
  { id: 'dividend', title: '创业分红', description: '你的投资获得回报，领取 ¥1,200。', kind: 'income', amount: 1200 },
  { id: 'repairs', title: '房屋修缮', description: '支付房屋维护费用 ¥600。', kind: 'expense', amount: -600 },
  { id: 'lottery', title: '幸运奖金', description: '幸运降临，领取 ¥800 奖金。', kind: 'income', amount: 800 },
  { id: 'travel', title: '旅行开销', description: '为环球旅行支付 ¥1,000。', kind: 'expense', amount: -1000 },
  { id: 'return-start', title: '返回起点', description: '直接返回起点，并领取 ¥2,000。', kind: 'move', amount: 2000, destination: 0 },
  { id: 'go-to-jail', title: '前往监狱', description: '直接前往监狱，最多停留 2 回合。经过起点不领取奖金。', kind: 'jail', destination: 7 },
  { id: 'city-award', title: '城市建设奖', description: '建设有功，领取 ¥1,500 奖励。', kind: 'income', amount: 1500 },
  { id: 'treasure', title: '城市宝藏', description: '发现藏在街角的宝藏，领取 ¥500。', kind: 'income', amount: 500 },
].map(Object.freeze));
const CHANCE_BY_ID = new Map(CHANCE_CARDS.map(card => [card.id, card]));
const CHANCE_OFFER_SIZE = 6;
const validChanceOffer = cards => Array.isArray(cards) && cards.length === CHANCE_OFFER_SIZE &&
  new Set(cards).size === CHANCE_OFFER_SIZE && Array.from(cards).every(id => CHANCE_BY_ID.has(id));

export function getChanceCard(state) {
  return CHANCE_BY_ID.get(state?.chanceCard?.id) ?? null;
}

export const BOARD = Object.freeze([
  { id: 0, name: '起点', type: 'start' },
  { id: 1, name: '中国', type: 'property', color: '#22d3ee', price: 1000, baseRent: 150, group: 'coast' },
  { id: 2, name: '奇遇', type: 'chance' },
  { id: 3, name: '日本', type: 'property', color: '#22d3ee', price: 1200, baseRent: 180, group: 'coast' },
  { id: 4, name: '城市税', type: 'tax' },
  { id: 5, name: '韩国', type: 'property', color: '#4ade80', price: 1400, baseRent: 210, group: 'garden' },
  { id: 6, name: '新加坡', type: 'property', color: '#4ade80', price: 1600, baseRent: 240, group: 'garden' },
  { id: 7, name: '探访 / 监狱', type: 'jail' },
  { id: 8, name: '泰国', type: 'property', color: '#60a5fa', price: 1800, baseRent: 270, group: 'river' },
  { id: 9, name: '印度', type: 'property', color: '#60a5fa', price: 1800, baseRent: 270, group: 'river' },
  { id: 10, name: '奇遇', type: 'chance' },
  { id: 11, name: '法国', type: 'property', color: '#fb923c', price: 2000, baseRent: 300, group: 'food' },
  { id: 12, name: '德国', type: 'property', color: '#fb923c', price: 2200, baseRent: 330, group: 'food' },
  { id: 13, name: '自由公园', type: 'parking' },
  { id: 14, name: '意大利', type: 'property', color: '#f87171', price: 2400, baseRent: 360, group: 'history' },
  { id: 15, name: '西班牙', type: 'property', color: '#f87171', price: 2400, baseRent: 360, group: 'history' },
  { id: 16, name: '英国', type: 'property', color: '#c084fc', price: 2600, baseRent: 390, group: 'bay' },
  { id: 17, name: '奇遇', type: 'chance' },
  { id: 18, name: '瑞士', type: 'property', color: '#c084fc', price: 2800, baseRent: 420, group: 'bay' },
  { id: 19, name: '城市税', type: 'tax' },
  { id: 20, name: '美国', type: 'property', color: '#818cf8', price: 3000, baseRent: 450, group: 'capital' },
  { id: 21, name: '加拿大', type: 'property', color: '#818cf8', price: 3200, baseRent: 480, group: 'capital' },
  { id: 22, name: '奇遇', type: 'chance' },
  { id: 23, name: '巴西', type: 'property', color: '#f472b6', price: 2600, baseRent: 390, group: 'holiday' },
  { id: 24, name: '阿根廷', type: 'property', color: '#f472b6', price: 2800, baseRent: 420, group: 'holiday' },
  { id: 25, name: '前往监狱', type: 'goToJail' },
  { id: 26, name: '澳大利亚', type: 'property', color: '#2dd4bf', price: 3000, baseRent: 450, group: 'nature' },
  { id: 27, name: '新西兰', type: 'property', color: '#2dd4bf', price: 3200, baseRent: 480, group: 'nature' },
  { id: 28, name: '城市税', type: 'tax' },
  { id: 29, name: '埃及', type: 'property', color: '#fbbf24', price: 3600, baseRent: 540, group: 'gold' },
  { id: 30, name: '奇遇', type: 'chance' },
  { id: 31, name: '南非', type: 'property', color: '#fbbf24', price: 4000, baseRent: 600, group: 'gold' },
].map(Object.freeze));

const ESTATES = BOARD.filter(tile => tile.type === 'property');
const MAX_MONEY = 1_000_000_000;
const PHASES = new Set(['roll', 'buy', 'chance', 'end', 'gameover']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const money = value => Number.isSafeInteger(value) && Math.abs(value) <= MAX_MONEY;
const shortString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const buildCost = tile => Math.ceil(tile.price / 2);
const mortgageValue = tile => Math.floor(tile.price / 2);
const redeemCost = tile => Math.ceil(mortgageValue(tile) * 11 / 10);

function timestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('时间格式不正确。');
  return date.toISOString();
}

export function createGame({ names = ['小橙', '小蓝'], startingCash = 15000, animals } = {}, { id, now = Date.now() } = {}) {
  if (!Array.isArray(names) || names.length < 2 || names.length > 4 || names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 16)) {
    throw new Error('请填写 2–4 位玩家的名字，每个名字最多 16 个字。');
  }
  if (animals !== undefined && (!Array.isArray(animals) || animals.length > names.length || animals.some(animal => !ANIMAL_BY_ID.has(animal)))) {
    throw new Error('请选择有效的动物角色。');
  }
  if (!money(startingCash) || startingCash < 1000 || startingCash > 1000000) throw new Error('初始资金须为 1000–1000000 的整数。');
  if (id !== undefined && !shortString(id, 100)) throw new Error('对局编号不正确。');
  const createdAt = timestamp(now);
  const gameId = id ?? globalThis.crypto?.randomUUID?.() ?? `game-${Date.parse(createdAt)}-${Math.random().toString(36).slice(2, 10)}`;
  const players = names.map((name, index) => ({
    id: `p${index + 1}`, name: name.trim(), color: PLAYER_COLORS[index], position: 0,
    cash: startingCash, jailed: 0, bankrupt: false, animal: getPlayerAnimal({ animal: animals?.[index] }, index).id,
  }));
  const lastEvent = `欢迎来到城市大富翁！${players[0].name}先掷骰。`;
  return {
    schemaVersion: 1, id: gameId, createdAt, updatedAt: createdAt, round: 1, currentPlayer: 0, phase: 'roll', players,
    properties: Object.fromEntries(ESTATES.map(tile => [tile.id, { ownerId: null, level: 0, mortgaged: false }])),
    dice: null, lastEvent, logs: [{ id: '1', text: lastEvent }], winnerId: null, chanceCard: null, chanceOffer: null,
  };
}

export function getCurrentPlayer(state) {
  return state.players[state.currentPlayer];
}

function tileFor(tileId) {
  if (typeof tileId !== 'number' && typeof tileId !== 'string') return undefined;
  const id = Number(tileId);
  return Number.isInteger(id) && id >= 0 && id < BOARD.length ? BOARD[id] : undefined;
}

export function getRent(state, tileId) {
  const tile = tileFor(tileId);
  if (!tile || tile.type !== 'property') return 0;
  const property = state.properties[tile.id];
  if (!property || !property.ownerId || property.mortgaged) return 0;
  const fullGroup = ESTATES.filter(item => item.group === tile.group).every(item => {
    const other = state.properties[item.id];
    return other.ownerId === property.ownerId && !other.mortgaged;
  });
  return tile.baseRent * (property.level === 0 && fullGroup ? 2 : [1, 2, 4, 7][property.level]);
}

export function getNetWorth(state, playerId) {
  const player = state.players.find(item => item.id === playerId);
  if (!player || player.bankrupt) return 0;
  return ESTATES.reduce((total, tile) => {
    const property = state.properties[tile.id];
    return property.ownerId === playerId ? total + tile.price - (property.mortgaged ? mortgageValue(tile) : 0) + property.level * buildCost(tile) : total;
  }, player.cash);
}

export function canBuild(state, tileId) {
  const tile = tileFor(tileId);
  if (!tile || tile.type !== 'property' || state.phase === 'gameover') return false;
  const player = getCurrentPlayer(state);
  const property = state.properties[tile.id];
  return !player.bankrupt && player.cash >= buildCost(tile) && property.ownerId === player.id && !property.mortgaged && property.level < 3 &&
    ESTATES.filter(item => item.group === tile.group).every(item => state.properties[item.id].ownerId === player.id && !state.properties[item.id].mortgaged);
}

/** Validate persisted / received game data before it reaches the rules or UI. */
export function validateState(value) {
  try {
    if (!isRecord(value) || value.schemaVersion !== 1 || !shortString(value.id, 100)) return false;
    if (![value.createdAt, value.updatedAt].every(item => typeof item === 'string' && Number.isFinite(Date.parse(item)))) return false;
    if (!Number.isSafeInteger(value.round) || value.round < 1 || !PHASES.has(value.phase)) return false;
    if (!Array.isArray(value.players) || value.players.length < 2 || value.players.length > 4) return false;
    const ids = new Set();
    for (const player of value.players) {
      if (!isRecord(player) || !shortString(player.id, 32) || ids.has(player.id) || !shortString(player.name, 16) || !/^#[0-9a-f]{6}$/i.test(player.color)) return false;
      if (!Number.isInteger(player.position) || player.position < 0 || player.position >= BOARD.length || !money(player.cash)) return false;
      if (!Number.isInteger(player.jailed) || player.jailed < 0 || player.jailed > 2 || typeof player.bankrupt !== 'boolean') return false;
      if (player.jailed > 0 && player.position !== 7) return false;
      if (player.bankrupt && (player.cash !== 0 || player.jailed !== 0)) return false;
      if (player.animal !== undefined && !ANIMAL_BY_ID.has(player.animal)) return false;
      ids.add(player.id);
    }
    if (!Number.isInteger(value.currentPlayer) || value.currentPlayer < 0 || value.currentPlayer >= value.players.length || getCurrentPlayer(value).bankrupt) return false;
    if (!isRecord(value.properties) || Object.keys(value.properties).length !== ESTATES.length) return false;
    for (const tile of ESTATES) {
      if (!own(value.properties, tile.id)) return false;
      const property = value.properties[tile.id];
      if (!isRecord(property) || !Number.isInteger(property.level) || property.level < 0 || property.level > 3 || typeof property.mortgaged !== 'boolean') return false;
      if (property.ownerId !== null && (!ids.has(property.ownerId) || value.players.find(player => player.id === property.ownerId).bankrupt)) return false;
      if ((property.ownerId === null || property.mortgaged) && property.level !== 0) return false;
      if (property.ownerId === null && property.mortgaged) return false;
    }
    if (value.dice !== null && (!Array.isArray(value.dice) || value.dice.length !== 2 || !value.dice.every(die => Number.isInteger(die) && die >= 1 && die <= 6))) return false;
    if (value.chanceCard !== undefined && value.chanceCard !== null &&
        (!isRecord(value.chanceCard) || !CHANCE_BY_ID.has(value.chanceCard.id) || !ids.has(value.chanceCard.playerId))) return false;
    if (value.chanceOffer !== undefined && value.chanceOffer !== null && !validChanceOffer(value.chanceOffer)) return false;
    if (value.chanceCard && value.chanceOffer && !value.chanceOffer.includes(value.chanceCard.id)) return false;
    if (!shortString(value.lastEvent, 600) || !Array.isArray(value.logs) || value.logs.length < 1 || value.logs.length > 60) return false;
    if (value.logs.some(log => !isRecord(log) || typeof log.id !== 'string' || !/^\d{1,15}$/.test(log.id) || !shortString(log.text, 600))) return false;
    const alive = value.players.filter(player => !player.bankrupt);
    if (value.phase === 'gameover') {
      if (alive.length !== 1 || value.winnerId !== alive[0].id || getCurrentPlayer(value).id !== value.winnerId) return false;
    } else if (alive.length < 2 || value.winnerId !== null) return false;
    if (value.phase === 'buy') {
      const tile = BOARD[getCurrentPlayer(value).position];
      if (tile.type !== 'property' || value.properties[tile.id].ownerId !== null) return false;
    }
    if (value.phase === 'chance') {
      const player = getCurrentPlayer(value);
      if (BOARD[player.position].type !== 'chance' || player.jailed || !value.dice || value.chanceCard != null) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function log(state, text) {
  const id = String(Number(state.logs.at(-1)?.id ?? 0) + 1);
  state.logs.push({ id, text });
  if (state.logs.length > 60) state.logs.splice(0, state.logs.length - 60);
  state.lastEvent = text;
}

function nextTurn(state) {
  const alive = state.players.filter(player => !player.bankrupt);
  if (alive.length === 1) {
    state.phase = 'gameover';
    state.winnerId = alive[0].id;
    state.currentPlayer = state.players.findIndex(player => player.id === alive[0].id);
    log(state, `恭喜${alive[0].name}！成为本局城市大富翁。`);
    return;
  }
  do {
    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    if (state.currentPlayer === 0) state.round += 1;
  } while (getCurrentPlayer(state).bankrupt);
  state.phase = 'roll';
  state.dice = null;
  log(state, `轮到${getCurrentPlayer(state).name}，准备掷骰。`);
}

function movePlayer(player, destination, trace, reason) {
  if (trace) {
    if (reason) {
      trace.redirects ??= [];
      trace.redirects.push({ index: trace.steps.length, from: player.position, to: destination, reason });
    }
    trace.steps.push(destination);
  }
  player.position = destination;
}

function jail(state, player, trace) {
  movePlayer(player, 7, trace, 'jail');
  player.jailed = 2;
  state.phase = 'end';
  log(state, `${player.name}进入监狱，最多停留 2 回合；掷出双数或支付 ¥500 可提前出狱。`);
}

function defaultChanceOffer(state) {
  // Older callers do not provide random cards. Keep their original outcome as
  // the first option while still creating a stable six-card, no-repeat offer.
  const player = getCurrentPlayer(state);
  const index = (state.dice[0] * 7 + state.dice[1] * 3 + state.round + state.currentPlayer + player.position) % CHANCE_CARDS.length;
  return Array.from({ length: CHANCE_OFFER_SIZE }, (_, offset) => CHANCE_CARDS[(index + offset) % CHANCE_CARDS.length].id);
}

function drawChance(state, player, cardIndex, trace) {
  // Randomness is injected when the offer is prepared, never when an existing
  // offer is viewed or selected. A resolved phase cannot settle another card.
  if (state.chanceOffer == null) state.chanceOffer = defaultChanceOffer(state);
  const card = CHANCE_BY_ID.get(state.chanceOffer[cardIndex]);
  state.phase = 'end';
  state.chanceCard = { id: card.id, playerId: player.id };
  if (card.kind === 'jail') {
    jail(state, player, trace);
  } else {
    if (card.kind === 'move') movePlayer(player, card.destination, trace, 'chance');
    player.cash += card.amount;
    log(state, `奇遇 · ${card.title}！${player.name}${card.amount < 0 ? '支付' : '领取'} ¥${Math.abs(card.amount).toLocaleString('en-US')}。`);
  }
  warnDebt(state, player);
}

function warnDebt(state, player) {
  if (player.cash < 0) log(state, `${player.name}资金不足，还差 ¥${(-player.cash).toLocaleString('en-US')}。请抵押地产偿还债务，或宣布破产。`);
}

function land(state, player, trace, chanceCards) {
  const tile = BOARD[player.position];
  state.phase = 'end';
  if (tile.type === 'property') {
    const property = state.properties[tile.id];
    if (!property.ownerId) {
      state.phase = 'buy';
      log(state, `${player.name}来到${tile.name}，可以花 ¥${tile.price.toLocaleString('en-US')}买下这里。`);
    } else if (property.ownerId === player.id) {
      log(state, `${player.name}回到了自己的${tile.name}。`);
    } else {
      const owner = state.players.find(item => item.id === property.ownerId);
      const rent = getRent(state, tile.id);
      player.cash -= rent;
      owner.cash += rent;
      log(state, rent ? `${player.name}向${owner.name}支付${tile.name}租金 ¥${rent.toLocaleString('en-US')}。` : `${tile.name}已抵押，本次免收租金。`);
    }
  } else if (tile.type === 'tax') {
    player.cash -= 800;
    log(state, `${player.name}缴纳城市税 ¥800。`);
  } else if (tile.type === 'chance') {
    state.phase = 'chance';
    state.chanceCard = null;
    state.chanceOffer = chanceCards === undefined ? defaultChanceOffer(state) : [...chanceCards];
    log(state, `${player.name}来到机遇格，请抽取一张机遇卡。`);
  } else if (tile.type === 'goToJail') {
    jail(state, player, trace);
  } else if (tile.type === 'start') {
    log(state, `${player.name}抵达起点。继续向城市梦想出发！`);
  } else if (tile.type === 'jail') {
    log(state, `${player.name}只是路过监狱，无需停留。`);
  } else {
    log(state, `${player.name}来到自由公园，休息一下。`);
  }
  warnDebt(state, player);
}

/** Atomically return a new state. The caller supplies dice and optionally now. */
export function applyAction(previous, action) {
  return executeAction(previous, action);
}

function executeAction(previous, action, trace) {
  if (!validateState(previous)) throw new Error('对局存档无效，请恢复有效存档。');
  if (!isRecord(action) || typeof action.type !== 'string') throw new Error('无效的游戏操作。');
  if (previous.phase === 'gameover' && action.type !== 'SET_ANIMAL') throw new Error('本局已结束，请开始新对局。');
  const state = structuredClone(previous);
  const player = getCurrentPlayer(state);
  if (action.type !== 'SET_ANIMAL' && action.playerId !== undefined && action.playerId !== player.id) throw new Error('还没有轮到这位玩家。');
  const requireCash = amount => {
    if (player.cash < amount) throw new Error('现金不足，请先抵押地产筹集资金。');
  };
  const requirePhase = phase => {
    if (state.phase !== phase) throw new Error(phase === 'roll' ? '本回合已经掷过骰子。' : '当前阶段不能执行这个操作。');
  };
  const ownedTile = () => {
    const tile = tileFor(action.tileId);
    if (!tile || tile.type !== 'property' || state.properties[tile.id].ownerId !== player.id) throw new Error('只能操作当前玩家自己的地产。');
    return tile;
  };

  switch (action.type) {
    case 'SET_ANIMAL': {
      const target = state.players.find(item => item.id === action.playerId);
      if (!target) throw new Error('找不到要更换角色的玩家。');
      if (!ANIMAL_BY_ID.has(action.animalId)) throw new Error('请选择有效的动物角色。');
      target.animal = action.animalId;
      break;
    }
    case 'ROLL': {
      requirePhase('roll');
      requireCash(0);
      if (!Array.isArray(action.dice) || action.dice.length !== 2 || !action.dice.every(die => Number.isInteger(die) && die >= 1 && die <= 6)) throw new Error('骰子必须是两个 1–6 的整数。');
      if (action.chanceCards !== undefined && !validChanceOffer(action.chanceCards)) throw new Error('机遇候选必须是 6 张不同的有效卡片。');
      state.dice = [...action.dice];
      state.chanceCard = null;
      state.chanceOffer = null;
      const steps = state.dice[0] + state.dice[1];
      log(state, `${player.name}掷出 ${state.dice[0]} + ${state.dice[1]} = ${steps} 点。`);
      if (player.jailed > 0) {
        if (state.dice[0] !== state.dice[1]) {
          player.jailed -= 1;
          state.phase = 'end';
          log(state, player.jailed ? `${player.name}未掷出双数，仍需停留 ${player.jailed} 回合。` : `${player.name}已服刑完毕，下回合可以自由行动。`);
          break;
        }
        player.jailed = 0;
        log(state, `${player.name}掷出双数，立即出狱！`);
      }
      if (player.position + steps >= BOARD.length) {
        player.cash += 2000;
        log(state, `${player.name}经过起点，领取 ¥2,000。`);
      }
      for (let step = 0; step < steps; step += 1) movePlayer(player, (player.position + 1) % BOARD.length, trace);
      land(state, player, trace, action.chanceCards);
      break;
    }
    case 'PREPARE_CHANCE':
      requirePhase('chance');
      if (state.chanceOffer != null) throw new Error('这次机遇已发牌，不能重新洗牌。');
      if (!validChanceOffer(action.chanceCards)) throw new Error('机遇候选必须是 6 张不同的有效卡片。');
      state.chanceOffer = [...action.chanceCards];
      break;
    case 'DRAW_CHANCE': {
      requirePhase('chance');
      const cardIndex = action.cardIndex === undefined ? 0 : action.cardIndex;
      if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= CHANCE_OFFER_SIZE) throw new Error('请选择第 1–6 张机遇卡。');
      drawChance(state, player, cardIndex, trace);
      break;
    }
    case 'BUY': {
      requirePhase('buy');
      const tile = BOARD[player.position];
      requireCash(tile.price);
      player.cash -= tile.price;
      state.properties[tile.id].ownerId = player.id;
      state.phase = 'end';
      log(state, `${player.name}花 ¥${tile.price.toLocaleString('en-US')}购入${tile.name}！`);
      break;
    }
    case 'SKIP_BUY':
      requirePhase('buy');
      state.phase = 'end';
      log(state, `${player.name}暂时放弃购买${BOARD[player.position].name}。`);
      break;
    case 'END_TURN':
      requirePhase('end');
      requireCash(0);
      nextTurn(state);
      break;
    case 'BUILD': {
      const tile = ownedTile();
      if (!canBuild(state, tile.id)) throw new Error('升级需要集齐同色地产、整组未抵押、现金充足，且建筑未达 3 级。');
      player.cash -= buildCost(tile);
      state.properties[tile.id].level += 1;
      log(state, `${player.name}升级${tile.name}至 ${state.properties[tile.id].level} 级，支付 ¥${buildCost(tile).toLocaleString('en-US')}。`);
      break;
    }
    case 'MORTGAGE': {
      const tile = ownedTile();
      const property = state.properties[tile.id];
      if (property.mortgaged) throw new Error('这处地产已经抵押。');
      const refund = mortgageValue(tile) + Math.floor(property.level * buildCost(tile) / 2);
      const hadBuildings = property.level > 0;
      player.cash += refund;
      property.level = 0;
      property.mortgaged = true;
      log(state, `${player.name}抵押${tile.name}${hadBuildings ? '并折价出售建筑' : ''}，获得 ¥${refund.toLocaleString('en-US')}。`);
      break;
    }
    case 'REDEEM': {
      const tile = ownedTile();
      if (!state.properties[tile.id].mortgaged) throw new Error('这处地产没有抵押。');
      requireCash(redeemCost(tile));
      player.cash -= redeemCost(tile);
      state.properties[tile.id].mortgaged = false;
      log(state, `${player.name}支付 ¥${redeemCost(tile).toLocaleString('en-US')}，赎回${tile.name}。`);
      break;
    }
    case 'PAY_BAIL':
      requirePhase('roll');
      if (!player.jailed) throw new Error('当前玩家没有入狱。');
      requireCash(500);
      player.cash -= 500;
      player.jailed = 0;
      log(state, `${player.name}支付 ¥500 保释金，现在可以掷骰。`);
      break;
    case 'BANKRUPT':
      if (player.cash >= 0) throw new Error('只有无法偿还债务时才能宣布破产。');
      player.bankrupt = true;
      player.cash = 0;
      player.jailed = 0;
      for (const property of Object.values(state.properties)) {
        if (property.ownerId === player.id) Object.assign(property, { ownerId: null, level: 0, mortgaged: false });
      }
      log(state, `${player.name}宣布破产，旗下地产全部归还银行。`);
      nextTurn(state);
      break;
    default:
      throw new Error('未知的游戏操作。');
  }
  const requestedTime = action.now === undefined ? Date.parse(previous.updatedAt) + 1 : new Date(action.now).getTime();
  state.updatedAt = timestamp(Math.max(Date.parse(previous.updatedAt) + 1, requestedTime));
  if (!validateState(state)) throw new Error('操作超出游戏允许范围。');
  return state;
}

/**
 * Replay a completed roll through the same movement helpers, without changing
 * either saved state. steps excludes the starting tile and includes redirect
 * destinations; redirects marks their zero-based indexes for jump animations.
 * Non-roll or mismatched snapshots return an empty path instead of guessing.
 */
export function getRollMovement(before, after) {
  return getMovement(before, after, 'ROLL');
}

/** The separately committed card draw can redirect a token after it stopped. */
export function getChanceMovement(before, after) {
  return getMovement(before, after, 'DRAW_CHANCE');
}

function getMovement(before, after, type) {
  const playerId = before?.players?.[before.currentPlayer]?.id ?? null;
  const empty = { playerId, steps: [] };
  const expectedPhase = type === 'ROLL' ? 'roll' : 'chance';
  const resultPhases = type === 'ROLL' ? ['buy', 'chance', 'end'] : ['end'];
  if (!validateState(before) || !validateState(after) || before.id !== after.id || before.phase !== expectedPhase ||
      before.currentPlayer !== after.currentPlayer || before.round !== after.round || !after.dice || !resultPhases.includes(after.phase)) return empty;
  const trace = { playerId, steps: [] };
  try {
    const action = { type, dice: after.dice, now: after.updatedAt };
    if (type === 'DRAW_CHANCE') action.cardIndex = (before.chanceOffer ?? defaultChanceOffer(before)).indexOf(after.chanceCard?.id);
    else if (after.phase === 'chance' && after.chanceOffer) action.chanceCards = after.chanceOffer;
    const replay = executeAction(before, action, trace);
    const expectedPlayer = getCurrentPlayer(replay);
    const actualPlayer = getCurrentPlayer(after);
    if (replay.phase !== after.phase || expectedPlayer.position !== actualPlayer.position || expectedPlayer.jailed !== actualPlayer.jailed) return empty;
    if (type === 'DRAW_CHANCE' && (replay.chanceCard.id !== after.chanceCard?.id || replay.chanceCard.playerId !== after.chanceCard?.playerId)) return empty;
    return trace;
  } catch {
    return empty;
  }
}
