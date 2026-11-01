import layout from './photo-layout.json';
import type { BgSlot, GalleryCategory } from './settings';

export interface Credit {
  title: string;
  author: string;
  sourceUrl: string;
  license: string;
  licenseUrl?: string;
}

export interface BundledAudio {
  id: string;
  kind: 'athan' | 'fajr' | 'chime';
  file: string;
  label: string;
  durationSec: number;
  credit: Credit;
}

export type Tone = 'light' | 'dark';
/** The themes that lay text over photos; `photo-layout.json` describes each. */
export type PhotoLayout = keyof typeof layout.layouts;
export type Tones = Record<PhotoLayout, Tone>;

/** A bundled photo from public/gallery/index.json (built by scripts/gallery/process.py). */
export interface GalleryItem {
  id: string;
  file: string;
  fileSm: string;
  category: GalleryCategory;
  title: string;
  subtitle: string;
  /** `cover` scenes fill the screen; `contain` objects are shown whole over a blurred copy. */
  fit: 'cover' | 'contain';
  /** CSS object-position for cover photos. */
  focus?: string;
  /** Overlay text tone per theme layout. */
  tones: Tones;
  /** Parts of the day this photo is a default background for. */
  slots?: BgSlot[];
  credit: Credit;
}

/** Any photo the app can show: a bundled one or an upload. */
export interface Photo {
  /** Bundled id, or `upload:<id>`. */
  id: string;
  url: string;
  thumb: string;
  category: GalleryCategory;
  title: string;
  subtitle: string;
  fit: 'cover' | 'contain';
  focus?: string;
  tones: Tones;
  /** Small print under the calligraphy theme. */
  caption?: string;
}

/** Vectorized calligraphy artwork, used as a CSS mask. */
export interface CalligraphyArt {
  id: string;
  file: string;
  /** width / height of the artwork's viewBox */
  aspect: number;
  kind?: 'prayer' | 'phrase' | 'gallery';
  arabic?: string;
  /** Gallery pieces only */
  english?: string;
  ref?: string;
  transliteration?: string;
}

/** A user upload, kept in IndexedDB. */
export type Upload = ImageUpload | AudioUpload;

export interface ImageUpload {
  id: string;
  kind: 'image';
  name: string;
  fit: 'cover' | 'contain';
  tones: Tones;
  blob: Blob;
  thumb: Blob;
}

export interface AudioUpload {
  id: string;
  kind: 'audio';
  name: string;
  durationSec: number;
  blob: Blob;
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const loadBundledAudio = () => fetchJson<BundledAudio[]>('/audio/index.json');
export const loadGallery = () => fetchJson<GalleryItem[]>('/gallery/index.json');
export const loadCalligraphyArt = () => fetchJson<CalligraphyArt[]>('/calligraphy/index.json');

// --- IndexedDB upload store -------------------------------------------------

const DB_NAME = 'adhan-clock';
const STORE = 'uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** IndexedDB is outside input: keep well-formed records, fill fields older versions did not store. */
function parseUpload(raw: unknown): Upload | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || !(r.blob instanceof Blob)) return null;
  if (r.kind === 'audio') {
    return {
      id: r.id,
      kind: 'audio',
      name: r.name,
      durationSec: typeof r.durationSec === 'number' ? r.durationSec : 0,
      blob: r.blob,
    };
  }
  if (r.kind !== 'image') return null;
  const tone = (v: unknown): Tone => (v === 'dark' ? 'dark' : 'light');
  const t = (r.tones ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    kind: 'image',
    name: r.name,
    fit: r.fit === 'contain' ? 'contain' : 'cover',
    tones: { gallery: tone(t.gallery), calligraphy: tone(t.calligraphy ?? r.textTone) },
    blob: r.blob,
    thumb: r.thumb instanceof Blob ? r.thumb : r.blob,
  };
}

