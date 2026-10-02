import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { CHANCE_CARDS, createGame, applyAction, getChanceCard } from '../src/game.js';

const storageKey = 'dafuweng:v1';
const readSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const drawButton = page => page.getByRole('button', { name: '抽取机遇卡', exact: true });
const picker = page => page.locator('#chance-pick-dialog');
const options = page => picker(page).locator('.chance-option');
const knownOffer = ['repairs', 'lottery', 'travel', 'dividend', 'return-start', 'go-to-jail'];

test.beforeAll(async () => { await mkdir('.local', { recursive: true }); });

function initialForCard(round, id) {
  const state = createGame({ names: ['抽卡玩家', '同行伙伴'], animals: ['panda', 'fox'] }, { id });
  state.round = round;
  return state;
}

function pendingWithOffer(id, offer = knownOffer) {
  return applyAction(initialForCard(4, id), { type: 'ROLL', dice: [1, 1], chanceCards: [...offer] });
}

function expectValidOffer(offer) {
  expect(offer).toHaveLength(6);
  expect(new Set(offer).size).toBe(6);
  for (const id of offer) expect(CHANCE_CARDS.some(card => card.id === id)).toBe(true);
}

async function openPicker(page) {
  await expect(drawButton(page)).toBeEnabled();
  await drawButton(page).click();
  await expect(picker(page)).toBeVisible();
  await expect(options(page)).toHaveCount(6);
  for (let index = 0; index < 6; index++) {
    await expect(picker(page).locator(`.chance-option[data-card-index="${index}"]`)).toBeEnabled();
  }
  await expect(page.locator('#chance-dialog')).not.toBeVisible();
}

async function chooseCard(page, id) {
  const { state } = await readSession(page);
  const index = state.chanceOffer.indexOf(id);
  expect(index).toBeGreaterThanOrEqual(0);
  await picker(page).locator(`.chance-option[data-card-index="${index}"]`).click();
  await expect(picker(page)).not.toBeVisible();
  await expect(page.locator('#chance-dialog')).toBeVisible();
}

async function prepareLocal(page, state) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/config.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'window.DAFUWENG_CONFIG={};',
  }));
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) {
      const saved = JSON.stringify({ mode: 'local', state });
      localStorage.setItem(key, saved);
      localStorage.setItem(key + ':game:local:' + state.id, saved);
    }
    // Control only dice. The card shuffle keeps real browser Uint32 randomness.
    window.__chanceShuffleRequests = 0;
    const nativeRandomValues = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = values => {
      if (values instanceof Uint8Array && values.length === 1) { values[0] = 0; return values; }
      if (values instanceof Uint32Array) window.__chanceShuffleRequests++;
      return nativeRandomValues(values);
    };
  }, { key: storageKey, state });
  await page.goto('/');
  await expect(page.locator('#setup-dialog')).not.toBeVisible();
}

