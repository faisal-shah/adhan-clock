import { describe, expect, it } from 'vitest';
import { bundledPhoto, defaultIds, photoForDay, rotation } from '../../src/core/library';
import type { GalleryItem, Photo } from '../../src/core/media';
import { BG_SLOTS, GALLERY_CATEGORIES, sanitizeSettings } from '../../src/core/settings';
import indexJson from '../../public/gallery/index.json';

const index = indexJson as GalleryItem[];
const files = new Set(Object.keys(import.meta.glob('../../public/gallery/*.webp')).map((f) => f.split('/').pop()));

const photo = (id: string): Photo => ({
  id,
  url: `/${id}.webp`,
  thumb: `/${id}-sm.webp`,
  category: 'mosques',
  title: id,
  subtitle: '',
  fit: 'cover',
  tones: { gallery: 'light', calligraphy: 'light' },
});
const byId = new Map(['a', 'b', 'c', 'upload:x'].map((id) => [id, photo(id)]));
const ids = (ps: Photo[]) => ps.map((p) => p.id);

describe('background rotation', () => {
  it('uses the defaults until the user chooses', () => {
    expect(ids(rotation(null, ['a', 'b'], byId))).toEqual(['a', 'b']);
    expect(ids(rotation(['c', 'upload:x'], ['a', 'b'], byId))).toEqual(['c', 'upload:x']);
  });

  it('drops photos that no longer exist, falling back to the defaults when none remain', () => {
    expect(ids(rotation(['upload:gone', 'c'], ['a'], byId))).toEqual(['c']);
    expect(ids(rotation(['upload:gone'], ['a'], byId))).toEqual(['a']);
  });

  it('shows one photo all day and walks the rotation day by day, across DST', () => {
    const pool = ['a', 'b', 'c'].map(photo);
    const morning = photoForDay(pool, new Date(2026, 10, 1, 0, 30))!.id;
    expect(photoForDay(pool, new Date(2026, 10, 1, 23, 30))!.id).toBe(morning);
    // 2026-11-01 is the US fall-back day; the walk continues without a skip.
    const week = Array.from({ length: 6 }, (_, i) => photoForDay(pool, new Date(2026, 9, 30 + i, 12))!.id);
    expect(new Set(week.slice(0, 3)).size).toBe(3);
    expect(week.slice(3)).toEqual(week.slice(0, 3));
    expect(photoForDay([], new Date())).toBeNull();
  });
});

describe('background settings', () => {
  it('keeps distinct photo ids and treats anything else as the defaults', () => {
    const s = sanitizeSettings({
      backgrounds: { fajr: ['a', 'a', 'upload:x'], dhuhr: 'auto', asr: [], isha: [1, 2], night: 'x' },
    });
    expect(s.backgrounds.fajr).toEqual(['a', 'upload:x']);
    expect(s.backgrounds.dhuhr).toBeNull();
    expect(s.backgrounds.asr).toBeNull();
    expect(s.backgrounds.isha).toBeNull();
    expect(s.backgrounds.night).toBeNull();
    expect(sanitizeSettings('junk').backgrounds.maghrib).toBeNull();
  });

  it('shows uploads in the Gallery theme by default', () => {
    expect(sanitizeSettings(undefined).gallery.categories.uploads).toBe(true);
  });
});

describe('bundled photo library', () => {
  it('suggests photos for every part of the day', () => {
    for (const slot of BG_SLOTS) expect(defaultIds(index, slot).length, slot).toBeGreaterThan(0);
  });

  it('lists files that exist, a thumbnail and a tone for both layouts', () => {
    for (const g of index) {
      expect(files.has(g.file), g.file).toBe(true);
      expect(files.has(g.fileSm), g.fileSm).toBe(true);
      expect(Object.keys(g.tones).sort()).toEqual(['calligraphy', 'gallery']);
      expect(g.category in GALLERY_CATEGORIES && g.category !== 'uploads' && g.category !== 'calligraphy').toBe(true);
    }
    expect(new Set(index.map((g) => g.id)).size).toBe(index.length);
  });

  it('captions bundled photos for the calligraphy theme', () => {
    const p = bundledPhoto(index.find((g) => g.id === 'kul-sharif')!);
    expect(p.caption).toBe('Kul Sharif Mosque · Kazan Kremlin, Russia · completed 2005');
    expect(p.thumb).toBe('/gallery/kul-sharif-sm.webp');
  });
});
