// The complete, serializable game rules. No network or DOM dependencies.
export const PLAYER_COLORS = Object.freeze(['#fb923c', '#38bdf8', '#a78bfa', '#34d399']);

export const BOARD = Object.freeze([
  { id: 0, name: '起点', type: 'start' },
  { id: 1, name: '青岛海岸', type: 'property', color: '#22d3ee', price: 1000, baseRent: 150, group: 'coast' },
  { id: 2, name: '奇遇', type: 'chance' },
  { id: 3, name: '厦门沙坡尾', type: 'property', color: '#22d3ee', price: 1200, baseRent: 180, group: 'coast' },
  { id: 4, name: '城市税', type: 'tax' },
  { id: 5, name: '杭州西湖', type: 'property', color: '#4ade80', price: 1400, baseRent: 210, group: 'garden' },
  { id: 6, name: '苏州园林', type: 'property', color: '#4ade80', price: 1600, baseRent: 240, group: 'garden' },
  { id: 7, name: '探访 / 监狱', type: 'jail' },
  { id: 8, name: '南京秦淮', type: 'property', color: '#60a5fa', price: 1800, baseRent: 270, group: 'river' },
  { id: 9, name: '武汉江滩', type: 'property', color: '#60a5fa', price: 1800, baseRent: 270, group: 'river' },
  { id: 10, name: '奇遇', type: 'chance' },
  { id: 11, name: '成都锦里', type: 'property', color: '#fb923c', price: 2000, baseRent: 300, group: 'food' },
  { id: 12, name: '重庆洪崖洞', type: 'property', color: '#fb923c', price: 2200, baseRent: 330, group: 'food' },
  { id: 13, name: '自由公园', type: 'parking' },
  { id: 14, name: '西安城墙', type: 'property', color: '#f87171', price: 2400, baseRent: 360, group: 'history' },
  { id: 15, name: '洛阳古城', type: 'property', color: '#f87171', price: 2400, baseRent: 360, group: 'history' },
  { id: 16, name: '深圳湾', type: 'property', color: '#c084fc', price: 2600, baseRent: 390, group: 'bay' },
  { id: 17, name: '奇遇', type: 'chance' },
  { id: 18, name: '广州珠江', type: 'property', color: '#c084fc', price: 2800, baseRent: 420, group: 'bay' },
  { id: 19, name: '城市税', type: 'tax' },
  { id: 20, name: '上海外滩', type: 'property', color: '#818cf8', price: 3000, baseRent: 450, group: 'capital' },
  { id: 21, name: '北京王府井', type: 'property', color: '#818cf8', price: 3200, baseRent: 480, group: 'capital' },
  { id: 22, name: '奇遇', type: 'chance' },
  { id: 23, name: '丽江古城', type: 'property', color: '#f472b6', price: 2600, baseRent: 390, group: 'holiday' },
  { id: 24, name: '大理洱海', type: 'property', color: '#f472b6', price: 2800, baseRent: 420, group: 'holiday' },
  { id: 25, name: '前往监狱', type: 'goToJail' },
  { id: 26, name: '桂林山水', type: 'property', color: '#2dd4bf', price: 3000, baseRent: 450, group: 'nature' },
  { id: 27, name: '张家界', type: 'property', color: '#2dd4bf', price: 3200, baseRent: 480, group: 'nature' },
  { id: 28, name: '城市税', type: 'tax' },
  { id: 29, name: '香港维港', type: 'property', color: '#fbbf24', price: 3600, baseRent: 540, group: 'gold' },
  { id: 30, name: '奇遇', type: 'chance' },
  { id: 31, name: '澳门南湾', type: 'property', color: '#fbbf24', price: 4000, baseRent: 600, group: 'gold' },
].map(Object.freeze));

const ESTATES = BOARD.filter(tile => tile.type === 'property');
const MAX_MONEY = 1_000_000_000;
const PHASES = new Set(['roll', 'buy', 'end', 'gameover']);
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

