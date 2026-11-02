export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerKey = (typeof PRAYERS)[number];

export const DAY_THEMES = ['calligraphy', 'classic', 'kids', 'gallery'] as const;
export type DayTheme = (typeof DAY_THEMES)[number];
export type ThemeKey = DayTheme | 'night';

export const CALC_METHODS = {
  NorthAmerica: 'ISNA (North America)',
  MuslimWorldLeague: 'Muslim World League',
  Egyptian: 'Egyptian General Authority',
  Karachi: 'University of Islamic Sciences, Karachi',
  UmmAlQura: 'Umm al-Qura, Makkah',
  Dubai: 'Dubai',
  Qatar: 'Qatar',
  Kuwait: 'Kuwait',
  MoonsightingCommittee: 'Moonsighting Committee',
  Singapore: 'Singapore',
  Turkey: 'Diyanet, Turkey',
  Tehran: 'Tehran',
} as const;
export type CalcMethod = keyof typeof CALC_METHODS;

export const HIGH_LAT_RULES = {
  recommended: 'Automatic',
  middleofthenight: 'Middle of the night',
  seventhofthenight: 'Seventh of the night',
  twilightangle: 'Twilight angle',
} as const;
export type HighLatRule = keyof typeof HIGH_LAT_RULES;

export const CALLIGRAPHY_FONTS = {
  art: 'Thuluth art',
  ruqaa: 'Ruqaa',
  nastaliq: 'Nastaliq',
  kufi: 'Kufi',
} as const;
export type CalligraphyFont = keyof typeof CALLIGRAPHY_FONTS;

export const GALLERY_CATEGORIES = {
  mosques: 'Mosques of the World',
  learning: 'Seekers of Knowledge',
  treasures: 'Treasures of Islamic Civilization',
  landscapes: 'Lands of Islam',
  calligraphy: 'Calligraphy',
  uploads: 'Your Photos',
} as const;
export type GalleryCategory = keyof typeof GALLERY_CATEGORIES;

/** Background slots: each prayer period maps to one (see schedule.ts). */
export const BG_SLOTS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha', 'night'] as const;
export type BgSlot = (typeof BG_SLOTS)[number];

export const BG_SLOT_NAMES: Record<BgSlot, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise & Duha',
  dhuhr: "Dhuhr & Jumu'ah",
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  night: 'Night & Tahajjud',
};

/**
 * A slot's photos: chosen ids (bundled, or `upload:<id>`), 'all' for every
 * photo in the library including ones added later, or null for the
 * library's suggestions. With no ids chosen the suggestions show.
 */
export type PhotoChoice = string[] | 'all' | null;

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

export interface SoundChoice {
  enabled: boolean;
  /** Bundled audio id from public/audio/index.json, or `upload:<id>`. */
  audioId: string;
  /** 0..1 */
  volume: number;
}

export interface Settings {
  place: Place | null;
  method: CalcMethod;
  madhab: 'hanafi' | 'shafi';
  highLatRule: HighLatRule;
  /** Minutes added to each calculated athan time. */
  adjust: Record<PrayerKey, number>;
  /** Iqamah = athan + offset minutes. */
  iqamah: Record<PrayerKey, number>;
  jumuah: { enabled: boolean; times: string[] };
  dayTheme: DayTheme;
  /** The calligraphy theme takes over for this many minutes after each athan. */
  calligraphyMinutes: number;
  calligraphyFont: CalligraphyFont;
  night: {
    enabled: boolean;
    startAfterIsha: number;
    endBeforeFajr: number;
    /** Backlight levels (0..100), applied only under Fully Kiosk Browser. */
    brightness: number;
    dayBrightness: number;
  };
  sequence: { preCountdown: boolean; dua: boolean; iqamahCountdown: boolean };
  sounds: Record<PrayerKey, SoundChoice>;
  tahajjud: SoundChoice;
  chime: { enabled: boolean; volume: number };
  /** Per slot, the photos the calligraphy theme rotates through, one a day. */
  backgrounds: Record<BgSlot, PhotoChoice>;
  clock24h: boolean;
  hijriOffset: number;
  weather: { enabled: boolean; unit: 'f' | 'c' };
  ramadan: 'auto' | 'on' | 'off';
  showDaily: boolean;
  makruhBadge: boolean;
  gallery: { minutes: number; categories: Record<GalleryCategory, boolean> };
  title: string;
  /** 'calm' stops decorative motion for slower tablets. */
  motion: 'full' | 'calm';
}

const perPrayer = <T>(f: (p: PrayerKey) => T) => Object.fromEntries(PRAYERS.map((p) => [p, f(p)])) as Record<PrayerKey, T>;

