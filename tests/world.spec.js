import { test, expect } from '@playwright/test';
import { createGame } from '../src/game.js';

test('real WebGL world renders, rotates, rolls physical dice, places houses and fits phones', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.DAFUWENG_CONFIG={};' }));
  await page.addInitScript(() => {
    const random = crypto.getRandomValues.bind(crypto); let die = 0;
    crypto.getRandomValues = values => { if (values instanceof Uint8Array && values.length === 1) { values[0] = die++ % 2; return values; } return random(values); };
  });
  await page.goto('/');
  await page.locator('#setup-form button[type=submit]').click();
  const canvas = page.locator('#world-canvas');
  await expect(page.locator('body')).toHaveClass(/has-webgl/);
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(canvas).toHaveAttribute('data-landmarks', '20');
  expect(await canvas.evaluate(node => Boolean(node.getContext('webgl2')))).toBe(true);
  await page.setViewportSize({ width: 1365, height: 1080 });
  await page.locator('#reset-camera').click();
  await expect.poll(() => canvas.evaluate(node => node.dataset.viewport === `${node.clientWidth}x${node.clientHeight}`)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.local/world-desktop.png', fullPage: true });
  const original = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .55, { steps: 12 }); await page.mouse.up();
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await page.locator('#reset-camera').click();
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rolling', 'true');
  await expect(page.getByRole('button', { name: /^购买/ })).toBeEnabled();
  await expect(canvas).toHaveAttribute('data-dice', '1,2');
  await expect(canvas).toHaveAttribute('data-rolling', 'false');
  await page.getByRole('button', { name: /^购买/ }).click();
  await expect(canvas).toHaveAttribute('data-houses', '1');
  await expect(page.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();
  await page.locator('[data-tile-id="20"]').click();
  await expect(page.locator('#property-panel')).toContainText('自由女神');
  await page.getByRole('button', { name: '近看地标', exact: true }).click();
  await page.locator('#world-canvas').screenshot({ path: '.local/world-liberty.png' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#reset-camera').click();
    await expect.poll(() => canvas.evaluate(node => node.dataset.viewport === `${node.clientWidth}x${node.clientHeight}`)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(canvas).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/world-mobile-${width}.png`, fullPage: true });
  }
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('dafuweng:v1')).state);
  await page.reload(); await expect(canvas).toHaveAttribute('data-houses', '1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dafuweng:v1')).state)).toEqual(state);
  expect(errors).toEqual([]);
});

test('a device without WebGL can continue its saved game on the flat board', async ({ page }) => {
  const state = createGame({ names: ['兼容设备', '朋友'] }, { id: 'webgl-fallback' });
  await page.addInitScript(state => {
    localStorage.setItem('dafuweng:v1', JSON.stringify({ mode: 'local', state }));
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.includes('webgl') ? null : native.call(this, type, ...args); };
  }, state);
  await page.goto('/');
  await expect(page.locator('#world-fallback')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/has-webgl/);
  await expect(page.locator('#board > .tile')).toHaveCount(32);
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dafuweng:v1')).state.dice)).not.toBeNull();
});

test('a renderer failure while changing animals preserves the save and never locks the game', async ({ page }) => {
  await page.goto('/');
  await page.locator('#setup-form button[type=submit]').click();
  await expect(page.locator('#world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { if (type === '2d') throw new Error('Lost drawing device'); return original.call(this, type, ...args); };
  });
  await page.locator('#players .avatar-button').first().click();
  await page.locator('#animal-options [data-animal-id="panda"]').click();
  await expect(page.locator('#world-fallback')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/has-webgl/);
  await expect(page.getByRole('button', { name: '掷骰子', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dafuweng:v1')).state.players[0].animal)).toBe('panda');
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dafuweng:v1')).state.dice)).not.toBeNull();
});
