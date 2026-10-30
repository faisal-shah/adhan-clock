// Renders clock scenarios to PNGs for visual review.
// usage: node tests/visual/shoot.mjs <outDir> <name>=<query>[;<settingsJSON>] ...
//   e.g. node tests/visual/shoot.mjs /tmp/shots 'dhuhr=now=2026-10-29T12:50:00'
import { chromium } from '@playwright/test';

const [outDir, ...specs] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const width = Number(process.env.W ?? 1280);
const height = Number(process.env.H ?? 800);
const CHICAGO = { name: 'Chicago, Illinois, United States', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago' };

const browser = await chromium.launch();
for (const spec of specs) {
  const [name, rest] = spec.split(/=(.*)/s);
  const [query, json] = rest.split(';');
  const settings = { place: CHICAGO, ...(json ? JSON.parse(json) : {}) };
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Chicago', deviceScaleFactor: Number(process.env.DPR ?? 1) });
  await ctx.addInitScript((s) => localStorage.setItem('adhan-clock:settings', JSON.stringify(s)), settings);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}?${query}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(Number(process.env.WAIT ?? 4000));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name}: ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok'}`);
  await ctx.close();
}
await browser.close();
