import type { GalleryItem, Photo } from './media';
import { startOfDay } from './prayer';
import { BG_SLOTS, type BgSlot, type PhotoChoice } from './settings';

export function bundledPhoto(g: GalleryItem): Photo {
  return {
    id: g.id,
    url: `/gallery/${g.file}`,
    thumb: `/gallery/${g.fileSm}`,
    category: g.category,
    title: g.title,
    subtitle: g.subtitle,
    fit: g.fit,
    focus: g.focus,
    tones: g.tones,
    caption: `${g.title} · ${g.subtitle}`,
  };
}

/** The bundled photos that are a slot's background until the user chooses. */
export const defaultIds = (items: GalleryItem[], slot: BgSlot): string[] =>
  items.filter((g) => g.slots?.includes(slot)).map((g) => g.id);

/** FNV-1a of a photo id: its fixed place in every rotation. */
function mix(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A slot's rotation: every photo, the chosen photos that still exist (an
 * upload may have been deleted), or the defaults when there are none. The
 * order mixes the library's categories and keeps each photo's place as
 * others come and go.
 */
export function rotation(choice: PhotoChoice, defaults: string[], byId: ReadonlyMap<string, Photo>): Photo[] {
  const pick = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  const pool = choice === 'all' ? [...byId.values()] : choice ? pick(choice) : [];
  return (pool.length ? pool : pick(defaults)).toSorted((a, b) => mix(a.id) - mix(b.id));
}

/** Days since 1970-01-01 on the local calendar. */
function dayNumber(d: Date): number {
  const m = startOfDay(d);
  return Math.round(m.getTime() / 86_400_000 - m.getTimezoneOffset() / 1440);
}

/**
 * Where the day falls in a rotation of n photos. Slots start a fixed stride
 * apart, so parts of the day that share photos show different ones each day.
 */
function dayIndex(n: number, day: Date, slot: BgSlot): number {
  const stride = Math.max(1, Math.floor(n / BG_SLOTS.length));
  return (dayNumber(day) + BG_SLOTS.indexOf(slot) * stride) % n;
}

/** One photo a day, walking the rotation in order. */
export function photoForDay(pool: Photo[], day: Date, slot: BgSlot): Photo | null {
  return pool.length ? pool[dayIndex(pool.length, day, slot)] : null;
}

/** The rotation in the order it will show, starting with the day's photo. */
export function upcoming(pool: Photo[], day: Date, slot: BgSlot): Photo[] {
  if (!pool.length) return [];
  const i = dayIndex(pool.length, day, slot);
  return [...pool.slice(i), ...pool.slice(0, i)];
}
