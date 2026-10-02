import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createGame } from '../src/game.js';

const storageKey = 'dafuweng:v1';
const readSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const playerToken = (page, id = 'p1') => page.locator(`.token[data-player-id="${id}"]`);

test.beforeAll(async () => { await mkdir('.local', { recursive: true }); });

async function prepareLocalGame(page, legacyState = null) {
  await page.route('**/config.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'window.DAFUWENG_CONFIG={};',
  }));
  await page.addInitScript(({ key, legacy }) => {
    if (legacy && !localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ mode: 'local', state: legacy }));
    }

    // Control only dice-sized requests. Room tokens and UUIDs retain native RNG.
    const nativeRandomValues = crypto.getRandomValues.bind(crypto);
    let dieIndex = 0;
    crypto.getRandomValues = values => {
      if (values instanceof Uint8Array && values.length === 1) {
        values[0] = dieIndex++ % 2;
        return values;
      }
      return nativeRandomValues(values);
    };

    // Keep the real browser audio graph, autoplay policy and start() behavior.
    // These counters prove that sounds were scheduled, not that speakers exist.
    window.__featureAudio = { contexts: 0, bufferStarts: 0, oscillatorStarts: 0 };
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    if (NativeAudioContext) {
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) {
          super(...args);
          window.__featureAudio.contexts++;
        }
        createBufferSource(...args) {
          const source = super.createBufferSource(...args);
          const nativeStart = source.start.bind(source);
          source.start = (...startArgs) => {
            const result = nativeStart(...startArgs);
            window.__featureAudio.bufferStarts++;
            return result;
          };
          return source;
        }
        createOscillator(...args) {
          const oscillator = super.createOscillator(...args);
          const nativeStart = oscillator.start.bind(oscillator);
          oscillator.start = (...startArgs) => {
            const result = nativeStart(...startArgs);
            window.__featureAudio.oscillatorStarts++;
            return result;
          };
          return oscillator;
        }
      };
    }
  }, { key: storageKey, legacy: legacyState });
  await page.goto('/');
}

