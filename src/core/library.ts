import type { GalleryItem, Photo } from './media';
import { startOfDay } from './prayer';
import type { BgSlot } from './settings';

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

/**
 * A slot's rotation: the chosen photos that still exist (an upload may have
 * been deleted), or the defaults when there are none.
 */
export function rotation(chosen: string[] | null, defaults: string[], byId: ReadonlyMap<string, Photo>): Photo[] {
  const pick = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  const pool = chosen ? pick(chosen) : [];
  return pool.length ? pool : pick(defaults);
}

/** Days since 1970-01-01 on the local calendar. */
function dayNumber(d: Date): number {
  const m = startOfDay(d);
  return Math.round(m.getTime() / 86_400_000 - m.getTimezoneOffset() / 1440);
}

/** One photo a day, walking the rotation in order. */
export function photoForDay(pool: Photo[], day: Date): Photo | null {
  return pool.length ? pool[dayNumber(day) % pool.length] : null;
}