export const listUploads = () =>
  tx<unknown[]>('readonly', (s) => s.getAll()).then((all) => all.map(parseUpload).filter((u): u is Upload => u !== null));
export const putUpload = (u: Upload) => tx('readwrite', (s) => s.put(u));
export const deleteUpload = (id: string) => tx('readwrite', (s) => s.delete(id));

// --- Upload processing ------------------------------------------------------

const MAX_LONG_SIDE = 2400;
const THUMB_LONG_SIDE = 640;
/** Squarer than this, a photo is shown whole (contain) rather than cropped to fill the screen. */
const MIN_COVER_ASPECT = 1.3;
const TONE_WIDTH = 480;

const LIN = Array.from({ length: 256 }, (_, v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));

function scaled(src: CanvasImageSource, w: number, h: number, long: number): OffscreenCanvas {
  const k = Math.min(1, long / Math.max(w, h));
  const c = new OffscreenCanvas(Math.round(w * k), Math.round(h * k));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/**
 * The overlay text tone for one theme layout, measured as scripts/gallery/process.py
 * does: mean WCAG luminance (in linear light) of the layout's text regions on
 * the frame the theme shows.
 */
function measureTone(img: OffscreenCanvas, fit: 'cover' | 'contain', name: PhotoLayout): Tone {
  const [aw, ah] = layout.referenceAspect;
  const w = TONE_WIDTH;
  const h = Math.round((w * ah) / aw);
  const frame = new OffscreenCanvas(w, h);
  const ctx = frame.getContext('2d', { willReadFrequently: true })!;
  const cover = (k: number) => {
    const s = Math.max(w / img.width, h / img.height) * k;
    ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
  };
  const L = layout.layouts[name];
  if (fit === 'cover') cover(1);
  else {
    const c = L.contain;
    ctx.filter = `blur(${c.backdropBlur * w}px) brightness(${c.backdropBrightness})`;
    cover(1);
    ctx.filter = 'none';
    const b = c.objectBox;
    const bw = (b.x1 - b.x0) * w;
    const bh = (b.y1 - b.y0) * h;
    const s = Math.min(1, bw / img.width, bh / img.height);
    ctx.drawImage(img, b.x0 * w + (bw - img.width * s) / 2, b.y0 * h + (bh - img.height * s) / 2, img.width * s, img.height * s);
  }
  const lums = Object.values(L.toneRegions).map((r) => {
    const d = ctx.getImageData(r.x0 * w, r.y0 * h, (r.x1 - r.x0) * w, (r.y1 - r.y0) * h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * LIN[d[i]] + 0.7152 * LIN[d[i + 1]] + 0.0722 * LIN[d[i + 2]];
    return sum / (d.length / 4);
  });
  return lums.reduce((a, b) => a + b, 0) / lums.length >= layout.darkTextMinLuminance ? 'dark' : 'light';
}

/** Downscales an uploaded photo (WebP), makes its thumbnail and measures its overlay tones. */
export async function processImage(file: File): Promise<Pick<ImageUpload, 'blob' | 'thumb' | 'fit' | 'tones'>> {
  const bmp = await createImageBitmap(file);
  const full = scaled(bmp, bmp.width, bmp.height, MAX_LONG_SIDE);
  bmp.close();
  const fit = full.width / full.height >= MIN_COVER_ASPECT ? 'cover' : 'contain';
  const small = scaled(full, full.width, full.height, THUMB_LONG_SIDE);
  return {
    blob: await full.convertToBlob({ type: 'image/webp', quality: 0.85 }),
    thumb: await small.convertToBlob({ type: 'image/webp', quality: 0.75 }),
    fit,
    tones: { gallery: measureTone(small, fit, 'gallery'), calligraphy: measureTone(small, fit, 'calligraphy') },
  };
}

export function audioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(a.duration);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a playable audio file'));
    };
    a.src = url;
  });
}

export const newId = () => crypto.randomUUID().slice(0, 8);
