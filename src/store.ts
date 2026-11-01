import { computed, effect, signal } from '@preact/signals';
import { now } from './core/clock';
import { bundledPhoto, defaultIds, photoForDay, rotation } from './core/library';
import {
  deleteUpload,
  listUploads,
  loadBundledAudio,
  loadCalligraphyArt,
  loadGallery,
  newId,
  processImage,
  putUpload,
  type BundledAudio,
  type CalligraphyArt,
  type GalleryItem,
  type ImageUpload,
  type Photo,
  type Upload,
} from './core/media';
import { startOfDay } from './core/prayer';
import { clockState, computeDays, type AthanLength, type ClockState, type Days } from './core/schedule';
import {
  BG_SLOTS,
  DEFAULT_SETTINGS,
  PRAYERS,
  loadSettings,
  saveSettings,
  type BgSlot,
  type Settings,
  type SoundChoice,
  type ThemeKey,
} from './core/settings';
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

export const bundledAudio = signal<BundledAudio[]>([]);
export const gallery = signal<GalleryItem[]>([]);
export const calligraphyArt = signal<CalligraphyArt[]>([]);
export const uploads = signal<Upload[]>([]);
export const dismissed = signal<ReadonlySet<string>>(new Set());
export const settingsOpen = signal(false);
/** Forces a theme while a settings preview is running. */
export const previewTheme = signal<ThemeKey | null>(null);

/** Something the showcase can put full screen. */
export type ViewItem =
  | { kind: 'theme'; theme: ThemeKey; label: string }
  | { kind: 'background'; photo: Photo; slot: BgSlot }
  | { kind: 'photo'; photo: Photo }
  | { kind: 'art'; art: CalligraphyArt };

/** The showcase viewer: a list being browsed full screen, or null. */
export const viewer = signal<{ items: ViewItem[]; index: number } | null>(null);
/** The slot whose background picker is open, or null. */
export const picking = signal<BgSlot | null>(null);
export const audioBlocked = signal(false);

export async function loadMedia(): Promise<void> {
  const [audio, ups, gal, art] = await Promise.allSettled([
    loadBundledAudio(),
    listUploads(),
    loadGallery(),
    loadCalligraphyArt(),
  ]);
  if (art.status === 'fulfilled') calligraphyArt.value = art.value;
  if (gal.status === 'fulfilled') gallery.value = gal.value;
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
    return u?.kind === 'audio' ? { url: uploadUrl(u), durationSec: u.durationSec } : null;
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

// --- Photo library and backgrounds -------------------------------------------

const thumbUrls = new Map<string, string>();

function uploadPhoto(u: ImageUpload): Photo {
  let thumb = thumbUrls.get(u.id);
  if (!thumb) {
    thumb = URL.createObjectURL(u.thumb);
    thumbUrls.set(u.id, thumb);
  }
  return {
    id: `upload:${u.id}`,
    url: uploadUrl(u),
    thumb,
    category: 'uploads',
    title: u.name,
    subtitle: '',
    fit: u.fit,
    tones: u.tones,
  };
}

/** Every photo: bundled, then the user's uploads. */
export const photos = computed<Photo[]>(() => [
  ...gallery.value.map(bundledPhoto),
  ...uploads.value.flatMap((u) => (u.kind === 'image' ? [uploadPhoto(u)] : [])),
]);

const photoById = computed(() => new Map(photos.value.map((p) => [p.id, p])));

export const defaultBackgrounds = (slot: BgSlot): string[] => defaultIds(gallery.value, slot);

/** The photos a slot rotates through, in order. */
export function backgroundsFor(slot: BgSlot): Photo[] {
  return rotation(settings.value.backgrounds[slot], defaultBackgrounds(slot), photoById.value);
}

/** The slot's photo for the day. */
export function backgroundFor(slot: BgSlot, day: Date): Photo | null {
  return photoForDay(backgroundsFor(slot), day);
}

/** Adds a photo to a slot's rotation, or takes it out (a rotation keeps at least one photo). */
export function toggleBackground(slot: BgSlot, id: string): void {
  const ids = backgroundsFor(slot).map((p) => p.id);
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  if (!next.length) return;
  updateSettings((s) => ({ backgrounds: { ...s.backgrounds, [slot]: next } }));
}

export function resetBackgrounds(slot: BgSlot): void {
  updateSettings((s) => ({ backgrounds: { ...s.backgrounds, [slot]: null } }));
}

export async function addUpload<U extends Upload>(u: Omit<U, 'id'>): Promise<U> {
  const full = { ...u, id: newId() } as U;
  await putUpload(full);
  uploads.value = [...uploads.value, full];
  return full;
}

const photoName = (file: string) =>
  file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 48) || 'Photo';

/** Adds photos to the library; returns their ids. */
export async function uploadPhotos(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    const img = await processImage(file);
    const u = await addUpload<ImageUpload>({ kind: 'image', name: photoName(file.name), ...img });
    ids.push(`upload:${u.id}`);
  }
  return ids;
}

/** Deletes an upload and every reference to it. */
export async function removeUpload(id: string): Promise<void> {
  await deleteUpload(id);
  forgetUploadUrl(id);
  const thumb = thumbUrls.get(id);
  if (thumb) URL.revokeObjectURL(thumb);
  thumbUrls.delete(id);
  uploads.value = uploads.value.filter((u) => u.id !== id);
  const ref = `upload:${id}`;
  updateSettings((x) => {
    const sound = (c: SoundChoice, d: SoundChoice) => (c.audioId === ref ? { ...c, audioId: d.audioId } : c);
    const backgrounds = Object.fromEntries(
      BG_SLOTS.map((slot) => {
        const ids = x.backgrounds[slot]?.filter((i) => i !== ref) ?? null;
        return [slot, ids?.length ? ids : null];
      }),
    ) as Settings['backgrounds'];
    return {
      sounds: Object.fromEntries(PRAYERS.map((p) => [p, sound(x.sounds[p], DEFAULT_SETTINGS.sounds[p])])) as Settings['sounds'],
      tahajjud: sound(x.tahajjud, DEFAULT_SETTINGS.tahajjud),
      backgrounds,
    };
  });
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
