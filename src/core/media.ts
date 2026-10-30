import type { BgSlot, GalleryCategory } from './settings';

export interface Credit {
  title: string;
  author: string;
  sourceUrl: string;
  license: string;
  licenseUrl?: string;
}

export interface BundledBackground {
  id: string;
  slot: BgSlot;
  file: string;
  fileSm: string;
  textTone: 'light' | 'dark';
  accent: string;
  /** The place shown, when it is a named one. */
  caption?: string;
  credit: Credit;
}

export interface BundledAudio {
  id: string;
  kind: 'athan' | 'fajr' | 'chime';
  file: string;
  label: string;
  durationSec: number;
  credit: Credit;
}

export interface GalleryItem {
  id: string;
  file: string;
  category: GalleryCategory;
  title: string;
  subtitle: string;
  fit: 'cover' | 'contain';
  textTone: 'light' | 'dark';
  focus?: string;
  credit: Credit;
}

/** Vectorized calligraphy artwork, used as a CSS mask. */
export interface CalligraphyArt {
  id: string;
  file: string;
  /** width / height of the artwork's viewBox */
  aspect: number;
}

/** A user upload. The blob lives in IndexedDB; this metadata mirrors it in memory. */
export interface Upload {
  id: string;
  kind: 'image' | 'audio';
  name: string;
  slot?: BgSlot;
  textTone?: 'light' | 'dark';
  durationSec?: number;
  blob: Blob;
}

export interface Background {
  id: string;
  url: string;
  textTone: 'light' | 'dark';
  caption?: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const loadBundledBackgrounds = () => fetchJson<BundledBackground[]>('/backgrounds/index.json');
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

export const listUploads = () => tx<Upload[]>('readonly', (s) => s.getAll() as IDBRequest<Upload[]>);
export const putUpload = (u: Upload) => tx('readwrite', (s) => s.put(u));
export const deleteUpload = (id: string) => tx('readwrite', (s) => s.delete(id));

// --- Upload processing ------------------------------------------------------

const MAX_IMAGE_WIDTH = 2560;

/**
 * Downscales an uploaded photo to at most 2560px wide (WebP) and measures the
 * brightness of the right-hand text area to pick light or dark overlay text.
 */
export async function processImage(file: File): Promise<{ blob: Blob; textTone: 'light' | 'dark' }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_WIDTH / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const x0 = Math.round(w * 0.55);
  const region = ctx.getImageData(x0, 0, w - x0, Math.round(h * 0.6)).data;
  let sum = 0;
  for (let i = 0; i < region.length; i += 16) {
    sum += 0.2126 * region[i] + 0.7152 * region[i + 1] + 0.0722 * region[i + 2];
  }
  const mean = sum / (region.length / 16) / 255;
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  return { blob, textTone: mean > 0.55 ? 'dark' : 'light' };
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
