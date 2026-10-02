import { test, expect } from '@playwright/test';
import { createGame, applyAction, getChanceCard } from '../src/game.js';

const storageKey = 'dafuweng:v1';
const readSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const drawButton = page => page.getByRole('button', { name: '抽取机遇卡', exact: true });

function initialForCard(round, id) {
  const state = createGame({ names: ['抽卡玩家', '同行伙伴'], animals: ['panda', 'fox'] }, { id });
  state.round = round;
  return state;
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
    // Only constrain the two one-byte dice requests; UUIDs keep native RNG.
    const nativeRandomValues = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = values => {
      if (values instanceof Uint8Array && values.length === 1) { values[0] = 0; return values; }
      return nativeRandomValues(values);
    };
  }, { key: storageKey, state });
  await page.goto('/');
  await expect(page.locator('#setup-dialog')).not.toBeVisible();
}

test('pending cards survive refresh and a revealed cash card is never paid twice', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const initial = initialForCard(4, 'chance-reload-cash'); // [1,1] -> tile 2 -> dividend.
  delete initial.chanceCard; // A version 1 save from before explicit card draws.
  await prepareLocal(page, initial);
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(drawButton(page)).toBeEnabled();
  const pending = await readSession(page);
  expect(pending.state.phase).toBe('chance');
  expect(pending.state.players[0].position).toBe(2);
  expect(pending.state.players[0].cash).toBe(15000);
  expect(pending.state.chanceCard).toBeNull();
  await expect(page.locator('#chance-dialog')).not.toBeVisible();

  await page.reload();
  await expect(drawButton(page)).toBeEnabled();
  expect((await readSession(page)).state).toEqual(pending.state);
  await drawButton(page).click();
  await expect(page.locator('#chance-dialog')).toBeVisible();
  await expect(page.locator('#chance-title')).toHaveText('创业分红');
  await expect(page.locator('#chance-description')).toContainText('¥1,200');
  await page.screenshot({ path: '.local/world-chance.png', fullPage: true });
  const drawn = await readSession(page);
  expect(drawn.state.id).toBe(initial.id);
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
  { round: 8, id: 'return-start', title: '返回起点', position: 0, cash: 17000, jailed: 0 },
  { round: 1, id: 'go-to-jail', title: '前往监狱', position: 7, cash: 15000, jailed: 2 },
]) {
  test(`the ${scenario.id} card moves only after drawing and remains settled after reload`, async ({ page }) => {
    const initial = initialForCard(scenario.round, 'chance-move-' + scenario.id);
    await prepareLocal(page, initial);
    await page.getByRole('button', { name: '掷骰子', exact: true }).click();
    await expect(drawButton(page)).toBeEnabled();
    expect((await readSession(page)).state.players[0].position).toBe(2);
    expect((await readSession(page)).state.players[0].cash).toBe(15000);

    await drawButton(page).click();
    await expect(page.locator('#chance-dialog')).toBeVisible();
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

test('two devices drawing the same pending card settle once through revision conflict recovery', async ({ browser }) => {
  const token = 'e'.repeat(64);
  const pending = applyAction(initialForCard(4, 'shared-chance'), { type: 'ROLL', dice: [1, 1] });
  const rooms = new Map([[token, { state: pending, revision: 0 }]]);
  const requests = [];
  let commits = 0, conflicts = 0;
  let release;
  const bothDrawsArrived = new Promise(resolve => { release = resolve; });
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
        // Hold the first save so both real UIs act on revision 0, regardless
        // of polling or rendering speed. Only the mock server performs CAS.
        await bothDrawsArrived;
      }
      const saved = rooms.get(body.p_token);
      if (!saved) return route.fulfill({ status: 404, json: { message: 'game_not_found', code: 'P0002' } });
      if (name === 'save_game') {
        if (body.p_expected_revision !== saved.revision) {
          conflicts++;
          return route.fulfill({ status: 409, json: { message: 'revision_conflict', code: '40001' } });
        }
        commits++;
        rooms.set(body.p_token, { state: body.p_state, revision: saved.revision + 1 });
      }
      return route.fulfill({ json: rooms.get(body.p_token), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
  }
  const first = await browser.newContext({ reducedMotion: 'reduce' });
  const second = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await connect(first); await connect(second);
    const a = await first.newPage(), b = await second.newPage();
    await a.goto('/#room=' + token);
    await b.goto('/#room=' + token);
    await expect(drawButton(a)).toBeEnabled();
    await expect(drawButton(b)).toBeEnabled();
    expect((await readSession(a)).state.players[0].cash).toBe(15000);
    expect((await readSession(b)).state.players[0].cash).toBe(15000);

    await Promise.all([drawButton(a).click(), drawButton(b).click()]);
    await expect.poll(async () => (await readSession(a)).revision).toBe(1);
    await expect.poll(async () => (await readSession(b)).revision).toBe(1);
    await expect(a.locator('#sync-status')).toContainText('云端已保存');
    await expect(b.locator('#sync-status')).toContainText('云端已保存');
    expect(requests).toHaveLength(2);
    expect(requests.map(request => request.p_expected_revision)).toEqual([0, 0]);
    expect(commits).toBe(1);
    expect(conflicts).toBe(1);
    const saved = rooms.get(token);
    expect(saved.revision).toBe(1);
    expect(saved.state.players[0].cash).toBe(16200);
    expect(saved.state.phase).toBe('end');
    expect(getChanceCard(saved.state).id).toBe('dividend');
    expect((await readSession(a)).state).toEqual(saved.state);
    expect((await readSession(b)).state).toEqual(saved.state);

    await b.reload();
    await expect(b.locator('#sync-status')).toContainText('云端已保存');
    await expect(drawButton(b)).toHaveCount(0);
    await b.locator('.chance-history').click();
    await expect(b.locator('#chance-title')).toHaveText('创业分红');
    expect((await readSession(b)).state).toEqual(saved.state);
    expect(rooms.get(token).revision).toBe(1);
    expect(commits).toBe(1);
  } finally {
    release();
    await first.close(); await second.close();
  }
});
