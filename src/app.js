import { BOARD, ANIMALS, CHANCE_CARDS, createGame, applyAction, getCurrentPlayer, getPlayerAnimal, getRollMovement, getChanceCard, getChanceMovement, getRent, getNetWorth, canBuild, validateState } from './game.js';
import { STORAGE_KEY, readStored, writeStored, parseRoom, newRoomToken, checkCloudConfig, CloudStore } from './persistence.js';
import { createSoundEffects, animationPause } from './effects.js';

const $ = id => document.getElementById(id);
const money = value => '¥' + Math.round(value).toLocaleString('zh-CN');
const safe = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let storage;
try { storage = window.localStorage; } catch { storage = { getItem() { return null; }, setItem() { throw new Error('storage unavailable'); } }; }
let config = readStored(storage, STORAGE_KEY + ':config', window.DAFUWENG_CONFIG || {});
let cloud = null;
try { cloud = new CloudStore(config); } catch { /* Local game works without a backend. */ }
let session = null;
let game = null;
let selectedTile = null;
let busy = false;
let connected = false;
let generation = 0;
let readingGeneration = null;
let activateOnLoad = false;
let toastTimer;
let storageWarning = false;
let pendingHash = null;
let presentation = null;
let freshHouse = null;
let selectedChanceIndex = null;
let chancePickerKey = null;
let animalTarget = null;
let setupAnimals = ANIMALS.slice(0, 4).map(animal => animal.id);
let soundEnabled = readStored(storage, STORAGE_KEY + ':sound', true) !== false;
const sound = createSoundEffects(soundEnabled);
let world = null;
function disableWorld() {
  try { world?.dispose(); } catch { /* Continue with the accessible board. */ }
  world = null; document.body.classList.remove('has-webgl');
  if ($('world-fallback')) $('world-fallback').hidden = false;
}
// Load the renderer independently: a device without WebGL can still play and save.
import('./world.js').then(({ createWorld }) => {
  world = createWorld({ canvas: $('world-canvas'), onSelect: tileId => { selectedTile = tileId; renderBoard(); renderProperty(); }, onChance: openChancePicker, onUnavailable: disableWorld });
  if (!world) disableWorld();
  else { $('world-fallback').hidden = true; $('reset-camera').onclick = () => world?.resetCamera(); renderBoard(); }
}).catch(disableWorld);
const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const visualPosition = player => presentation?.playerId === player.id ? presentation.position : player.position;
const cacheKey = value => STORAGE_KEY + ':game:' + (value.mode === 'cloud' ? 'cloud:' + (value.endpoint || '') + ':' + value.token : 'local:' + value.state.id);
const sameSession = (a, b) => a && b && a.mode === b.mode && (a.mode === 'cloud' ? a.token === b.token && a.endpoint === b.endpoint : a.state?.id === b.state?.id);

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 6500);
}
async function finishOperation() {
  presentation = null; freshHouse = null; selectedChanceIndex = null;
  restoreNewerLocalState();
  busy = false; render();
  if (pendingHash === null) return false;
  const hash = pendingHash; pendingHash = null;
  history.replaceState(null, '', location.pathname + location.search + hash);
  await restore(); return true;
}
function showChanceCard() {
  const card = getChanceCard(game);
  if (!card || pendingHash !== null) return;
  $('chance-title').textContent = card.title;
  $('chance-description').textContent = card.description;
  const slot = game.chanceOffer?.indexOf(card.id) ?? -1;
  $('chance-card').querySelector('.chance-card-label').textContent = slot < 0 ? '环球机遇卡' : `第 ${slot + 1} 张 · 环球机遇卡`;
  $('chance-card').dataset.kind = card.kind;
  $('chance-card').classList.remove('is-revealed');
  $('chance-pick-dialog').close(); $('chance-dialog').showModal();
  requestAnimationFrame(() => $('chance-card').classList.add('is-revealed'));
}
function randomChanceCards() {
  const cards = CHANCE_CARDS.map(card => card.id);
  const sample = new Uint32Array(1);
  for (let index = cards.length - 1; index > 0; index--) {
    const range = index + 1, limit = Math.floor(0x100000000 / range) * range;
    do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
    const swap = sample[0] % range;
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }
  return cards.slice(0, 6);
}
async function openChancePicker() {
  if (!game || busy || game.phase !== 'chance' || (session?.mode === 'cloud' && !connected)) return;
  const openingGeneration = generation, gameId = game.id;
  if (!game.chanceOffer) await perform({ type: 'PREPARE_CHANCE', chanceCards: randomChanceCards() });
  if (generation !== openingGeneration || game?.id !== gameId || game.phase !== 'chance' || !game.chanceOffer || busy) return;
  selectedChanceIndex = null;
  renderChancePicker(); $('chance-pick-dialog').showModal();
}
function renderChancePicker() {
  const dialog = $('chance-pick-dialog');
  if (!game || game.phase !== 'chance') { if (!busy) dialog.close(); return; }
  if (!game.chanceOffer) return;
  const key = `${game.id}:${game.round}:${game.currentPlayer}:${game.chanceOffer.join(',')}`;
  if (chancePickerKey !== key) {
    chancePickerKey = key;
    $('chance-options').innerHTML = game.chanceOffer.map((_, index) => `<button type="button" class="chance-option" data-card-index="${index}" aria-label="抽取第 ${index + 1} 张机遇卡"><span class="chance-option-mark" aria-hidden="true">✦</span><span class="chance-option-label">机遇卡</span></button>`).join('');
    $('chance-options').querySelectorAll('button').forEach(node => {
      node.onclick = async () => {
        if (busy || game.phase !== 'chance') return;
        selectedChanceIndex = Number(node.dataset.cardIndex);
        await perform({ type: 'DRAW_CHANCE', cardIndex: selectedChanceIndex });
      };
    });
  }
  const unavailable = busy || (session?.mode === 'cloud' && !connected);
  $('chance-options').setAttribute('aria-busy', String(busy));
  $('chance-options').querySelectorAll('button').forEach((node, index) => { node.disabled = unavailable; node.classList.toggle('is-picked', index === selectedChanceIndex); });
  $('chance-pick-close').disabled = busy;
  $('chance-pick-hint').textContent = busy ? '正在揭晓你选中的机遇…' : unavailable ? '连接恢复后，即可继续选牌。' : '六张牌，六种可能。点击一张，揭晓你的机遇。';
}
function restoreNewerLocalState() {
  if (session?.mode !== 'local' || !game) return false;
  const cached = readStored(storage, cacheKey(session));
  if (!sameSession(cached, session) || !validateState(cached.state) || Date.parse(cached.state.updatedAt) <= Date.parse(game.updatedAt)) return false;
  session = cached; game = cached.state; return true;
}
function persist(activate = false) {
  if (!session || !game) return;
  session.state = game;
  const cached = writeStored(storage, cacheKey(session), session);
  const recent = readStored(storage, STORAGE_KEY);
  const saved = (activate || !recent || sameSession(recent, session)) ? writeStored(storage, STORAGE_KEY, session) : true;
  if ((!cached || !saved) && !storageWarning) {
    storageWarning = true;
    toast('浏览器不允许保存本地数据。请保留对局链接；本机对局关闭后可能丢失。');
  }
}
function syncLabel() {
  const label = $('sync-status');
  label.className = 'sync-status ' + (session?.mode === 'cloud' ? (connected ? 'online' : 'offline') : 'local');
  label.textContent = busy ? (presentation?.stage === 'walking' ? '棋子移动中 · 已保存' : presentation?.stage === 'rolling' ? '掷骰中 · 正在保存…' : '正在保存…') : session?.mode === 'cloud' ? (connected ? '云端已保存 · 自动同步' : '云端未连接 · 操作已暂停') : game ? '本机自动保存' : '准备开始';
}
function positions(index) {
  if (index <= 8) return [9, 9 - index];
  if (index <= 16) return [17 - index, 1];
  if (index <= 24) return [1, index - 15];
  return [index - 23, 9];
}
function renderDice(values, rolling = false) {
  const dice = $('dice-display');
  dice.classList.toggle('is-rolling', rolling);
  dice.setAttribute('aria-live', rolling ? 'off' : 'polite');
  dice.setAttribute('aria-label', rolling ? '正在摇骰子' : '骰子：' + values.join(' 和 '));
  if (dice.querySelectorAll('.die-face').length !== 2) dice.innerHTML = '<span class="die-face" aria-hidden="true"></span><span class="die-face" aria-hidden="true"></span>';
  dice.querySelectorAll('.die-face').forEach((face, index) => {
    face.dataset.value = values[index];
    face.textContent = diceFaces[values[index] - 1];
  });
}
function startRollVisual(before, audioReady, follow = false) {
  const actor = getCurrentPlayer(before);
  world?.resetCamera();
  if (world && follow && innerWidth < 880 && !document.hidden) $('world-canvas').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const visual = { playerId: actor.id, position: actor.position, stage: 'rolling', dice: [5, 3], message: `${getPlayerAnimal(actor, before.currentPlayer).emoji} ${actor.name}正在摇骰子…` };
  presentation = visual; render();
  Promise.resolve(audioReady).then(() => { if (presentation === visual) sound.roll(); });
  return (async () => {
    for (let frame = 0; frame < 10; frame++) {
      if (presentation !== visual || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || pendingHash !== null) break;
      visual.dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      renderDice(visual.dice, true);
      await animationPause(75);
    }
  })();
}
async function animateCommitted(before, after, type, rollLead = Promise.resolve()) {
  // This presentation reads a committed snapshot; no visual frame is a save.
  // An unavailable animation/audio device must not be treated as a failed save.
  try {
    if (type === 'ROLL') {
      await rollLead;
      const movement = getRollMovement(before, after);
      if (!presentation || document.hidden || pendingHash !== null) return;
      presentation.stage = 'walking'; presentation.dice = after.dice;
      presentation.message = `掷出 ${after.dice.join(' + ')} 点，出发！`;
      render();
      await animationPause(180);
      for (let step = 0; step < movement.steps.length; step++) {
        if (document.hidden || pendingHash !== null || matchMedia('(prefers-reduced-motion: reduce)').matches) break;
        presentation.position = movement.steps[step];
        const redirect = movement.redirects?.find(item => item.index === step);
        const actor = before.players.find(player => player.id === movement.playerId);
        presentation.message = redirect ? `${actor.name}${redirect.reason === 'jail' ? '前往监狱' : '乘坐奇遇快车返回起点'}。` : `${actor.name}前进 ${step + 1} / ${after.dice[0] + after.dice[1]} 步 · ${BOARD[presentation.position].name}`;
        renderBoard(); $('event-text').textContent = presentation.message;
        sound.step(); await animationPause(160);
      }
      sound.arrive();
    } else if (type === 'DRAW_CHANCE') {
      if ($('chance-pick-dialog').open) {
        selectedChanceIndex = after.chanceOffer?.indexOf(after.chanceCard?.id) ?? null;
        $('chance-options').setAttribute('aria-busy', 'true'); $('chance-pick-close').disabled = true;
        $('chance-pick-hint').textContent = '这张牌的机遇正在揭晓…';
        $('chance-options').querySelectorAll('button').forEach((node, index) => { node.disabled = true; node.classList.toggle('is-picked', index === selectedChanceIndex); });
        await animationPause(320); $('chance-pick-dialog').close();
      }
      const movement = getChanceMovement(before, after);
      if (movement.steps.length && !document.hidden && pendingHash === null) {
        const actor = getCurrentPlayer(before);
        presentation = { playerId: actor.id, position: actor.position, stage: 'walking', dice: after.dice, message: after.lastEvent };
        render(); await animationPause(220);
        presentation.position = movement.steps.at(-1); renderBoard();
        await animationPause(200);
      }
      sound.arrive();
      if (getChanceCard(after)?.kind === 'income') world?.celebrate();
      if (!document.hidden) showChanceCard();
    } else if (type === 'BUY' || type === 'BUILD') {
      const changed = BOARD.find(tile => after.properties[tile.id]?.ownerId && (before.properties[tile.id]?.ownerId !== after.properties[tile.id].ownerId || before.properties[tile.id]?.level !== after.properties[tile.id].level));
      if (changed) { freshHouse = changed.id; render(); sound.purchase(); world?.celebrate(); await animationPause(450); }
    }
  } catch { /* The confirmed state is displayed by finishOperation. */ }
}
function renderBoard() {
  try { world?.update(game, { presentation, selectedTile, freshHouse }); } catch { disableWorld(); }
  const scroll = $('board').scrollLeft;
  document.querySelectorAll('#board > .tile').forEach(tile => tile.remove());
  BOARD.forEach((tile, index) => {
    const node = document.createElement('button');
    const property = game?.properties[tile.id];
    const owner = game?.players.find(player => player.id === property?.ownerId);
    const [row, column] = positions(index);
    node.type = 'button';
    node.dataset.tileId = tile.id;
    node.className = 'tile type-' + tile.type + (index % 8 === 0 ? ' corner' : '') + (selectedTile === tile.id ? ' tile-selected' : '') + (presentation?.stage === 'walking' && presentation.position === index ? ' is-step' : '');
    node.style.gridRow = row;
    node.style.gridColumn = column;
    node.setAttribute('aria-label', tile.name + (owner ? '，属于' + owner.name : '') + (property?.mortgaged ? '，已抵押' : ''));
    node.title = node.getAttribute('aria-label');
    const house = owner ? `<span class="tile-house${property.mortgaged ? ' mortgaged' : ''}${freshHouse === tile.id ? ' is-new' : ''}" style="--owner-color:${safe(owner.color)}" title="${safe(owner.name)}的房产${property.level ? ' · ' + property.level + '级' : ''}${property.mortgaged ? ' · 已抵押' : ''}" aria-label="${safe(owner.name)}的房产${property.mortgaged ? '，已抵押' : ''}"><span class="house-icon" aria-hidden="true">🏠</span>${property.level ? `<span class="house-level">${property.level}</span>` : ''}</span>` : '';
    node.innerHTML = `${tile.color ? `<span class="tile-color" style="background:${safe(tile.color)}"></span>` : ''}<span class="tile-name">${safe(tile.name)}</span><span class="tile-price">${tile.price ? money(tile.price) : ({ start: '+¥2,000', chance: '机遇', tax: '缴费', jail: '探望', goToJail: '入狱', parking: '休息' }[tile.type] || '')}</span>${house}<span class="tile-tokens">${(game?.players || []).filter(player => visualPosition(player) === index && !player.bankrupt).map(player => { const animal = getPlayerAnimal(player, game.players.indexOf(player)); return `<span class="token${presentation?.stage === 'walking' && player.id === presentation.playerId ? ' is-moving' : ''}" data-player-id="${safe(player.id)}" data-position="${index}" style="--player-color:${safe(player.color)};background:${safe(player.color)}" title="${safe(player.name)} · ${animal.name}" aria-label="${safe(player.name)}的${animal.name}棋子">${animal.emoji}</span>`; }).join('')}</span>`;
    node.onclick = () => { selectedTile = tile.id; renderBoard(); renderProperty(); };
    $('board').append(node);
  });
  $('board').scrollLeft = scroll;
}
function button(text, action, style = 'primary', disabled = false) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = style; node.textContent = text;
  node.disabled = disabled || busy || (session?.mode === 'cloud' && !connected);
  node.onclick = () => perform(action);
  return node;
}
function renderProperty() {
  const panel = $('property-panel');
  const tile = BOARD.find(item => item.id === selectedTile);
  if (!tile) { panel.innerHTML = '<p class="empty-hint">点击棋盘地块，查看地契与管理资产。</p>'; return; }
  const property = game?.properties[tile.id];
  const owner = game?.players.find(player => player.id === property?.ownerId);
  panel.innerHTML = `<div class="property-detail"><h3>${safe(tile.name)}</h3>${world?.landmarks[tile.id] ? `<p class="landmark-name">${safe(world.landmarks[tile.id])}</p>` : ''}<p>${tile.price ? `地价 ${money(tile.price)} · ${owner ? safe(owner.name) + ' 持有' : '待购入'}` : '特殊地块'}</p>${property ? `<p>${property.mortgaged ? '已抵押，暂停收租' : '租金 ' + money(getRent(game, tile.id)) + ' · 建筑 ' + property.level + '/3'}</p>` : ''}</div>`;
  if (world?.landmarks[tile.id]) {
    const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'secondary'; inspect.textContent = '近看地标';
    inspect.onclick = () => { world.focus(tile.id); $('world-canvas').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
    panel.append(inspect);
  }
  if (!game || game.phase === 'gameover' || owner?.id !== getCurrentPlayer(game).id) return;
  const controls = document.createElement('div'); controls.className = 'property-actions';
  if (!property.mortgaged) {
    controls.append(button('建房 ' + money(Math.floor(tile.price / 2)), { type: 'BUILD', tileId: tile.id }, 'secondary', !canBuild(game, tile.id)));
    controls.append(button('抵押地契', { type: 'MORTGAGE', tileId: tile.id }, 'secondary'));
  } else controls.append(button('赎回 ' + money(Math.ceil(Math.floor(tile.price / 2) * 11 / 10)), { type: 'REDEEM', tileId: tile.id }, 'secondary'));
  panel.append(controls);
}
function render() {
  syncLabel(); renderBoard(); renderChancePicker();
  $('share-button').disabled = !game || busy;
  $('new-game-button').disabled = busy;
  $('settings-button').disabled = busy;
  $('actions').replaceChildren();
  if (!game) {
    $('turn-label').textContent = '一起，成为大富翁';
    $('round-label').textContent = '等待对局'; renderDice([5, 3]);
    $('event-text').textContent = session?.mode === 'cloud' ? '正在等待云端存档，请保持网络连接。' : '掷出骰子，开始你的置业之旅。';
    $('players').replaceChildren(); $('logs').replaceChildren(); renderProperty(); return;
  }
  const current = getCurrentPlayer(game);
  $('round-label').textContent = `第 ${game.round} 轮 · ${game.players.filter(player => !player.bankrupt).length} 位玩家`;
  $('turn-label').textContent = game.phase === 'gameover' ? (game.players.find(player => player.id === game.winnerId)?.name || '') + ' 获胜！' : current.name + ' 的回合';
  renderDice(presentation?.dice || game.dice || [5, 3], presentation?.stage === 'rolling');
  $('event-text').textContent = presentation?.message || game.lastEvent || '掷出骰子，开始你的置业之旅。';
  if (game.phase !== 'gameover') {
    if (current.cash < 0) {
      const hint = document.createElement('p'); hint.textContent = '资金不足：点击自己的地块抵押，或宣布破产。'; $('actions').append(hint);
      $('actions').append(button('宣布破产', { type: 'BANKRUPT' }, 'danger'));
    } else if (game.phase === 'roll') {
      $('actions').append(button('掷骰子', { type: 'ROLL' }));
      if (current.jailed) $('actions').append(button('支付 ¥500 出狱', { type: 'PAY_BAIL' }, 'secondary', current.cash < 500));
    } else if (game.phase === 'buy') {
      const tile = BOARD[current.position];
      $('actions').append(button('购买 ' + money(tile.price), { type: 'BUY' }, 'primary', current.cash < tile.price));
      $('actions').append(button('暂不购买', { type: 'SKIP_BUY' }, 'secondary'));
    } else if (game.phase === 'chance') {
      $('actions').append(button('抽取机遇卡', { type: 'OPEN_CHANCE' }, 'primary chance-draw'));
    } else $('actions').append(button('结束回合', { type: 'END_TURN' }));
  }
  if (getChanceCard(game)) {
    const historyButton = document.createElement('button'); historyButton.type = 'button'; historyButton.className = 'secondary chance-history';
    historyButton.textContent = '查看上一张机遇卡'; historyButton.disabled = busy; historyButton.onclick = showChanceCard; $('actions').append(historyButton);
  }
  $('players').innerHTML = game.players.map((player, index) => { const animal = getPlayerAnimal(player, index); return `<article class="player-card${index === game.currentPlayer ? ' active' : ''}${player.bankrupt ? ' bankrupt' : ''}" style="--player-color:${safe(player.color)}"><div class="player-top"><button type="button" class="player-avatar avatar-button" data-player-id="${safe(player.id)}" style="background:${safe(player.color)}" aria-label="为${safe(player.name)}更换动物，当前${animal.name}" title="点击更换动物" ${busy || (session?.mode === 'cloud' && !connected) ? 'disabled' : ''}>${animal.emoji}</button><span class="player-name">${safe(player.name)}</span><strong class="player-cash">${money(player.cash)}</strong></div><div class="player-meta"><span>${player.bankrupt ? '已破产' : player.jailed ? '正在监狱' : '位于 ' + safe(BOARD[visualPosition(player)].name)}</span><span>总资产 ${money(getNetWorth(game, player.id))}</span></div></article>`; }).join('');
  $('players').querySelectorAll('.avatar-button').forEach(node => { node.onclick = () => openAnimals({ playerId: node.dataset.playerId }); });
  $('logs').innerHTML = game.logs.slice(-12).reverse().map(log => `<li>${safe(log.text)}</li>`).join('');
  renderProperty();
}
function acceptSnapshot(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision < 0 || !validateState(snapshot.state)) throw new Error('云端存档格式不正确，请检查数据库配置。');
  if (game && snapshot.state.id !== game.id) throw new Error('对局标识不一致，已阻止覆盖。');
  game = snapshot.state; session.revision = snapshot.revision; session.endpoint = cloud.config.supabaseUrl; connected = true;
  persist(activateOnLoad); activateOnLoad = false;
}
function errorMessage(error) {
  if (error?.message === 'game_not_found') return '找不到这个云端对局，请检查对局链接。';
  if (error?.code === 'PGRST202') return '数据库还没有初始化，请先运行 supabase/schema.sql。';
  if (error?.name === 'TimeoutError' || error?.name === 'TypeError') return '连接云端失败，请检查网络和云端配置。';
  return error?.message || '操作失败，请重试。';
}
async function refreshCloud(showError = false) {
  if (!cloud || session?.mode !== 'cloud' || busy || readingGeneration === generation || document.hidden) return;
  if (session.endpoint && session.endpoint !== cloud.config.supabaseUrl) return;
  const currentGeneration = generation, token = session.token, requestedRevision = session.revision;
  let animated = false;
  readingGeneration = currentGeneration;
  try {
    const snapshot = await cloud.read(token);
    if (currentGeneration !== generation || busy || session?.token !== token) return;
    const before = game;
    const isNext = !activateOnLoad && before && snapshot.revision === session.revision + 1 && validateState(snapshot.state);
    const remoteRoll = isNext && before.phase === 'roll' && snapshot.state.phase !== 'roll' && snapshot.state.dice && before.currentPlayer === snapshot.state.currentPlayer;
    if (!game || snapshot.revision >= session.revision) {
      acceptSnapshot(snapshot);
      if (remoteRoll) {
        busy = true; animated = true;
        const lead = startRollVisual(before);
        await animateCommitted(before, game, 'ROLL', lead);
      } else if (isNext && before.phase === 'chance' && getChanceCard(game)) {
        busy = true; animated = true; await animateCommitted(before, game, 'DRAW_CHANCE');
      } else if (isNext) {
        const purchased = BOARD.some(tile => snapshot.state.properties[tile.id]?.ownerId && (before.properties[tile.id]?.ownerId !== snapshot.state.properties[tile.id].ownerId || before.properties[tile.id]?.level !== snapshot.state.properties[tile.id].level));
        if (purchased) { busy = true; animated = true; await animateCommitted(before, game, 'BUY'); }
      }
    }
    connected = true; render();
  } catch (error) {
    if (currentGeneration !== generation || session?.token !== token || busy || session.revision > requestedRevision) return;
    connected = false; render(); if (showError) toast(errorMessage(error));
  } finally {
    if (readingGeneration === currentGeneration) readingGeneration = null;
    if (animated && !(await finishOperation()) && session?.mode === 'cloud') queueMicrotask(() => refreshCloud());
  }
}
function secureDie() {
  const sample = new Uint8Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= 252);
  return sample[0] % 6 + 1;
}
async function perform(action) {
  if (action.type === 'OPEN_CHANCE') return openChancePicker();
  if (!game || busy || (session.mode === 'cloud' && !connected)) return;
  if (restoreNewerLocalState()) { selectedChanceIndex = null; render(); toast('另一个窗口更新了对局，已载入最新进度，请重新操作。'); return; }
  if (action.type === 'BANKRUPT' && !confirm('确认宣布破产并退出本局？')) return;
  const audioReady = sound.unlock();
  if (action.type === 'ROLL') action = { ...action, dice: [secureDie(), secureDie()], chanceCards: randomChanceCards() };
  busy = true; render();
  try {
    const before = game;
    const next = applyAction(game, { ...action, now: Date.now() });
    const lead = action.type === 'ROLL' ? startRollVisual(before, audioReady, true) : Promise.resolve();
    if (session.mode === 'cloud') {
      const snapshot = await cloud.save(session.token, session.revision, next);
      acceptSnapshot(snapshot);
      persist(true);
    } else { game = next; persist(true); }
    await animateCommitted(before, game, action.type, lead);
  } catch (error) {
    if (session.mode === 'cloud' && (error.code === '40001' || error.message === 'revision_conflict')) {
      toast('另一台设备已更新对局，正在载入最新进度，请重新操作。');
      connected = false;
    } else { toast(errorMessage(error)); if (session.mode === 'cloud') connected = false; }
  } finally {
    if (!(await finishOperation()) && session.mode === 'cloud') await refreshCloud();
  }
}
function fillNames() {
  const previous = [...$('player-names').querySelectorAll('input')].map(input => input.value);
  $('player-names').innerHTML = Array.from({ length: Number($('player-count').value) }, (_, index) => { const animal = ANIMALS.find(item => item.id === setupAnimals[index]) || ANIMALS[index]; return `<div class="player-setup-row"><label class="player-name-field">玩家 ${index + 1}<input name="player" maxlength="12" required autocomplete="off" value="${safe(previous[index] || ['小橘', '小蓝', '小绿', '小紫'][index])}"></label><button type="button" class="animal-select" data-index="${index}" aria-label="为玩家${index + 1}选择动物，当前${animal.name}"><span class="animal-emoji">${animal.emoji}</span><span class="animal-name">${animal.name} ▾</span></button></div>`; }).join('');
  $('player-names').querySelectorAll('.animal-select').forEach(node => { node.onclick = () => openAnimals({ index: Number(node.dataset.index) }); });
}
function openAnimals(target) {
  if (busy) return;
  animalTarget = target;
  const playerIndex = target.playerId ? game.players.findIndex(player => player.id === target.playerId) : target.index;
  const selected = target.playerId ? getPlayerAnimal(game.players[playerIndex], playerIndex).id : setupAnimals[playerIndex];
  $('animal-options').innerHTML = ANIMALS.map(animal => `<button type="button" class="animal-option" data-animal-id="${animal.id}" aria-label="${animal.name}" aria-pressed="${animal.id === selected}"><span class="animal-emoji" aria-hidden="true">${animal.emoji}</span><span class="animal-name">${animal.name}</span></button>`).join('');
  $('animal-options').querySelectorAll('button').forEach(node => { node.onclick = async () => {
    const target = animalTarget; $('animal-dialog').close();
    if (target.playerId) await perform({ type: 'SET_ANIMAL', playerId: target.playerId, animalId: node.dataset.animalId });
    else { setupAnimals[target.index] = node.dataset.animalId; fillNames(); }
  }; });
  $('animal-dialog').showModal();
}
function renderSoundButton() {
  $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-button').setAttribute('aria-label', soundEnabled ? '关闭游戏声音' : '开启游戏声音');
  $('sound-button').innerHTML = `<span aria-hidden="true">${soundEnabled ? '🔊' : '🔇'}</span><span>声音${soundEnabled ? '开' : '关'}</span>`;
}
$('sound-button').onclick = () => {
  soundEnabled = !soundEnabled; sound.setEnabled(soundEnabled);
  writeStored(storage, STORAGE_KEY + ':sound', soundEnabled); renderSoundButton();
  if (soundEnabled) Promise.resolve(sound.unlock()).then(() => sound.arrive());
};
$('animal-close').onclick = () => $('animal-dialog').close();
$('chance-close').onclick = () => $('chance-dialog').close();
$('chance-pick-close').onclick = () => { if (!busy) $('chance-pick-dialog').close(); };
$('chance-pick-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
renderSoundButton();
function openSetup() {
  if (busy) return;
  $('mode-cloud').disabled = !cloud;
  if (!cloud) $('mode-local').checked = true;
  else if (!game) $('mode-cloud').checked = true;
  $('setup-cancel').hidden = !game;
  $('setup-error').textContent = '';
  fillNames(); $('setup-dialog').showModal();
}
$('player-count').onchange = fillNames;
$('new-game-button').onclick = () => {
  if (!game || confirm(session?.mode === 'cloud' ? '创建新对局？当前云端对局仍可通过原链接进入，请先保存原链接。' : '开始新对局会替换这台设备上的旧存档，是否继续？')) openSetup();
};
$('setup-cancel').onclick = () => $('setup-dialog').close();
$('setup-dialog').addEventListener('cancel', event => { if (!game || busy) event.preventDefault(); });
$('setup-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const submit = $('setup-form').querySelector('[type=submit]'); submit.disabled = true;
  busy = true;
  try {
    const names = [...$('player-names').querySelectorAll('input')].map(input => input.value.trim());
    const next = createGame({ names, animals: setupAnimals.slice(0, names.length) });
    const mode = $('mode-cloud').checked ? 'cloud' : 'local';
    let nextSession;
    if (mode === 'cloud') {
      if (!cloud) throw new Error('请先设置云端存档。');
      const token = newRoomToken();
      const snapshot = await cloud.create(token, next);
      if (!validateState(snapshot.state)) throw new Error('云端返回的存档无效。');
      nextSession = { mode, token, revision: snapshot.revision, endpoint: cloud.config.supabaseUrl, state: snapshot.state };
      connected = true;
    } else nextSession = { mode, state: next };
    generation++; session = nextSession; game = nextSession.state; selectedTile = null;
    history.replaceState(null, '', location.pathname + location.search + (mode === 'cloud' ? '#room=' + session.token : ''));
    persist(true); $('setup-dialog').close(); toast(mode === 'cloud' ? '云端对局已创建。分享链接即可在其他设备继续。' : '本机对局已开始，进度会自动保存。');
  } catch (error) { $('setup-error').textContent = errorMessage(error); }
  finally { submit.disabled = false; await finishOperation(); }
};
$('settings-button').onclick = () => {
  if (busy) return;
  $('cloud-url').value = config.supabaseUrl || '';
  $('cloud-key').value = config.supabaseKey || '';
  $('settings-dialog').showModal();
};
$('settings-close').onclick = () => $('settings-dialog').close();
$('settings-save').onclick = async event => {
  event.preventDefault();
  try {
    const next = checkCloudConfig({ supabaseUrl: $('cloud-url').value.trim(), supabaseKey: $('cloud-key').value.trim() });
    if (session?.mode === 'cloud' && session.endpoint && session.endpoint !== next.supabaseUrl) throw new Error('当前对局属于另一个云端项目，请先保存分享链接并切换到本机新对局，再更换项目。');
    config = next; cloud = new CloudStore(next); generation++;
    if (!writeStored(storage, STORAGE_KEY + ':config', config)) toast('此浏览器无法记住配置，请在 GitHub 仓库配置云端参数。');
    else toast('云端配置已保存。');
    $('settings-dialog').close();
    $('mode-cloud').disabled = false;
    await refreshCloud(true);
  } catch (error) { toast(errorMessage(error)); }
};
$('share-button').onclick = async () => {
  if (!game || busy) return;
  if (session?.mode !== 'cloud') {
    if (!cloud) { toast('先配置云端项目，即可把当前进度同步到云端并分享。'); $('settings-button').click(); return; }
    busy = true; render();
    try {
      const token = newRoomToken();
      const snapshot = await cloud.create(token, game);
      if (!validateState(snapshot.state) || snapshot.state.id !== game.id) throw new Error('云端返回的存档无效。');
      generation++;
      session = { mode: 'cloud', token, revision: snapshot.revision, endpoint: cloud.config.supabaseUrl, state: snapshot.state };
      game = snapshot.state; connected = true; persist(true);
      history.replaceState(null, '', location.pathname + location.search + '#room=' + token);
    } catch (error) { toast(errorMessage(error)); return; }
    finally { await finishOperation(); }
  }
  if (session?.mode !== 'cloud') return;
  $('share-link').value = location.origin + location.pathname + '#room=' + session.token;
  $('share-dialog').showModal();
};
$('share-close').onclick = () => $('share-dialog').close();
$('share-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('share-link').value); toast('对局链接已复制。'); }
  catch { $('share-link').select(); toast('请长按或按 Ctrl+C 复制链接。'); }
};
async function restore() {
  $('chance-dialog').close();
  $('chance-pick-dialog').close(); selectedChanceIndex = null; chancePickerKey = null;
  generation++; connected = false; activateOnLoad = false;
  let stored = readStored(storage, STORAGE_KEY);
  if (stored?.state) stored = readStored(storage, cacheKey(stored), stored);
  const hasRoom = new URLSearchParams(location.hash.slice(1)).has('room');
  const token = parseRoom(location.hash);
  if (hasRoom && !token) { session = null; game = null; toast('对局链接不完整，请重新复制完整分享链接。'); render(); return; }
  if (token) {
    session = { mode: 'cloud', token, revision: -1, endpoint: cloud?.config.supabaseUrl };
    game = null;
    const cached = readStored(storage, cacheKey(session));
    if (cached && sameSession(cached, session) && validateState(cached.state)) stored = cached;
    if (stored?.mode === 'cloud' && stored.token === token && validateState(stored.state) && (!cloud || stored.endpoint === cloud.config.supabaseUrl)) { session = stored; game = stored.state; }
  } else if (stored && validateState(stored.state) && ['local', 'cloud'].includes(stored.mode)) {
    session = stored; game = stored.state;
    if (session.mode === 'cloud') history.replaceState(null, '', location.pathname + location.search + '#room=' + session.token);
  } else { session = null; game = null; }
  render();
  if (session?.mode === 'cloud') {
    activateOnLoad = true;
    if (!cloud) { toast('这是云端对局，请先配置相同的云端项目后恢复。'); return; }
    if (session.endpoint && session.endpoint !== cloud.config.supabaseUrl) { toast('当前云端配置与存档不一致，请在设置中使用原项目。'); return; }
    await refreshCloud(true);
  } else if (!game) openSetup();
}
window.addEventListener('hashchange', () => { if (!busy) restore(); else pendingHash = location.hash; });
window.addEventListener('online', () => refreshCloud(true));
window.addEventListener('offline', () => { connected = false; render(); });
document.addEventListener('visibilitychange', () => {
  sound.setEnabled(soundEnabled && !document.hidden);
  if (!document.hidden) { refreshCloud(); if (!busy && restoreNewerLocalState()) render(); }
});
window.addEventListener('storage', event => {
  if (session?.mode !== 'local' || busy || ![STORAGE_KEY, cacheKey(session)].includes(event.key)) return;
  if (restoreNewerLocalState()) render();
});
setInterval(() => refreshCloud(), 3000);
restore();