export function createGame({ names = ['小橙', '小蓝'], startingCash = 15000 } = {}, { id, now = Date.now() } = {}) {
  if (!Array.isArray(names) || names.length < 2 || names.length > 4 || names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 16)) {
    throw new Error('请填写 2–4 位玩家的名字，每个名字最多 16 个字。');
  }
  if (!money(startingCash) || startingCash < 1000 || startingCash > 1000000) throw new Error('初始资金须为 1000–1000000 的整数。');
  if (id !== undefined && !shortString(id, 100)) throw new Error('对局编号不正确。');
  const createdAt = timestamp(now);
  const gameId = id ?? globalThis.crypto?.randomUUID?.() ?? `game-${Date.parse(createdAt)}-${Math.random().toString(36).slice(2, 10)}`;
  const players = names.map((name, index) => ({
    id: `p${index + 1}`, name: name.trim(), color: PLAYER_COLORS[index], position: 0,
    cash: startingCash, jailed: 0, bankrupt: false,
  }));
  const lastEvent = `欢迎来到城市大富翁！${players[0].name}先掷骰。`;
  return {
    schemaVersion: 1, id: gameId, createdAt, updatedAt: createdAt, round: 1, currentPlayer: 0, phase: 'roll', players,
    properties: Object.fromEntries(ESTATES.map(tile => [tile.id, { ownerId: null, level: 0, mortgaged: false }])),
    dice: null, lastEvent, logs: [{ id: '1', text: lastEvent }], winnerId: null,
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

function jail(state, player) {
  player.position = 7;
  player.jailed = 2;
  state.phase = 'end';
  log(state, `${player.name}进入监狱，最多停留 2 回合；掷出双数或支付 ¥500 可提前出狱。`);
}

function chance(state, player) {
  // Dice + game progress choose the card deterministically, so synchronized
  // devices replay exactly the same action without a second random draw.
  const card = (state.dice[0] * 7 + state.dice[1] * 3 + state.round + state.currentPlayer + player.position) % 8;
  if (card === 0) { player.cash += 1200; log(state, `奇遇 · 创业分红！${player.name}获得 ¥1,200。`); }
  if (card === 1) { player.cash -= 600; log(state, `奇遇 · 房屋修缮，${player.name}支付 ¥600。`); }
  if (card === 2) { player.cash += 800; log(state, `奇遇 · 幸运奖金！${player.name}获得 ¥800。`); }
  if (card === 3) { player.cash -= 1000; log(state, `奇遇 · 旅行开销，${player.name}支付 ¥1,000。`); }
  if (card === 4) { player.position = 0; player.cash += 2000; log(state, `奇遇 · 返回起点！${player.name}领取 ¥2,000。`); }
  if (card === 5) jail(state, player);
  if (card === 6) { player.cash += 1500; log(state, `奇遇 · 城市建设奖！${player.name}获得 ¥1,500。`); }
  if (card === 7) { player.cash += 500; log(state, `奇遇 · 发现城市宝藏！${player.name}获得 ¥500。`); }
}

function land(state, player) {
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
    chance(state, player);
  } else if (tile.type === 'goToJail') {
    jail(state, player);
  } else if (tile.type === 'start') {
    log(state, `${player.name}抵达起点。继续向城市梦想出发！`);
  } else if (tile.type === 'jail') {
    log(state, `${player.name}只是路过监狱，无需停留。`);
  } else {
    log(state, `${player.name}来到自由公园，休息一下。`);
  }
  if (player.cash < 0) log(state, `${player.name}资金不足，还差 ¥${(-player.cash).toLocaleString('en-US')}。请抵押地产偿还债务，或宣布破产。`);
}

/** Atomically return a new state. The caller supplies dice and optionally now. */
export function applyAction(previous, action) {
  if (!validateState(previous)) throw new Error('对局存档无效，请恢复有效存档。');
  if (!isRecord(action) || typeof action.type !== 'string') throw new Error('无效的游戏操作。');
  if (previous.phase === 'gameover') throw new Error('本局已结束，请开始新对局。');
  const state = structuredClone(previous);
  const player = getCurrentPlayer(state);
  if (action.playerId !== undefined && action.playerId !== player.id) throw new Error('还没有轮到这位玩家。');
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
    case 'ROLL': {
      requirePhase('roll');
      requireCash(0);
      if (!Array.isArray(action.dice) || action.dice.length !== 2 || !action.dice.every(die => Number.isInteger(die) && die >= 1 && die <= 6)) throw new Error('骰子必须是两个 1–6 的整数。');
      state.dice = [...action.dice];
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
      player.position = (player.position + steps) % BOARD.length;
      land(state, player);
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