export const DEFAULT_SETTINGS: Settings = {
  place: null,
  method: 'NorthAmerica',
  madhab: 'hanafi',
  highLatRule: 'recommended',
  adjust: perPrayer(() => 0),
  iqamah: { fajr: 20, dhuhr: 15, asr: 15, maghrib: 5, isha: 15 },
  jumuah: { enabled: true, times: ['13:30'] },
  dayTheme: 'classic',
  calligraphyMinutes: 45,
  calligraphyFont: 'art',
  night: { enabled: true, startAfterIsha: 60, endBeforeFajr: 0, brightness: 8, dayBrightness: 70 },
  sequence: { preCountdown: true, dua: true, iqamahCountdown: true },
  sounds: perPrayer((p) => ({ enabled: true, audioId: p === 'fajr' ? 'fajr-1' : 'athan-1', volume: p === 'fajr' ? 0.6 : 0.8 })),
  tahajjud: { enabled: false, audioId: 'athan-1', volume: 0.3 },
  chime: { enabled: true, volume: 0.5 },
  backgrounds: Object.fromEntries(BG_SLOTS.map((s) => [s, null])) as Record<BgSlot, PhotoChoice>,
  clock24h: false,
  hijriOffset: 0,
  weather: { enabled: true, unit: 'f' },
  ramadan: 'auto',
  showDaily: true,
  makruhBadge: true,
  gallery: {
    minutes: 5,
    categories: { mosques: true, learning: true, treasures: true, landscapes: true, calligraphy: true, uploads: true },
  },
  title: 'Home',
  motion: 'full',
};

const ENUMS: Record<string, readonly string[]> = {
  method: Object.keys(CALC_METHODS),
  madhab: ['hanafi', 'shafi'],
  highLatRule: Object.keys(HIGH_LAT_RULES),
  dayTheme: DAY_THEMES,
  calligraphyFont: Object.keys(CALLIGRAPHY_FONTS),
  unit: ['f', 'c'],
  ramadan: ['auto', 'on', 'off'],
  motion: ['full', 'calm'],
};

/**
 * The allowed range of each number setting, by path (`*` stands for any
 * prayer); the settings controls use the same bounds.
 */
export const RANGES = {
  'adjust.*': [-30, 30],
  'iqamah.*': [0, 90],
  calligraphyMinutes: [0, 120],
  hijriOffset: [-2, 2],
  'gallery.minutes': [1, 60],
  'night.startAfterIsha': [0, 240],
  'night.endBeforeFajr': [0, 120],
  'night.brightness': [0, 100],
  'night.dayBrightness': [0, 100],
  'sounds.*.volume': [0, 1],
  'tahajjud.volume': [0, 1],
  'chime.volume': [0, 1],
} as const satisfies Record<string, readonly [number, number]>;

/** Bounds for a Stepper. */
export const limits = (path: keyof typeof RANGES) => ({ min: RANGES[path][0], max: RANGES[path][1] });

function rangeOf(path: string): readonly [number, number] | undefined {
  const parts = path.split('.');
  const wild = [parts[0], '*', ...parts.slice(2)].join('.');
  const ranges: Record<string, readonly [number, number]> = RANGES;
  return ranges[path] ?? ranges[wild];
}

/** "HH:MM", 24-hour. */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Overlays `raw` onto `defaults`, keeping only values whose type matches the
 * default (and whose value is allowed, for enums and ranges). localStorage is
 * external input: a stale or hand-edited blob must never crash the clock.
 */
function overlay<T>(defaults: T, raw: unknown, path = ''): T {
  if (raw === undefined) return defaults;
  if (Array.isArray(defaults)) {
    return (Array.isArray(raw) && raw.every((v) => typeof v === typeof defaults[0]) ? raw : defaults) as T;
  }
  if (defaults !== null && typeof defaults === 'object') {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(defaults))
      out[k] = overlay(v, (raw as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    return out as T;
  }
  if (typeof raw !== typeof defaults) return defaults;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return defaults;
    const range = rangeOf(path);
    return (range ? Math.min(range[1], Math.max(range[0], raw)) : raw) as T;
  }
  const key = path.slice(path.lastIndexOf('.') + 1);
  if (ENUMS[key] && !ENUMS[key].includes(raw as string)) return defaults;
  return raw as T;
}

function parsePlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const lat = p.latitude,
    lon = p.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    name: typeof p.name === 'string' ? p.name : `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    latitude: lat,
    longitude: lon,
    timezone: typeof p.timezone === 'string' ? p.timezone : null,
  };
}

/** A slot's photos: 'all', distinct ids, or null (the defaults) for anything else. */
function parsePhotoChoice(raw: unknown): PhotoChoice {
  if (raw === 'all') return 'all';
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 80)) return null;
  return [...new Set(raw as string[])].slice(0, 500);
}

export function sanitizeSettings(raw: unknown): Settings {
  const s = overlay(DEFAULT_SETTINGS, raw);
  const r = raw as Record<string, unknown> | null;
  s.place = parsePlace(r?.place);
  const bgs = (r?.backgrounds ?? {}) as Record<string, unknown>;
  s.backgrounds = Object.fromEntries(BG_SLOTS.map((slot) => [slot, parsePhotoChoice(bgs[slot])])) as Settings['backgrounds'];
  s.jumuah.times = s.jumuah.times.filter((t) => HHMM.test(t)).slice(0, 2);
  if (!s.jumuah.times.length) s.jumuah.times = DEFAULT_SETTINGS.jumuah.times;
  return s;
}

const STORAGE_KEY = 'adhan-clock:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return sanitizeSettings(undefined);
  }
}

/** Saves settings; when the browser refuses (storage blocked or full) the clock runs on without saving. */
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Nothing to do: the settings stay in memory for this session.
  }
}