async function startLocalGame(page) {
  await expect(page.locator('#setup-dialog')).toBeVisible();
  await page.locator('#setup-form button[type=submit]').click();
  await expect(page.locator('#setup-dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '掷骰子', exact: true })).toBeEnabled();
}

async function chooseAnimal(page, opener, id, screenshotPath = null) {
  await opener.click();
  await expect(page.locator('#animal-dialog')).toBeVisible();
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.locator(`#animal-options .animal-option[data-animal-id="${id}"]`).click();
  await expect(page.locator('#animal-dialog')).not.toBeVisible();
}

async function observeMovement(page) {
  await page.evaluate(() => {
    window.__featurePositions = [];
    window.__featureRollingSeen = false;
    window.__featureMovingSeen = false;
    window.__featureStepSeen = false;
    const record = () => {
      const token = document.querySelector('.token[data-player-id="p1"]');
      if (token) {
        const position = Number(token.dataset.position);
        if (window.__featurePositions.at(-1) !== position) window.__featurePositions.push(position);
        window.__featureMovingSeen ||= token.classList.contains('is-moving');
      }
      window.__featureRollingSeen ||= Boolean(document.querySelector('#dice-display.is-rolling'));
      window.__featureStepSeen ||= Boolean(document.querySelector('.tile.is-step'));
    };
    record();
    new MutationObserver(record).observe(document.querySelector('#board'), {
      subtree: true, childList: true, attributes: true,
    });
  });
}

test('animal choices at setup and during play survive refresh', async ({ page }) => {
  await prepareLocalGame(page);
  await chooseAnimal(page, page.locator('#player-names .animal-select').first(), 'panda', '.local/feature-animals.png');
  await chooseAnimal(page, page.locator('#player-names .animal-select').nth(1), 'penguin');
  await startLocalGame(page);
  expect((await readSession(page)).state.players.map(player => player.animal)).toEqual(['panda', 'penguin']);
  await expect(page.locator('#players .avatar-button').first()).toContainText('🐼');
  await expect(playerToken(page, 'p2')).toContainText('🐧');

  await chooseAnimal(page, page.locator('#players .avatar-button').first(), 'fox');
  await expect.poll(async () => (await readSession(page)).state.players[0].animal).toBe('fox');
  const saved = await readSession(page);
  await page.reload();
  await expect(page.locator('#setup-dialog')).not.toBeVisible();
  await expect(page.locator('#players .avatar-button').first()).toContainText('🦊');
  await expect(playerToken(page)).toContainText('🦊');
  expect((await readSession(page)).state).toEqual(saved.state);
});

test('roll saves the final state before walking, plays sounds, buys a house and remembers mute', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepareLocalGame(page);
  await startLocalGame(page);
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'true');
  await observeMovement(page);

  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(page.locator('#dice-display')).toHaveClass(/is-rolling/);
  const savedDuringRoll = await readSession(page);
  expect(savedDuringRoll.state.dice).toEqual([1, 2]);
  expect(savedDuringRoll.state.players[0].position).toBe(3);
  await expect(playerToken(page)).toHaveAttribute('data-position', '0');
  await expect(page.getByRole('button', { name: /^购买/ })).toBeDisabled();

  await expect(page.getByRole('button', { name: /^购买/ })).toBeEnabled();
  await expect(playerToken(page)).toHaveAttribute('data-position', '3');
  expect(await page.evaluate(() => window.__featurePositions)).toEqual([0, 1, 2, 3]);
  expect(await page.evaluate(() => [window.__featureRollingSeen, window.__featureMovingSeen, window.__featureStepSeen])).toEqual([true, true, true]);
  await expect(page.locator('#dice-display .die-face')).toHaveCount(2);
  await expect(page.locator('#dice-display .die-face').nth(0)).toHaveAttribute('data-value', '1');
  await expect(page.locator('#dice-display .die-face').nth(1)).toHaveAttribute('data-value', '2');
  const audio = await page.evaluate(() => window.__featureAudio);
  expect(audio.contexts).toBeGreaterThan(0);
  expect(audio.bufferStarts).toBeGreaterThan(0);
  expect(audio.oscillatorStarts).toBeGreaterThan(0);

  const japan = page.locator('.tile[data-tile-id="3"]');
  await expect(japan).toContainText('日本');
  await page.getByRole('button', { name: /^购买/ }).click();
  await expect(japan.locator('.tile-house')).toBeVisible();
  await expect(japan.locator('.house-icon')).toBeVisible();
  expect((await readSession(page)).state.properties['3'].ownerId).toBe('p1');
  expect((await readSession(page)).state.properties['3'].level).toBe(0);
  await expect(page.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.screenshot({ path: '.local/feature-desktop.png', fullPage: true });
  for (const [width, path] of [[390, '.local/feature-mobile.png'], [320, '.local/feature-small.png']]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path, fullPage: true });
  }

  await page.locator('#sound-button').click();
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  const mutedAudio = await page.evaluate(() => window.__featureAudio);
  await page.getByRole('button', { name: '结束回合', exact: true }).click();
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__featureAudio)).toEqual(mutedAudio);

  const finalState = (await readSession(page)).state;
  await page.reload();
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(japan.locator('.tile-house')).toBeVisible();
  expect((await readSession(page)).state).toEqual(finalState);
  expect(errors).toEqual([]);
});

test('refresh during a walking frame resumes the already committed final position', async ({ page }) => {
  await prepareLocalGame(page);
  await startLocalGame(page);
  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(page.locator('.token.is-moving[data-player-id="p1"]')).toBeVisible();
  const stored = await readSession(page);
  expect(stored.state.players[0].position).toBe(3);
  expect(stored.state.dice).toEqual([1, 2]);
  await page.reload();
  await expect(playerToken(page)).toHaveAttribute('data-position', '3');
  await expect(page.locator('#dice-display')).not.toHaveClass(/is-rolling/);
  await expect(page.locator('.token.is-moving')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^购买/ })).toBeEnabled();
  expect((await readSession(page)).state).toEqual(stored.state);
});

test('legacy saves without animals restore, accept a new animal and play with reduced motion', async ({ page }) => {
  const state = createGame({ names: ['旧玩家甲', '旧玩家乙'] }, { id: 'legacy-animal-save' });
  for (const player of state.players) delete player.animal;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepareLocalGame(page, state);
  await expect(page.locator('#setup-dialog')).not.toBeVisible();
  await expect(page.locator('#players .avatar-button').first()).toContainText('🐱');
  await chooseAnimal(page, page.locator('#players .avatar-button').first(), 'frog');
  await expect.poll(async () => (await readSession(page)).state.players[0].animal).toBe('frog');

  await page.getByRole('button', { name: '掷骰子', exact: true }).click();
  await expect(page.getByRole('button', { name: /^购买/ })).toBeEnabled({ timeout: 1500 });
  await expect(playerToken(page)).toHaveAttribute('data-position', '3');
  await expect(page.locator('#dice-display')).not.toHaveClass(/is-rolling/);
  await expect(page.locator('.token.is-moving')).toHaveCount(0);
  const saved = await readSession(page);
  await page.reload();
  await expect(playerToken(page)).toContainText('🐸');
  await expect(playerToken(page)).toHaveAttribute('data-position', '3');
  expect((await readSession(page)).state).toEqual(saved.state);
});
