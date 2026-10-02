import { BOARD, createGame, applyAction, getCurrentPlayer, getRent, getNetWorth, canBuild, validateState } from './game.js';
import { STORAGE_KEY, readStored, writeStored, parseRoom, newRoomToken, checkCloudConfig, CloudStore } from './persistence.js';

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
const cacheKey = value => STORAGE_KEY + ':game:' + (value.mode === 'cloud' ? 'cloud:' + (value.endpoint || '') + ':' + value.token : 'local:' + value.state.id);
const sameSession = (a, b) => a && b && a.mode === b.mode && (a.mode === 'cloud' ? a.token === b.token && a.endpoint === b.endpoint : a.state?.id === b.state?.id);

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 6500);
}
async function finishOperation() {
  busy = false; render();
  if (pendingHash === null) return false;
  const hash = pendingHash; pendingHash = null;
  history.replaceState(null, '', location.pathname + location.search + hash);
  await restore(); return true;
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
  label.textContent = busy ? '正在保存…' : session?.mode === 'cloud' ? (connected ? '云端已保存 · 自动同步' : '云端未连接 · 操作已暂停') : game ? '本机自动保存' : '准备开始';
}
function positions(index) {
  if (index <= 8) return [9, 9 - index];
  if (index <= 16) return [17 - index, 1];
  if (index <= 24) return [1, index - 15];
  return [index - 23, 9];
}
function renderBoard() {
  document.querySelectorAll('#board > .tile').forEach(tile => tile.remove());
  BOARD.forEach((tile, index) => {
    const node = document.createElement('button');
    const property = game?.properties[tile.id];
    const owner = game?.players.find(player => player.id === property?.ownerId);
    const [row, column] = positions(index);
    node.type = 'button';
    node.className = 'tile type-' + tile.type + (index % 8 === 0 ? ' corner' : '') + (selectedTile === tile.id ? ' tile-selected' : '');
    node.style.gridRow = row;
    node.style.gridColumn = column;
    node.setAttribute('aria-label', tile.name + (owner ? '，属于' + owner.name : '') + (property?.mortgaged ? '，已抵押' : ''));
    node.title = node.getAttribute('aria-label');
    node.innerHTML = `${tile.color ? `<span class="tile-color" style="background:${safe(tile.color)}"></span>` : ''}<span class="tile-name">${safe(tile.name)}</span><span class="tile-price">${tile.price ? money(tile.price) : ({ start: '+¥2,000', chance: '机遇', tax: '缴费', jail: '探望', goToJail: '入狱', parking: '休息' }[tile.type] || '')}</span><span class="tile-owner" ${owner ? `style="color:${safe(owner.color)}"` : ''}>${property?.mortgaged ? '已抵押' : owner ? (property.level ? '▰'.repeat(property.level) : '●') : ''}</span><span class="tile-tokens">${(game?.players || []).filter(player => player.position === index && !player.bankrupt).map(player => `<span class="token" style="background:${safe(player.color)}" title="${safe(player.name)}">${safe(player.name.slice(0, 1))}</span>`).join('')}</span>`;
    node.onclick = () => { selectedTile = tile.id; renderBoard(); renderProperty(); };
    $('board').append(node);
  });
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
  panel.innerHTML = `<div class="property-detail"><h3>${safe(tile.name)}</h3><p>${tile.price ? `地价 ${money(tile.price)} · ${owner ? safe(owner.name) + ' 持有' : '待购入'}` : '特殊地块'}</p>${property ? `<p>${property.mortgaged ? '已抵押，暂停收租' : '租金 ' + money(getRent(game, tile.id)) + ' · 建筑 ' + property.level + '/3'}</p>` : ''}</div>`;
  if (!game || game.phase === 'gameover' || owner?.id !== getCurrentPlayer(game).id) return;
  const controls = document.createElement('div'); controls.className = 'property-actions';
  if (!property.mortgaged) {
    controls.append(button('建房 ' + money(Math.floor(tile.price / 2)), { type: 'BUILD', tileId: tile.id }, 'secondary', !canBuild(game, tile.id)));
    controls.append(button('抵押地契', { type: 'MORTGAGE', tileId: tile.id }, 'secondary'));
  } else controls.append(button('赎回 ' + money(Math.ceil(Math.floor(tile.price / 2) * 11 / 10)), { type: 'REDEEM', tileId: tile.id }, 'secondary'));
  panel.append(controls);
}
function render() {
  syncLabel(); renderBoard();
  $('share-button').disabled = !game;
  $('actions').replaceChildren();
  if (!game) {
    $('turn-label').textContent = '一起，成为大富翁';
    $('round-label').textContent = '等待对局'; $('dice-display').textContent = '⚄ ⚂';
    $('event-text').textContent = session?.mode === 'cloud' ? '正在等待云端存档，请保持网络连接。' : '掷出骰子，开始你的置业之旅。';
    $('players').replaceChildren(); $('logs').replaceChildren(); renderProperty(); return;
  }
  const current = getCurrentPlayer(game);
  $('round-label').textContent = `第 ${game.round} 轮 · ${game.players.filter(player => !player.bankrupt).length} 位玩家`;
  $('turn-label').textContent = game.phase === 'gameover' ? (game.players.find(player => player.id === game.winnerId)?.name || '') + ' 获胜！' : current.name + ' 的回合';
  $('dice-display').textContent = game.dice ? game.dice.map(value => ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][value - 1]).join(' ') : '⚄ ⚂';
  $('dice-display').setAttribute('aria-label', game.dice ? '骰子：' + game.dice.join(' 和 ') : '等待掷骰子');
  $('event-text').textContent = game.lastEvent || '掷出骰子，开始你的置业之旅。';
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
    } else $('actions').append(button('结束回合', { type: 'END_TURN' }));
  }
  $('players').innerHTML = game.players.map((player, index) => `<article class="player-card${index === game.currentPlayer ? ' active' : ''}${player.bankrupt ? ' bankrupt' : ''}" style="--player-color:${safe(player.color)}"><div class="player-top"><span class="player-avatar" style="background:${safe(player.color)}">${safe(player.name.slice(0, 1))}</span><span class="player-name">${safe(player.name)}</span><strong class="player-cash">${money(player.cash)}</strong></div><div class="player-meta"><span>${player.bankrupt ? '已破产' : player.jailed ? '正在监狱' : '位于 ' + safe(BOARD[player.position].name)}</span><span>总资产 ${money(getNetWorth(game, player.id))}</span></div></article>`).join('');
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
  const currentGeneration = generation, token = session.token;
  readingGeneration = currentGeneration;
  try {
    const snapshot = await cloud.read(token);
    if (currentGeneration !== generation || busy || session?.token !== token) return;
    if (!game || snapshot.revision >= session.revision) acceptSnapshot(snapshot);
    connected = true; render();
  } catch (error) {
    if (currentGeneration !== generation) return;
    connected = false; render(); if (showError) toast(errorMessage(error));
  } finally { if (readingGeneration === currentGeneration) readingGeneration = null; }
}
function secureDie() {
  const sample = new Uint8Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= 252);
  return sample[0] % 6 + 1;
}
async function perform(action) {
  if (!game || busy || (session.mode === 'cloud' && !connected)) return;
  if (action.type === 'BANKRUPT' && !confirm('确认宣布破产并退出本局？')) return;
  if (action.type === 'ROLL') action = { ...action, dice: [secureDie(), secureDie()] };
  busy = true; render();
  try {
    const next = applyAction(game, { ...action, now: Date.now() });
    if (session.mode === 'cloud') {
      const snapshot = await cloud.save(session.token, session.revision, next);
      acceptSnapshot(snapshot);
      persist(true);
    } else { game = next; persist(true); }
  } catch (error) {
    if (session.mode === 'cloud' && (error.code === '40001' || error.message === 'revision_conflict')) {
      toast('另一台设备已更新对局，正在载入最新进度，请重新操作。');
      connected = false;
    } else { toast(errorMessage(error)); if (session.mode === 'cloud') connected = false; }
  } finally {
    if (!(await finishOperation()) && session.mode === 'cloud' && !connected) await refreshCloud();
  }
}
function fillNames() {
  const previous = [...$('player-names').querySelectorAll('input')].map(input => input.value);
  $('player-names').innerHTML = Array.from({ length: Number($('player-count').value) }, (_, index) => `<label>玩家 ${index + 1}<input name="player" maxlength="12" required autocomplete="off" value="${safe(previous[index] || ['小橘', '小蓝', '小绿', '小紫'][index])}"></label>`).join('');
}
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
    const next = createGame({ names: [...$('player-names').querySelectorAll('input')].map(input => input.value.trim()) });
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCloud(); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || busy || session?.mode === 'cloud') return;
  const other = readStored(storage, STORAGE_KEY);
  if (other?.mode === 'local' && other.state?.id === game?.id && validateState(other.state)) { game = other.state; session = other; render(); }
});
setInterval(() => refreshCloud(), 3000);
restore();
