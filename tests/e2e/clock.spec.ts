import { expect, test, type Page } from '@playwright/test';

const CHICAGO = { name: 'Chicago, Illinois, United States', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago' };

async function open(page: Page, now: string, settings: Record<string, unknown> = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript((s) => localStorage.setItem('adhan-clock:settings', JSON.stringify(s)), {
    place: CHICAGO,
    ...settings,
  });
  await page.goto(`/?now=${now}`);
  return errors;
}

test('first run asks for a location', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Adhan Clock' })).toBeVisible();
  await expect(page.getByRole('button', { name: "Use this tablet's location" })).toBeVisible();
});

const scenes: [string, string, Record<string, unknown>, string][] = [
  ['calligraphy after Dhuhr', '2026-10-29T12:50:00', {}, '.ct'],
  ['classic afternoon', '2026-10-29T14:53:00', {}, '.cl'],
  ['kids afternoon', '2026-10-29T14:53:00', { dayTheme: 'kids' }, '.kd'],
  ['night', '2026-10-29T23:10:00', {}, '.nt'],
  ['pre-athan countdown', '2026-10-29T12:34:30', {}, '.tk-count'],
  ['athan', '2026-10-29T12:35:10', {}, '.tk-athan'],
  ['dua', '2026-10-29T12:38:30', {}, '.tk-dua'],
  ['iqamah countdown', '2026-10-29T12:49:30', {}, '.tk-count'],
  ["Jumu'ah", '2026-10-30T12:35:10', {}, '.tk-athan'],
];

for (const [name, now, settings, selector] of scenes) {
  test(`renders ${name} without errors`, async ({ page }) => {
    const errors = await open(page, now, settings);
    await expect(page.locator(selector).first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
}

test('classic theme shows the five prayers with Dhuhr current', async ({ page }) => {
  await open(page, '2026-10-29T14:53:00');
  await expect(page.locator('.cl-prayer')).toHaveCount(5);
  await expect(page.locator('.cl-prayer.current .cl-name')).toHaveText('DHUHR');
  await expect(page.locator('.cl-medal-name')).toHaveText('ASR');
});

test('settings open, change the theme, and persist', async ({ page }) => {
  await open(page, '2026-10-29T14:53:00');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Kids' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.kd')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('adhan-clock:settings')!));
  expect(stored.dayTheme).toBe('kids');
});

test('preview jumps to the athan sequence and exits', async ({ page }) => {
  await open(page, '2026-10-29T14:53:00');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.panel-nav').getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Asr athan' }).click();
  // Previews land 65 s before the athan; the countdown starts at 60 s.
  await expect(page.locator('.tk-count')).toBeVisible({ timeout: 10_000 });
  await page.locator('.preview-bar').getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.preview-bar')).toHaveCount(0);
});

test('dismissing the athan returns to the theme', async ({ page }) => {
  await open(page, '2026-10-29T12:35:10');
  await page.getByRole('button', { name: /Stop the athan|Close/ }).click();
  await expect(page.locator('.tk-athan')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.ct')).toBeVisible();
});

test('plays the Dhuhr athan from the right offset and stops on dismiss', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: { at: number; paused: () => boolean }[] };
    w.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push({ at: this.currentTime, paused: () => this.paused });
      return orig.call(this);
    };
  });
  await open(page, '2026-10-29T12:35:20');
  await expect.poll(() => page.evaluate(() => (window as any).__plays.length)).toBeGreaterThan(0);
  const at = await page.evaluate(() => (window as any).__plays[0].at);
  expect(at).toBeGreaterThan(18);
  expect(at).toBeLessThan(25);
  await expect.poll(() => page.evaluate(() => (window as any).__plays[0].paused())).toBe(false);
  await page.getByRole('button', { name: 'Stop the athan' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__plays[0].paused())).toBe(true);
});

test('Fajr uses the Fajr athan', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => r.url().includes('/audio/') && urls.push(r.url()));
  await open(page, '2026-10-29T06:02:10');
  await expect.poll(() => urls.some((u) => u.endsWith('athan-fajr-1.mp3'))).toBe(true);
});

test('gallery rotates captioned photos by the configured interval', async ({ page }) => {
  const items = ['a', 'b', 'c'].map((id) => ({
    id,
    file: 'kul-sharif.webp',
    fileSm: 'kul-sharif-sm.webp',
    category: 'mosques',
    title: `Title ${id}`,
    subtitle: 'Somewhere',
    fit: 'cover',
    focus: '50% 50%',
    tones: { gallery: 'light', calligraphy: 'dark' },
    credit: {},
  }));
  await page.route('**/gallery/index.json', (r) => r.fulfill({ json: items }));
  const errors = await open(page, '2026-10-29T14:53:00', {
    dayTheme: 'gallery',
    gallery: { minutes: 5, categories: { mosques: true, learning: true, treasures: true, landscapes: true, calligraphy: false } },
  });
  await expect(page.locator('.gl-title')).toHaveText(/Title [abc]/);
  await expect(page.locator('.gl-cat')).toHaveText('Mosques of the World');
  await expect(page.locator('.gl-p')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('works offline after the first visit: reload, photos and the athan', async ({ page, context }) => {
  test.setTimeout(60_000);
  await open(page, '2026-10-29T12:34:50');
  // The first visit installs the service worker and precaches everything;
  // it controls the page from the next load.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  const failed: string[] = [];
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.includes('open-meteo') && !u.includes('bigdatacloud')) failed.push(u);
  });
  await page.goto('/?now=2026-10-29T12:35:05');
  await expect(page.locator('.tk-athan')).toBeVisible();
  await expect(page.locator('.tk-bg img')).toHaveJSProperty('complete', true);
  const played = await page.evaluate(async () => {
    const r = await fetch('/audio/athan-1.mp3');
    return r.ok && (await r.blob()).size > 100_000;
  });
  expect(played).toBe(true);
  expect(failed).toEqual([]);
});