function cloudRoom(state, { token = 'e'.repeat(64), holdConcurrentSaves = false } = {}) {
  const rooms = new Map([[token, { state, revision: 0 }]]);
  const requests = [];
  const stats = { commits: 0, conflicts: 0 };
  let release;
  const bothSavesArrived = new Promise(resolve => { release = resolve; });
  async function connect(context) {
    await context.route('**/config.js', route => route.fulfill({
      contentType: 'text/javascript', body: 'window.DAFUWENG_CONFIG={supabaseUrl:"https://chance.supabase.co",supabaseKey:"sb_publishable_test"};',
    }));
    await context.route('https://chance.supabase.co/rest/v1/rpc/**', async route => {
      const name = route.request().url().split('/').at(-1);
      const body = route.request().postDataJSON();
      if (name === 'save_game') {
        requests.push(body);
        if (requests.length === 2) release();
        // Both UIs choose while revision 0 is current; only the mock server
        // resolves CAS. Polling cannot accidentally serialize the choices.
        if (holdConcurrentSaves) await bothSavesArrived;
      }
      const saved = rooms.get(body.p_token);
      if (!saved) return route.fulfill({ status: 404, json: { message: 'game_not_found', code: 'P0002' } });
      if (name === 'save_game') {
        if (body.p_expected_revision !== saved.revision) {
          stats.conflicts++;
          return route.fulfill({ status: 409, json: { message: 'revision_conflict', code: '40001' } });
        }
        stats.commits++;
        rooms.set(body.p_token, { state: body.p_state, revision: saved.revision + 1 });
      }
      return route.fulfill({ json: rooms.get(body.p_token), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
  }
  return { token, rooms, requests, stats, connect, release: () => release() };
}

test('six hidden choices survive closing, reopening and refresh, then a nonzero slot is selected at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const initial = initialForCard(4, 'chance-six-random');
  await prepareLocal(page, initial);
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(drawButton(page)).toBeEnabled();
  const pending = await readSession(page);
  expect(pending.state.phase).toBe('chance');
  expect(pending.state.players[0]).toMatchObject({ position: 2, cash: 15000 });
  expect(pending.state.chanceCard).toBeNull();
  expectValidOffer(pending.state.chanceOffer);
  await expect(picker(page)).not.toBeVisible();
  const randomCalls = await page.evaluate(() => window.__chanceShuffleRequests);
  expect(randomCalls).toBeGreaterThan(0);

  await openPicker(page);
  // Opening the picker reveals no card face and causes no settlement.
  const visibleText = (await options(page).allTextContents()).join(' ');
  for (const card of CHANCE_CARDS) expect(visibleText).not.toContain(card.title);
  expect((await readSession(page)).state).toEqual(pending.state);
  for (const card of await options(page).all()) {
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: '.local/world-chance-pick-320.png', fullPage: true });

  await page.locator('#chance-pick-close').click();
  await expect(picker(page)).not.toBeVisible();
  expect((await readSession(page)).state).toEqual(pending.state);
  await openPicker(page);
  expect((await readSession(page)).state.chanceOffer).toEqual(pending.state.chanceOffer);
  expect(await page.evaluate(() => window.__chanceShuffleRequests)).toBe(randomCalls);

  await page.reload();
  await expect(drawButton(page)).toBeEnabled();
  expect((await readSession(page)).state).toEqual(pending.state);
  await openPicker(page);
  expect(await page.evaluate(() => window.__chanceShuffleRequests)).toBe(0);
  const selectedIndex = 4;
  const selectedCard = CHANCE_CARDS.find(card => card.id === pending.state.chanceOffer[selectedIndex]);
  await picker(page).locator(`.chance-option[data-card-index="${selectedIndex}"]`).click();
  await expect(picker(page)).not.toBeVisible();
  await expect(page.locator('#chance-dialog')).toBeVisible();
  await expect(page.locator('#chance-title')).toHaveText(selectedCard.title);
  const drawn = await readSession(page);
  expect(drawn.state.phase).toBe('end');
  expect(drawn.state.chanceCard).toEqual({ id: selectedCard.id, playerId: 'p1' });
  expect(drawn.state.chanceOffer).toEqual(pending.state.chanceOffer);
  expect(errors).toEqual([]);
});

test('a selected cash card survives refresh and is never paid twice', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pending = pendingWithOffer('chance-reload-cash');
  expect(pending.chanceOffer.indexOf('dividend')).toBe(3);
  await prepareLocal(page, pending);
  await openPicker(page);
  await page.screenshot({ path: '.local/world-chance-pick-desktop.png', fullPage: true });
  expect((await readSession(page)).state.players[0].cash).toBe(15000);
  await chooseCard(page, 'dividend');
  await expect(page.locator('#chance-title')).toHaveText('创业分红');
  await expect(page.locator('#chance-description')).toContainText('¥1,200');
  await page.screenshot({ path: '.local/world-chance.png', fullPage: true });
  const drawn = await readSession(page);
  expect(drawn.state.id).toBe(pending.id);
  expect(drawn.state.phase).toBe('end');
  expect(drawn.state.players[0].cash).toBe(16200);
  expect(drawn.state.chanceCard).toEqual({ id: 'dividend', playerId: 'p1' });
  await page.locator('#chance-close').click();
  await expect(drawButton(page)).toHaveCount(0);

  await page.reload();
  await expect(drawButton(page)).toHaveCount(0);
  await expect(page.locator('.chance-history')).toBeVisible();
  expect((await readSession(page)).state).toEqual(drawn.state);
  await page.locator('.chance-history').click();
  await expect(page.locator('#chance-dialog')).toBeVisible();
  await expect(page.locator('#chance-title')).toHaveText('创业分红');
  expect((await readSession(page)).state).toEqual(drawn.state);
  await page.locator('#chance-close').click();
  await page.getByRole('button', { name: '结束回合', exact: true }).click();
  expect((await readSession(page)).state.players[0].cash).toBe(16200);
  expect(errors).toEqual([]);
});

for (const scenario of [
  { id: 'return-start', title: '返回起点', position: 0, cash: 17000, jailed: 0 },
  { id: 'go-to-jail', title: '前往监狱', position: 7, cash: 15000, jailed: 2 },
]) {
  test(`the ${scenario.id} card moves only after selecting its slot and remains settled after reload`, async ({ page }) => {
    const pending = pendingWithOffer('chance-move-' + scenario.id);
    await prepareLocal(page, pending);
    await openPicker(page);
    expect((await readSession(page)).state.players[0]).toMatchObject({ position: 2, cash: 15000 });
    await chooseCard(page, scenario.id);
    await expect(page.locator('#chance-title')).toHaveText(scenario.title);
    const drawn = await readSession(page);
    expect(drawn.state.phase).toBe('end');
    expect(drawn.state.chanceCard.id).toBe(scenario.id);
    expect(drawn.state.players[0]).toMatchObject({ position: scenario.position, cash: scenario.cash, jailed: scenario.jailed });
    await page.reload();
    await expect(drawButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();
    expect((await readSession(page)).state).toEqual(drawn.state);
    await page.locator('.chance-history').click();
    await expect(page.locator('#chance-title')).toHaveText(scenario.title);
    expect((await readSession(page)).state).toEqual(drawn.state);
  });
}

test('a legacy pending cloud game prepares its six-card offer once without settling it', async ({ browser }) => {
  const legacy = pendingWithOffer('legacy-chance-offer');
  delete legacy.chanceOffer;
  delete legacy.chanceCard;
  const mock = cloudRoom(legacy, { token: 'f'.repeat(64) });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await mock.connect(context);
    const page = await context.newPage();
    await page.goto('/#room=' + mock.token);
    await expect(drawButton(page)).toBeEnabled();
    expect(mock.requests).toHaveLength(0);
    await openPicker(page);
    const prepared = await readSession(page);
    expect(prepared.revision).toBe(1);
    expect(prepared.state.phase).toBe('chance');
    expect(prepared.state.chanceCard == null).toBe(true);
    expect(prepared.state.players[0]).toMatchObject({ position: 2, cash: 15000 });
    expectValidOffer(prepared.state.chanceOffer);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].p_expected_revision).toBe(0);
    expect(mock.requests[0].p_state.phase).toBe('chance');

    await page.locator('#chance-pick-close').click();
    await openPicker(page);
    expect((await readSession(page)).state).toEqual(prepared.state);
    expect(mock.requests).toHaveLength(1);
    await page.reload();
    await expect(page.locator('#sync-status')).toContainText('云端已保存');
    await openPicker(page);
    expect((await readSession(page)).state.chanceOffer).toEqual(prepared.state.chanceOffer);
    expect(mock.requests).toHaveLength(1);

    const selectedId = prepared.state.chanceOffer[5];
    await chooseCard(page, selectedId);
    const drawn = await readSession(page);
    expect(drawn.revision).toBe(2);
    expect(drawn.state.phase).toBe('end');
    expect(drawn.state.chanceCard).toEqual({ id: selectedId, playerId: 'p1' });
    expect(mock.requests).toHaveLength(2);
    expect(mock.stats).toEqual({ commits: 2, conflicts: 0 });
    expect(mock.requests.map(request => request.p_state.phase)).toEqual(['chance', 'end']);
  } finally { await context.close(); }
});

