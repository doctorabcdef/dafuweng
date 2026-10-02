import { test, expect } from '@playwright/test';

const storageKey = 'dafuweng:v1';
const readSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);

test('a second local window can buy during the first window animation without losing the purchase', async ({ context, page: first }) => {
  const errors = [];
  first.on('pageerror', error => errors.push(error.message));
  await context.route('**/config.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'window.DAFUWENG_CONFIG={};',
  }));
  await first.addInitScript(() => {
    // Emulate two visible desktop windows. Switching Playwright's active page
    // must not trigger the production shortcut that skips hidden-page animation.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const nativeRandomValues = crypto.getRandomValues.bind(crypto);
    let die = 0;
    crypto.getRandomValues = values => {
      if (values instanceof Uint8Array && values.length === 1) {
        values[0] = die++ % 2;
        return values;
      }
      return nativeRandomValues(values);
    };
  });
  await first.emulateMedia({ reducedMotion: 'no-preference' });
  await first.clock.install({ time: new Date('2026-10-02T00:00:00Z') });
  await first.goto('/');
  await first.locator('#setup-form button[type=submit]').click();
  await expect(first.locator('#sync-status')).toHaveText('本机自动保存');
  const initial = await readSession(first);

  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.goto('/');
  await expect(second.locator('#setup-dialog')).not.toBeVisible();
  expect((await readSession(second)).state.id).toBe(initial.state.id);

  // Freeze only A's timers, leaving two real pages and their real browser
  // storage events active. B can finish its purchase while A is still rolling.
  await first.clock.pauseAt(new Date('2026-10-02T00:01:00Z'));
  await first.getByRole('button', { name: '掷骰子', exact: true }).click({ force: true });
  await expect(first.locator('#dice-display')).toHaveClass(/is-rolling/);
  const rolled = await readSession(first);
  expect(rolled.state.dice).toEqual([1, 2]);
  expect(rolled.state.players[0].position).toBe(3);
  expect(rolled.state.properties['3'].ownerId).toBeNull();

  await expect(second.getByRole('button', { name: /^购买/ })).toBeEnabled();
  await second.getByRole('button', { name: /^购买/ }).click();
  const purchased = await readSession(second);
  expect(purchased.state.properties['3'].ownerId).toBe('p1');
  expect(purchased.state.players[0].cash).toBe(13800);
  await expect(second.locator('.tile[data-tile-id="3"] .tile-house')).toBeVisible();
  // A has intentionally deferred applying B's storage events until its own
  // animation finishes; this reproduces the exact busy-window race.
  await expect(first.locator('#dice-display')).toHaveClass(/is-rolling/);
  await expect(first.locator('.tile[data-tile-id="3"] .tile-house')).toHaveCount(0);
  await expect(first.locator('#actions button').first()).toBeDisabled();

  await first.clock.runFor(2500);
  await expect(first.locator('#dice-display')).not.toHaveClass(/is-rolling/);
  await expect(first.locator('.tile[data-tile-id="3"] .tile-house')).toBeVisible();
  await expect(first.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();
  expect((await readSession(first)).state).toEqual(purchased.state);

  // The formerly stale window's next action must extend B's purchased state.
  await first.getByRole('button', { name: '结束回合', exact: true }).click({ force: true });
  const continued = await readSession(first);
  expect(continued.state.currentPlayer).toBe(1);
  expect(continued.state.properties['3'].ownerId).toBe('p1');
  expect(continued.state.players[0].cash).toBe(13800);
  await second.reload();
  await expect(second.locator('.tile[data-tile-id="3"] .tile-house')).toBeVisible();
  expect((await readSession(second)).state).toEqual(continued.state);
  expect(errors).toEqual([]);
});