test('gallery shows calligraphy pieces with their meaning', async ({ page }) => {
  await page.route('**/gallery/index.json', (r) => r.fulfill({ json: [] }));
  const errors = await open(page, '2026-10-29T14:53:00', { dayTheme: 'gallery' });
  await expect(page.locator('.gl-cat')).toHaveText('Calligraphy');
  await expect(page.locator('.gl-art .callig-art')).toBeVisible();
  await expect(page.locator('.gl-sub')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('showcase: browse calligraphy full screen with keys', async ({ page }) => {
  const errors = await open(page, '2026-10-29T14:53:00');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.panel-nav').getByRole('button', { name: 'Preview' }).click();
  await page
    .locator('.pv-tabs')
    .getByRole('button', { name: /Calligraphy/ })
    .click();
  await page.locator('.pv-tile').first().click();
  await expect(page.locator('.viewer .gl-art .callig-art')).toBeVisible();
  await expect(page.locator('.viewer-count')).toHaveText(/^1 \/ \d+$/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-count')).toHaveText(/^2 \/ \d+$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function openSettings(page: Page, section: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.panel-nav').getByRole('button', { name: section }).click();
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('adhan-clock:settings')!));

test('backgrounds: choose any gallery photo for a prayer', async ({ page }) => {
  const errors = await open(page, '2026-10-29T06:30:00', { dayTheme: 'calligraphy' });
  await openSettings(page, 'Backgrounds');
  const fajr = page.locator('.bg-slot').first();
  await expect(fajr.locator('.bg-slot-count')).toHaveText('2 photos · suggested');
  await fajr.getByRole('button', { name: 'Choose photos' }).click();

  const picker = page.getByRole('dialog', { name: 'Fajr backgrounds' });
  await picker.getByRole('button', { name: 'Sheikh Lotfollah Mosque', exact: true }).click();
  await picker.getByRole('button', { name: 'Ortaköy Mosque', exact: true }).click();
  await picker.getByRole('button', { name: 'Lakeside Mosque', exact: true }).click();
  await expect(picker.getByText('Keep at least one photo')).toHaveCount(0);
  expect((await stored(page)).backgrounds.fajr).toEqual(['sheikh-lotfollah']);
  // The last photo stays: a part of the day always has one.
  await picker.getByRole('button', { name: 'Sheikh Lotfollah Mosque', exact: true }).click();
  await expect(picker.getByText('Keep at least one photo')).toBeVisible();

  // Preview it full screen as the calligraphy theme lays it out.
  await picker.getByRole('button', { name: 'Preview Sheikh Lotfollah Mosque' }).click();
  await expect(page.locator('.viewer .ct .ph-cover')).toHaveAttribute('src', '/gallery/sheikh-lotfollah.webp');
  await expect(page.locator('.viewer-use')).toHaveText('In the Fajr set');
  await page.keyboard.press('Escape');
  await picker.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  // The new photo crossfades in over the old one.
  await expect(page.locator('.ct .ct-photo .ph-cover').last()).toHaveAttribute('src', '/gallery/sheikh-lotfollah.webp');

  await openSettings(page, 'Backgrounds');
  await page.locator('.bg-slot').first().getByRole('button', { name: 'Choose photos' }).click();
  await picker.getByRole('button', { name: 'Use the suggested' }).click();
  expect((await stored(page)).backgrounds.fajr).toBeNull();
  expect(errors).toEqual([]);
});

test('gallery: upload a photo, make it a background, delete it', async ({ page }) => {
  const errors = await open(page, '2026-10-29T14:53:00');
  await openSettings(page, 'Preview');
  await page
    .locator('.pv-tabs')
    .getByRole('button', { name: /Gallery/ })
    .click();
  await page.locator('.up-tile input').setInputFiles('public/gallery/kul-sharif.webp');
  const tile = page.locator('.pv-group', { has: page.locator('.up-tile') }).locator('.pv-cell');
  await expect(tile).toBeVisible();

  await tile.locator('.pv-tile').click();
  await expect(page.locator('.viewer .gl-title')).toHaveText('kul sharif');
  await expect(page.locator('.viewer .gl-cat')).toHaveText('Your Photos');
  await page.locator('.viewer-slots').getByRole('button', { name: 'Isha' }).click();
  await expect(page.locator('.viewer-slots').getByRole('button', { name: 'Isha' })).toHaveAttribute('aria-pressed', 'true');
  const isha = (await stored(page)).backgrounds.isha as string[];
  expect(isha).toHaveLength(3);
  expect(isha[2]).toMatch(/^upload:/);
  await page.keyboard.press('Escape');
  await expect(tile.locator('.pv-note')).toHaveText('Isha');

  page.once('dialog', (d) => d.accept());
  await tile.getByRole('button', { name: 'Delete kul sharif' }).click();
  await expect(tile).toHaveCount(0);
  expect((await stored(page)).backgrounds.isha).toEqual(['suleymaniye', 'shah-alam']);
  expect(errors).toEqual([]);
});

test('moments: Ramadan before iftar lands on a real Ramadan date', async ({ page }) => {
  await open(page, '2026-10-29T14:53:00');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.panel-nav').getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: /Ramadan · before iftar/ }).click();
  await expect(page.locator('.cl-medal-name')).toHaveText('IFTAR');
  await expect(page.locator('.cl-date')).toContainText('RAMADAN');
  await expect(page.locator('.greeting-en')).toHaveText('Ramadan Kareem');
});