test('two devices choosing different slots settle once through revision conflict recovery', async ({ browser }) => {
  const pending = pendingWithOffer('shared-chance');
  const mock = cloudRoom(pending, { holdConcurrentSaves: true });
  const first = await browser.newContext({ reducedMotion: 'reduce' });
  const second = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await mock.connect(first); await mock.connect(second);
    const a = await first.newPage(), b = await second.newPage();
    await a.goto('/#room=' + mock.token);
    await b.goto('/#room=' + mock.token);
    await openPicker(a);
    await openPicker(b);
    expect((await readSession(a)).state.players[0].cash).toBe(15000);
    expect((await readSession(b)).state.players[0].cash).toBe(15000);
    expect((await readSession(a)).state.chanceOffer).toEqual(knownOffer);
    expect((await readSession(b)).state.chanceOffer).toEqual(knownOffer);
    expect(mock.requests).toHaveLength(0);

    const dividendSlot = pending.chanceOffer.indexOf('dividend');
    const lotterySlot = pending.chanceOffer.indexOf('lottery');
    await Promise.all([
      picker(a).locator(`.chance-option[data-card-index="${dividendSlot}"]`).click(),
      picker(b).locator(`.chance-option[data-card-index="${lotterySlot}"]`).click(),
    ]);
    await expect.poll(async () => (await readSession(a)).revision).toBe(1);
    await expect.poll(async () => (await readSession(b)).revision).toBe(1);
    await expect(a.locator('#sync-status')).toContainText('云端已保存');
    await expect(b.locator('#sync-status')).toContainText('云端已保存');
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests.map(request => request.p_expected_revision)).toEqual([0, 0]);
    expect(mock.requests.map(request => request.p_state.chanceCard.id).sort()).toEqual(['dividend', 'lottery']);
    expect(mock.stats).toEqual({ commits: 1, conflicts: 1 });
    const saved = mock.rooms.get(mock.token);
    const winningCard = getChanceCard(saved.state);
    expect(['dividend', 'lottery']).toContain(winningCard.id);
    expect(saved.revision).toBe(1);
    expect(saved.state.players[0].cash).toBe(15000 + winningCard.amount);
    expect(saved.state.phase).toBe('end');
    expect(saved.state.chanceOffer).toEqual(knownOffer);
    expect((await readSession(a)).state).toEqual(saved.state);
    expect((await readSession(b)).state).toEqual(saved.state);

    await b.reload();
    await expect(b.locator('#sync-status')).toContainText('云端已保存');
    await expect(drawButton(b)).toHaveCount(0);
    await b.locator('.chance-history').click();
    await expect(b.locator('#chance-title')).toHaveText(winningCard.title);
    expect((await readSession(b)).state).toEqual(saved.state);
    expect(mock.rooms.get(mock.token).revision).toBe(1);
    expect(mock.stats.commits).toBe(1);
  } finally {
    mock.release();
    await first.close(); await second.close();
  }
});
