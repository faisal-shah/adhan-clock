import { computed, effect, signal } from '@preact/signals';
import { now } from './core/clock';
import {
  loadBundledAudio,
  loadGallery,
  loadCalligraphyArt,
  type CalligraphyArt,
  type GalleryItem,
  loadBundledBackgrounds,
  listUploads,
  type Background,
  type BundledAudio,
  type BundledBackground,
  type Upload,
} from './core/media';
import { startOfDay } from './core/prayer';
import { clockState, computeDays, type AthanLength, type ClockState, type Days } from './core/schedule';
import { loadSettings, saveSettings, type BgSlot, type Settings } from './core/settings';
import { fetchWeather, type Weather } from './core/weather';

export const settings = signal<Settings>(loadSettings());
effect(() => saveSettings(settings.value));

export function updateSettings(patch: (s: Settings) => Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch(settings.value) };
}

/** Virtual time, advanced once per displayed second. */
export const tick = signal<Date>(now());
let lastSecond = Math.floor(tick.value.getTime() / 1000);
setInterval(() => {
  const n = now();
  const sec = Math.floor(n.getTime() / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec;
    tick.value = n;
  }
}, 200);

export const bundledBackgrounds = signal<BundledBackground[]>([]);
export const bundledAudio = signal<BundledAudio[]>([]);
export const gallery = signal<GalleryItem[]>([]);
export const calligraphyArt = signal<CalligraphyArt[]>([]);
export const uploads = signal<Upload[]>([]);
export const dismissed = signal<ReadonlySet<string>>(new Set());
export const settingsOpen = signal(false);
export const audioBlocked = signal(false);

export async function loadMedia(): Promise<void> {
  const [bgs, audio, ups, gal, art] = await Promise.allSettled([
    loadBundledBackgrounds(),
    loadBundledAudio(),
    listUploads(),
    loadGallery(),
    loadCalligraphyArt(),
  ]);
  if (art.status === 'fulfilled') calligraphyArt.value = art.value;
  if (gal.status === 'fulfilled') gallery.value = gal.value;
  if (bgs.status === 'fulfilled') bundledBackgrounds.value = bgs.value;
  if (audio.status === 'fulfilled') bundledAudio.value = audio.value;
  if (ups.status === 'fulfilled') uploads.value = ups.value;
}

export function dismiss(id: string): void {
  dismissed.value = new Set([...dismissed.value, id]);
}

// --- Derived clock state ----------------------------------------------------

let daysCache: { key: string; days: Days } | null = null;

const days = computed<Days | null>(() => {
  const s = settings.value;
  if (!s.place) return null;
  const key = JSON.stringify([startOfDay(tick.value).getTime(), s.place, s.method, s.madhab, s.highLatRule, s.adjust]);
  if (daysCache?.key !== key) daysCache = { key, days: computeDays(tick.value, s) };
  return daysCache.days;
});

const uploadUrls = new Map<string, string>();

export function uploadUrl(u: Upload): string {
  let url = uploadUrls.get(u.id);
  if (!url) {
    url = URL.createObjectURL(u.blob);
    uploadUrls.set(u.id, url);
  }
  return url;
}

export function forgetUploadUrl(id: string): void {
  const url = uploadUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  uploadUrls.delete(id);
}

/** Resolves an audio id (bundled or `upload:<id>`) to a playable URL and length. */
export function resolveAudio(audioId: string): { url: string; durationSec: number } | null {
  if (audioId.startsWith('upload:')) {
    const u = uploads.value.find((x) => x.id === audioId.slice(7));
    return u ? { url: uploadUrl(u), durationSec: u.durationSec ?? 0 } : null;
  }
  const b = bundledAudio.value.find((x) => x.id === audioId);
  return b ? { url: `/audio/${b.file}`, durationSec: b.durationSec } : null;
}

const athanLength = computed<AthanLength>(() => {
  const s = settings.value;
  // Touch the media signals so lengths update once indexes load.
  void bundledAudio.value;
  void uploads.value;
  return (p) => {
    const choice = p === 'tahajjud' ? s.tahajjud : s.sounds[p];
    if (!choice.enabled) return null;
    return resolveAudio(choice.audioId)?.durationSec ?? 0;
  };
});

export const clock = computed<ClockState | null>(() => {
  const d = days.value;
  if (!d) return null;
  return clockState(tick.value, d, settings.value, athanLength.value, dismissed.value);
});

const dayOfYear = (d: Date) => Math.floor((startOfDay(d).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000);

/** The background for a slot: the pinned choice, or a daily rotation over bundled + uploaded photos. */
export function backgroundFor(slot: BgSlot, day: Date): Background | null {
  const choice = settings.value.backgrounds[slot];
  const bundled = bundledBackgrounds.value
    .filter((b) => b.slot === slot)
    .map((b) => ({ id: b.id, url: `/backgrounds/${b.file}`, textTone: b.textTone }));
  const uploaded = uploads.value
    .filter((u) => u.kind === 'image' && u.slot === slot)
    .map((u) => ({ id: `upload:${u.id}`, url: uploadUrl(u), textTone: u.textTone ?? 'light' }));
  const pool = [...uploaded, ...bundled];
  if (choice !== 'auto') {
    const pinned = pool.find((b) => b.id === choice);
    if (pinned) return pinned;
  }
  return pool.length ? pool[dayOfYear(day) % pool.length] : null;
}

// --- Weather ----------------------------------------------------------------

const WEATHER_KEY = 'adhan-clock:weather';
const WEATHER_REFRESH = 15 * 60_000;

function cachedWeather(): Weather | null {
  try {
    const w = JSON.parse(localStorage.getItem(WEATHER_KEY) ?? 'null');
    return typeof w?.tempC === 'number' && Date.now() - w.fetchedAt < 3 * 3600_000 ? w : null;
  } catch {
    return null;
  }
}

export const weather = signal<Weather | null>(cachedWeather());

export function startWeather(): void {
  const refresh = (place: Settings['place']) => {
    if (!place) return;
    fetchWeather(place.latitude, place.longitude)
      .then((w) => {
        weather.value = w;
        localStorage.setItem(WEATHER_KEY, JSON.stringify(w));
      })
      .catch(() => {});
  };
  // Refetch whenever the place changes or weather is switched on; the cache
  // only stands in for the first load at the same place.
  let lastKey = '';
  effect(() => {
    const { place, weather: w } = settings.value;
    const key = w.enabled && place ? `${place.latitude},${place.longitude}` : '';
    if (key === lastKey) return;
    const first = lastKey === '';
    lastKey = key;
    if (key && !(first && weather.value)) refresh(place);
  });
  setInterval(() => settings.value.weather.enabled && refresh(settings.value.place), WEATHER_REFRESH);
}
