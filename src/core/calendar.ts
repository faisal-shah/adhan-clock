export const HIJRI_MONTHS = [
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qa'dah",
  'Dhu al-Hijjah',
] as const;

export interface HijriDate {
  day: number;
  /** 1-based */
  month: number;
  year: number;
  monthName: string;
}

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

/** Umm al-Qura date for `d`, shifted by `offsetDays` to follow local moonsighting. */
export function hijriDate(d: Date, offsetDays: number): HijriDate {
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, 12);
  const parts = Object.fromEntries(hijriFmt.formatToParts(shifted).map((p) => [p.type, p.value]));
  const month = Number(parts.month);
  return { day: Number(parts.day), month, year: Number(parts.year), monthName: HIJRI_MONTHS[month - 1] };
}

/** The next date on or after `from` whose Hijri date is `month`/`day` (within ~13 months). */
export function nextHijriDate(from: Date, month: number, day: number, offsetDays: number): Date | null {
  for (let i = 0; i < 400; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const h = hijriDate(d, offsetDays);
    if (h.month === month && h.day === day) return d;
  }
  return null;
}

export interface ClockFace {
  hm: string;
  /** 'AM' / 'PM', or '' in 24-hour mode. */
  ampm: string;
}

export function clockFace(d: Date, h24: boolean): ClockFace {
  const m = String(d.getMinutes()).padStart(2, '0');
  if (h24) return { hm: `${String(d.getHours()).padStart(2, '0')}:${m}`, ampm: '' };
  const h = d.getHours() % 12 || 12;
  return { hm: `${h}:${m}`, ampm: d.getHours() < 12 ? 'AM' : 'PM' };
}

const gregFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: '2-digit' });

/** "MON, SEP 09" */
export function gregorianLine(d: Date): string {
  return gregFmt.format(d).toUpperCase();
}

export function hijriLine(h: HijriDate): string {
  return `${h.day} ${h.monthName.toUpperCase()}`;
}

export interface CountdownFace {
  value: string;
  unit: 'HRS' | 'MIN';
}

/**
 * Hours and minutes while an hour or more remains ("4:30" HRS), minutes and
 * seconds inside the last hour ("08:12" MIN).
 */
export function countdownFace(ms: number): CountdownFace {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return { value: `${h}:${String(m).padStart(2, '0')}`, unit: 'HRS' };
  return { value: `${m}:${String(s).padStart(2, '0')}`, unit: 'MIN' };
}

/** Whole minutes remaining, rounded up, for the round "NEXT IN 8" medallions. */
export function minutesLeft(ms: number): number {
  return Math.max(0, Math.ceil(ms / 60000));
}

export function parseHHMM(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}
