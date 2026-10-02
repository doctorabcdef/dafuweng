import { test, expect } from '@playwright/test';
import { createGame, applyAction } from '../src/game.js';
const key = 'dafuweng:v1';
const readSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);

async function mockCloud(context, rooms, { configured = true, beforeSave = async () => {}, beforeRequest = async () => {} } = {}) {
  await context.route('**/config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: configured ? 'window.DAFUWENG_CONFIG={supabaseUrl:"https://test.supabase.co",supabaseKey:"sb_publishable_test"};' : 'window.DAFUWENG_CONFIG={};',
  }));
  await context.route('https://test.supabase.co/rest/v1/rpc/**', async route => {
    const name = route.request().url().split('/').at(-1);
    const body = route.request().postDataJSON();
    await beforeRequest(name, body);
    if (name === 'save_game') await beforeSave(body);
    let saved = rooms.get(body.p_token);
    if (name === 'create_game' && !saved) {
      saved = { state: body.p_state, revision: 0 };
      rooms.set(body.p_token, saved);
    }
    if (!saved) return route.fulfill({ status: 404, json: { message: 'game_not_found', code: 'P0002' } });
    if (name === 'save_game') {
      if (body.p_expected_revision !== saved.revision) return route.fulfill({ status: 409, json: { message: 'revision_conflict', code: '40001' } });
      saved = { state: body.p_state, revision: saved.revision + 1 };
      rooms.set(body.p_token, saved);
    }
    return route.fulfill({ json: saved, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}

test('local game restores the exact state after refresh and fits a phone', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#setup-dialog')).toBeVisible();
  await page.locator('#player-names input').first().fill('<小橘>');
  await page.locator('#setup-form button[type=submit]').click();
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  const saved = await readSession(page);
  expect(saved.state.dice).toHaveLength(2);
  await page.reload();
  await expect(page.locator('#setup-dialog')).not.toBeVisible();
  expect((await readSession(page)).state).toEqual(saved.state);
  await expect(page.locator('#players')).toContainText('<小橘>');
  await expect(page.locator('#board > .tile')).toHaveCount(32);
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two devices join, resume, reject stale writes and recover after offline', async ({ browser }) => {
  const rooms = new Map();
  async function connect(context) {
    await context.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.DAFUWENG_CONFIG={supabaseUrl:"https://test.supabase.co",supabaseKey:"sb_publishable_test"};' }));
    await context.route('https://test.supabase.co/rest/v1/rpc/**', async route => {
      const name = route.request().url().split('/').at(-1);
      const body = route.request().postDataJSON();
      let saved = rooms.get(body.p_token);
      if (name === 'create_game' && !saved) { saved = { state: body.p_state, revision: 0 }; rooms.set(body.p_token, saved); }
      if (!saved) return route.fulfill({ status: 404, json: { message: 'game_not_found', code: 'P0002' } });
      if (name === 'save_game') {
        if (body.p_expected_revision !== saved.revision) return route.fulfill({ status: 409, json: { message: 'revision_conflict', code: '40001' } });
        saved = { state: body.p_state, revision: saved.revision + 1 }; rooms.set(body.p_token, saved);
      }
      return route.fulfill({ json: saved, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
  }
  const first = await browser.newContext(); const second = await browser.newContext();
  await connect(first); await connect(second);
  const a = await first.newPage(); const b = await second.newPage();
  a.on('pageerror', error => console.log('Browser error:', error.message));
  a.on('console', message => { if (message.type() === 'error') console.log('Browser console:', message.text()); });
  await a.goto('/');
  await expect(a.locator('#mode-cloud')).toBeChecked();
  await a.locator('#setup-form button[type=submit]').click();
  await expect(a.locator('#setup-error')).toHaveText('');
  await expect(a.locator('#sync-status')).toContainText('云端已保存');
  const link = a.url();
  await b.goto(link);
  await expect(b.locator('#sync-status')).toContainText('云端已保存');
  const initial = await readSession(b);
  await a.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect.poll(async () => (await readSession(a)).revision).toBe(1);
  // B still has revision 0; its old action must not overwrite A's dice.
  await b.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect.poll(async () => (await readSession(b)).revision).toBe(1);
  expect(rooms.get(initial.token).revision).toBe(1);
  expect((await readSession(b)).state).toEqual((await readSession(a)).state);
  await b.goto('/');
  await expect(b.locator('#sync-status')).toContainText('云端已保存');
  expect(b.url()).toContain('#room=' + initial.token);
  expect((await readSession(b)).state.id).toBe(initial.state.id);
  await b.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(b.locator('#sync-status')).toContainText('操作已暂停');
  const buttons = b.locator('#actions button');
  for (let i = 0; i < await buttons.count(); i++) await expect(buttons.nth(i)).toBeDisabled();
  await b.evaluate(() => dispatchEvent(new Event('online')));
  await expect(b.locator('#sync-status')).toContainText('云端已保存');
  await first.close(); await second.close();
});

test('polling an old cloud room preserves a newer local game in another window', async ({ context, page }) => {
  const rooms = new Map();
  await mockCloud(context, rooms);
  await page.goto('/');
  await page.locator('#setup-form button[type=submit]').click();
  await expect(page.locator('#sync-status')).toContainText('云端已保存');
  const cloudSession = await readSession(page);

  const localPage = await context.newPage();
  await localPage.goto('/');
  await expect(localPage.locator('#sync-status')).toContainText('云端已保存');
  localPage.on('dialog', dialog => dialog.accept());
  await localPage.locator('#new-game-button').click();
  await localPage.locator('#mode-local').check();
  await localPage.locator('#player-names input').first().fill('本机新玩家');
  await localPage.locator('#setup-form button[type=submit]').click();
  await localPage.getByRole('button', { name: '掷骰子', exact: true }).click();
  const localSession = await readSession(localPage);
  expect(localSession.mode).toBe('local');
  expect(localSession.state.id).not.toBe(cloudSession.state.id);

  const advanced = applyAction(cloudSession.state, { type: 'ROLL', dice: [1, 2] });
  rooms.set(cloudSession.token, { state: advanced, revision: 1 });
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // Observing the new cloud event proves the old window actually polled and
  // accepted its snapshot before we check the shared browser's latest save.
  await expect(page.locator('#event-text')).toHaveText(advanced.lastEvent);
  expect((await readSession(page)).state).toEqual(localSession.state);

  await localPage.reload();
  await expect(localPage.locator('#sync-status')).toContainText('本机自动保存');
  await expect(localPage.locator('#setup-dialog')).not.toBeVisible();
  expect((await readSession(localPage)).state).toEqual(localSession.state);
  await expect(localPage.locator('#players')).toContainText('本机新玩家');
});

test('a room link opened during a save is restored after the original save finishes', async ({ context, page }) => {
  const rooms = new Map();
  let releaseSave;
  let markSaving;
  const saving = new Promise(resolve => { markSaving = resolve; });
  const holdSave = new Promise(resolve => { releaseSave = resolve; });
  await mockCloud(context, rooms, { beforeSave: async () => { markSaving(); await holdSave; } });
  await page.goto('/');
  await page.locator('#setup-form button[type=submit]').click();
  await expect(page.locator('#sync-status')).toContainText('云端已保存');
  const original = await readSession(page);
  const targetToken = 'b'.repeat(64);
  const targetState = createGame({ names: ['目标玩家', '目标伙伴'] }, { id: 'target-room' });
  rooms.set(targetToken, { state: targetState, revision: 0 });

  try {
    await page.getByRole('button', { name: '掷骰子', exact: true }).click();
    await saving;
    await expect(page.locator('#sync-status')).toContainText('正在保存');
    await page.evaluate(token => { location.hash = '#room=' + token; }, targetToken);
    await expect(page).toHaveURL(new RegExp('#room=' + targetToken + '$'));
    releaseSave();
    await expect(page.locator('#turn-label')).toHaveText('目标玩家 的回合');
    await expect(page.locator('#sync-status')).toContainText('云端已保存');
    await expect.poll(async () => (await readSession(page)).token).toBe(targetToken);
    expect((await readSession(page)).state).toEqual(targetState);
    expect(rooms.get(original.token).revision).toBe(1);
    expect(rooms.get(original.token).state.dice).toHaveLength(2);
    expect(rooms.get(targetToken)).toEqual({ state: targetState, revision: 0 });
    await page.reload();
    await expect(page.locator('#turn-label')).toHaveText('目标玩家 的回合');
  } finally {
    releaseSave();
  }
});

test('sharing a local game after configuring cloud preserves its exact progress on another device', async ({ browser, context, page }) => {
  const rooms = new Map();
  await mockCloud(context, rooms, { configured: false });
  await page.goto('/');
  await expect(page.locator('#mode-local')).toBeChecked();
  await page.locator('#setup-form button[type=submit]').click();
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  const localSession = await readSession(page);
  expect(localSession.mode).toBe('local');
  expect(localSession.state.dice).toHaveLength(2);

  await page.locator('#share-button').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.locator('#cloud-url').fill('https://test.supabase.co');
  await page.locator('#cloud-key').fill('sb_publishable_test');
  await page.locator('#settings-save').click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await page.locator('#share-button').click();
  await expect(page.locator('#share-dialog')).toBeVisible();
  const promoted = await readSession(page);
  expect(promoted.mode).toBe('cloud');
  expect(promoted.state).toEqual(localSession.state);
  expect(promoted.revision).toBe(0);
  expect(rooms.get(promoted.token).state).toEqual(localSession.state);
  const link = await page.locator('#share-link').inputValue();

  const remote = await browser.newContext();
  try {
    await mockCloud(remote, rooms);
    const remotePage = await remote.newPage();
    await remotePage.goto(link);
    await expect(remotePage.locator('#sync-status')).toContainText('云端已保存');
    expect((await readSession(remotePage)).state).toEqual(localSession.state);
    await remotePage.goto('/');
    await expect(remotePage.locator('#sync-status')).toContainText('云端已保存');
    expect((await readSession(remotePage)).state.id).toBe(localSession.state.id);
  } finally {
    await remote.close();
  }
});

test('an old room read cannot delay entering a new room or replace the latest room', async ({ context, page }) => {
  const rooms = new Map();
  let heldToken;
  let releaseRead;
  let markReading;
  const reading = new Promise(resolve => { markReading = resolve; });
  const holdRead = new Promise(resolve => { releaseRead = resolve; });
  await mockCloud(context, rooms, { beforeRequest: async (name, body) => {
    if (name === 'read_game' && body.p_token === heldToken) { markReading(); await holdRead; }
  } });
  await page.goto('/');
  await page.locator('#setup-form button[type=submit]').click();
  await expect(page.locator('#sync-status')).toContainText('云端已保存');
  const original = await readSession(page);
  heldToken = original.token;
  const targetToken = 'c'.repeat(64);
  const targetState = createGame({ names: ['新房间玩家', '新房间伙伴'] }, { id: 'new-room-after-read' });
  rooms.set(targetToken, { state: targetState, revision: 0 });

  try {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await reading;
    await page.evaluate(token => { location.hash = '#room=' + token; }, targetToken);
    // Room B must become ready while room A's response is still held.
    await expect(page.locator('#turn-label')).toHaveText('新房间玩家 的回合');
    await expect(page.locator('#sync-status')).toContainText('云端已保存');
    expect((await readSession(page)).token).toBe(targetToken);

    const lateResponse = page.waitForResponse(response => response.url().endsWith('/read_game') && response.request().postDataJSON().p_token === original.token);
    releaseRead();
    await (await lateResponse).finished();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect((await readSession(page)).state).toEqual(targetState);
    await expect(page.locator('#turn-label')).toHaveText('新房间玩家 的回合');
    await page.goto('/');
    await expect(page.locator('#turn-label')).toHaveText('新房间玩家 的回合');
    expect(page.url()).toContain('#room=' + targetToken);
  } finally {
    releaseRead();
  }
});

test('a room link opened while promoting a local game takes effect after promotion', async ({ context, page }) => {
  const rooms = new Map();
  let releaseCreate;
  let markCreating;
  const creating = new Promise(resolve => { markCreating = resolve; });
  const holdCreate = new Promise(resolve => { releaseCreate = resolve; });
  await mockCloud(context, rooms, { beforeRequest: async name => {
    if (name === 'create_game') { markCreating(); await holdCreate; }
  } });
  await page.goto('/');
  await page.locator('#mode-local').check();
  await page.locator('#setup-form button[type=submit]').click();
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  const localSession = await readSession(page);
  const targetToken = 'd'.repeat(64);
  const targetState = createGame({ names: ['目标云玩家', '目标云伙伴'] }, { id: 'target-after-promotion' });
  rooms.set(targetToken, { state: targetState, revision: 0 });

  try {
    await page.locator('#share-button').click();
    await creating;
    await expect(page.locator('#sync-status')).toContainText('正在保存');
    await page.evaluate(token => { location.hash = '#room=' + token; }, targetToken);
    releaseCreate();
    await expect(page.locator('#turn-label')).toHaveText('目标云玩家 的回合');
    await expect(page.locator('#sync-status')).toContainText('云端已保存');
    expect(page.url()).toContain('#room=' + targetToken);
    expect((await readSession(page)).state).toEqual(targetState);
    const promoted = [...rooms.values()].find(snapshot => snapshot.state.id === localSession.state.id);
    expect(promoted.state).toEqual(localSession.state);
    expect(rooms.size).toBe(2);
  } finally {
    releaseCreate();
  }
});
