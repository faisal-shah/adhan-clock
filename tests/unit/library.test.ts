import { describe, expect, it } from 'vitest';
import { bundledPhoto, defaultIds, photoForDay, rotation, upcoming } from '../../src/core/library';
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
const sorted = (ps: Photo[]) => ids(ps).sort();

describe('background rotation', () => {
  it('uses the defaults until the user chooses', () => {
    expect(sorted(rotation(null, ['a', 'b'], byId))).toEqual(['a', 'b']);
    expect(sorted(rotation(['c', 'upload:x'], ['a', 'b'], byId))).toEqual(['c', 'upload:x']);
  });

  it('takes every photo in the library for all', () => {
    expect(sorted(rotation('all', ['a'], byId))).toEqual(['a', 'b', 'c', 'upload:x']);
  });

  it('drops photos that no longer exist, falling back to the defaults when none remain', () => {
    expect(ids(rotation(['upload:gone', 'c'], ['a'], byId))).toEqual(['c']);
    expect(ids(rotation(['upload:gone'], ['a'], byId))).toEqual(['a']);
  });

  it('keeps each photo in its place, whatever order it was chosen in', () => {
    const abc = ids(rotation(['a', 'b', 'c'], [], byId));
    expect(ids(rotation(['c', 'b', 'a'], [], byId))).toEqual(abc);
    expect(ids(rotation(['c', 'upload:x', 'b', 'a'], [], byId)).filter((id) => id !== 'upload:x')).toEqual(abc);
  });

  it('shows one photo all day and walks the rotation day by day, across DST', () => {
    const pool = ['a', 'b', 'c'].map(photo);
    const morning = photoForDay(pool, new Date(2026, 10, 1, 0, 30), 'fajr')!.id;
    expect(photoForDay(pool, new Date(2026, 10, 1, 23, 30), 'fajr')!.id).toBe(morning);
    // 2026-11-01 is the US fall-back day; the walk continues without a skip.
    const week = Array.from({ length: 6 }, (_, i) => photoForDay(pool, new Date(2026, 9, 30 + i, 12), 'fajr')!.id);
    expect(new Set(week.slice(0, 3)).size).toBe(3);
    expect(week.slice(3)).toEqual(week.slice(0, 3));
    expect(photoForDay([], new Date(), 'fajr')).toBeNull();
  });

  it('shows a different photo in each part of the day when they share the library', () => {
    const pool = rotation('all', [], new Map(index.map((g) => [g.id, bundledPhoto(g)])));
    for (let d = 0; d < 60; d++) {
      const day = new Date(2026, 10, 1 + d, 12);
      expect(new Set(BG_SLOTS.map((slot) => photoForDay(pool, day, slot)!.id)).size).toBe(BG_SLOTS.length);
    }
  });

  it('lists the rotation from the day on: today, then each day after', () => {
    const pool = ['a', 'b', 'c'].map(photo);
    const next = ids(upcoming(pool, new Date(2026, 10, 1, 12), 'isha'));
    expect(next).toHaveLength(3);
    next.forEach((id, i) => expect(photoForDay(pool, new Date(2026, 10, 1 + i, 12), 'isha')!.id).toBe(id));
    expect(upcoming([], new Date(), 'isha')).toEqual([]);
  });
});

describe('background settings', () => {
  it('keeps all or distinct photo ids and treats anything else as the defaults', () => {
    const s = sanitizeSettings({
      backgrounds: { fajr: ['a', 'a', 'upload:x'], sunrise: 'all', dhuhr: 'auto', asr: [], isha: [1, 2], night: 'x' },
    });
    expect(s.backgrounds.fajr).toEqual(['a', 'upload:x']);
    expect(s.backgrounds.sunrise).toBe('all');
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
