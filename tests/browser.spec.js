import { test, expect } from '@playwright/test';
const key = 'dafuweng:v1';
const readSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);

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
