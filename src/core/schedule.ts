import { hijriDate, parseHHMM, type HijriDate } from './calendar';
import { addDays, computeDay, startOfDay, type DayTimes } from './prayer';
import { PRAYERS, type BgSlot, type PrayerKey, type Settings, type ThemeKey } from './settings';

export type PeriodKey = 'fajr' | 'sunrise' | 'duha' | 'dhuhr' | 'jumuah' | 'asr' | 'maghrib' | 'isha' | 'tahajjud';

export const PERIOD_NAMES: Record<PeriodKey, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  duha: 'Duha',
  dhuhr: 'Dhuhr',
  jumuah: 'Jumu’ah',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  tahajjud: 'Tahajjud',
};

export const PERIOD_ARABIC: Record<PeriodKey, string> = {
  fajr: 'الفَجْر',
  sunrise: 'الشُّرُوق',
  duha: 'الضُّحَى',
  dhuhr: 'الظُّهْر',
  jumuah: 'الجُمُعَة',
  asr: 'العَصْر',
  maghrib: 'المَغْرِب',
  isha: 'العِشَاء',
  tahajjud: 'التَّهَجُّد',
};

const PERIOD_BG: Record<PeriodKey, BgSlot> = {
  fajr: 'fajr',
  sunrise: 'sunrise',
  duha: 'sunrise',
  dhuhr: 'dhuhr',
  jumuah: 'dhuhr',
  asr: 'asr',
  maghrib: 'maghrib',
  isha: 'isha',
  tahajjud: 'night',
};

const MIN = 60_000;
const SEC = 1000;
/** Sunrise makruh window; Duha starts when it ends. */
const SUNRISE_MAKRUH = 15 * MIN;
const ZAWAL_MAKRUH = 10 * MIN;
const SUNSET_MAKRUH = 15 * MIN;
const PRE_COUNTDOWN = 60 * SEC;
const IQAMAH_COUNTDOWN = 60 * SEC;
const DUA_SCREEN = 75 * SEC;
/** "It's Dhuhr time" screen length when the athan sound is off. */
const SILENT_ATHAN_SCREEN = 90 * SEC;
/** Used until an uploaded file's duration is known. */
const FALLBACK_ATHAN_LENGTH = 200 * SEC;

export interface Slot {
  /** `${yyyy-mm-dd}:${prayer}` — stable id for dismissals and played-sound bookkeeping. */
  id: string;
  prayer: PrayerKey;
  /** 'jumuah' for Dhuhr on Fridays when Jumu'ah is enabled. */
  name: PeriodKey;
  athan: Date;
  iqamah: Date;
}

export interface Period {
  key: PeriodKey;
  start: Date;
  end: Date;
  bg: BgSlot;
}

export type Phase = 'pre' | 'athan' | 'dua' | 'iqamah';

export interface Takeover {
  id: string;
  kind: 'prayer' | 'tahajjud';
  name: PeriodKey;
  prayer: PrayerKey | null;
  phase: Phase;
  phaseStart: Date;
  phaseEnd: Date;
  athan: Date;
  iqamah: Date | null;
}

export interface Countdown {
  kind: 'athan' | 'iqamah' | 'iftar' | 'suhoor';
  slot: Slot;
  target: Date;
}

export interface Makruh {
  kind: 'sunrise' | 'zawal' | 'sunset';
  end: Date;
}

export interface ClockState {
  now: Date;
  today: DayTimes;
  /** Today's five prayers in order. */
  slots: Slot[];
  /** Most recent athan at or before now (yesterday's Isha before Fajr). */
  current: Slot;
  /** Next athan after now (tomorrow's Fajr after Isha). */
  next: Slot;
  period: Period;
  countdown: Countdown;
  takeover: Takeover | null;
  theme: ThemeKey;
  makruh: Makruh | null;
  ramadan: boolean;
  hijri: HijriDate;
  /** Jumu'ah times on the coming (or current) Friday. */
  jumuah: Date[];
  /** Next start of the last third of the night. */
  tahajjud: Date;
  /** Duha start (end of the sunrise makruh window) today. */
  duha: Date;
}

export interface Days {
  yesterday: DayTimes;
  today: DayTimes;
  tomorrow: DayTimes;
}

export function computeDays(now: Date, s: Settings): Days {
  const d = startOfDay(now);
  return {
    yesterday: computeDay(addDays(d, -1), s),
    today: computeDay(d, s),
    tomorrow: computeDay(addDays(d, 1), s),
  };
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function slotsFor(day: DayTimes, s: Settings): Slot[] {
  const friday = day.date.getDay() === 5 && s.jumuah.enabled;
  return PRAYERS.map((p) => {
    const athan = day[p];
    let iqamah = new Date(athan.getTime() + s.iqamah[p] * MIN);
    let name: PeriodKey = p;
    if (p === 'dhuhr' && friday) {
      name = 'jumuah';
      const first = s.jumuah.times.map((t) => parseHHMM(day.date, t)).find((t) => t > athan);
      if (first) iqamah = first;
    }
    return { id: `${dayKey(day.date)}:${p}`, prayer: p, name, athan, iqamah };
  });
}

function periodAt(now: Date, days: Days, slots: Slot[]): Period {
  const { yesterday: y, today: t, tomorrow: tm } = days;
  const duha = new Date(t.sunrise.getTime() + SUNRISE_MAKRUH);
  const dhuhrName = slots[1].name;
  const bounds: [PeriodKey, Date, Date][] = [
    ['isha', y.isha, y.lastThird],
    ['tahajjud', y.lastThird, t.fajr],
    ['fajr', t.fajr, t.sunrise],
    ['sunrise', t.sunrise, duha],
    ['duha', duha, t.dhuhr],
    [dhuhrName, t.dhuhr, t.asr],
    ['asr', t.asr, t.maghrib],
    ['maghrib', t.maghrib, t.isha],
    ['isha', t.isha, t.lastThird],
    ['tahajjud', t.lastThird, tm.fajr],
  ];
  const hit = bounds.find(([, a, b]) => now >= a && now < b) ?? bounds[bounds.length - 1];
  return { key: hit[0], start: hit[1], end: hit[2], bg: PERIOD_BG[hit[0]] };
}

function makruhAt(now: Date, t: DayTimes): Makruh | null {
  const windows: [Makruh['kind'], number, number][] = [
    ['sunrise', t.sunrise.getTime(), t.sunrise.getTime() + SUNRISE_MAKRUH],
    ['zawal', t.dhuhr.getTime() - ZAWAL_MAKRUH, t.dhuhr.getTime()],
    ['sunset', t.maghrib.getTime() - SUNSET_MAKRUH, t.maghrib.getTime()],
  ];
  const n = now.getTime();
  const w = windows.find(([, a, b]) => n >= a && n < b);
  return w ? { kind: w[0], end: new Date(w[2]) } : null;
}

/** Seconds of athan audio for a sound choice, or null when the sound is off. */
export type AthanLength = (prayer: PrayerKey | 'tahajjud') => number | null;

interface PhaseSpan {
  phase: Phase;
  start: number;
  end: number;
}

function prayerPhases(slot: Slot, s: Settings, athanLength: AthanLength): PhaseSpan[] {
  const a = slot.athan.getTime();
  const iq = slot.iqamah.getTime();
  const len = athanLength(slot.prayer);
  const athanEnd = a + (len === null ? SILENT_ATHAN_SCREEN : len > 0 ? len * SEC : FALLBACK_ATHAN_LENGTH);
  const spans: PhaseSpan[] = [];
  if (s.sequence.preCountdown) spans.push({ phase: 'pre', start: a - PRE_COUNTDOWN, end: a });
  spans.push({ phase: 'athan', start: a, end: athanEnd });
  let cursor = athanEnd;
  if (s.sequence.dua) {
    spans.push({ phase: 'dua', start: cursor, end: cursor + DUA_SCREEN });
    cursor += DUA_SCREEN;
  }
  if (s.sequence.iqamahCountdown && iq > cursor) {
    spans.push({ phase: 'iqamah', start: Math.max(cursor, iq - IQAMAH_COUNTDOWN), end: iq });
  }
  return spans;
}

function takeoverAt(
  now: Date,
  allSlots: Slot[],
  days: Days,
  s: Settings,
  athanLength: AthanLength,
  dismissed: ReadonlySet<string>,
): Takeover | null {
  const n = now.getTime();
  for (const slot of allSlots) {
    if (dismissed.has(slot.id)) continue;
    const span = prayerPhases(slot, s, athanLength).find((p) => n >= p.start && n < p.end);
    if (span) {
      return {
        id: slot.id,
        kind: 'prayer',
        name: slot.name,
        prayer: slot.prayer,
        phase: span.phase,
        phaseStart: new Date(span.start),
        phaseEnd: new Date(span.end),
        athan: slot.athan,
        iqamah: slot.iqamah,
      };
    }
  }
  if (s.tahajjud.enabled) {
    for (const day of [days.yesterday, days.today]) {
      const id = `${dayKey(day.date)}:tahajjud`;
      const start = day.lastThird.getTime();
      const len = athanLength('tahajjud');
      const end = start + (len === null ? SILENT_ATHAN_SCREEN : len > 0 ? len * SEC : FALLBACK_ATHAN_LENGTH);
      if (!dismissed.has(id) && n >= start && n < end) {
        return {
          id,
          kind: 'tahajjud',
          name: 'tahajjud',
          prayer: null,
          phase: 'athan',
          phaseStart: day.lastThird,
          phaseEnd: new Date(end),
          athan: day.lastThird,
          iqamah: null,
        };
      }
    }
  }
  return null;
}

function isRamadan(d: Date, s: Settings): boolean {
  if (s.ramadan !== 'auto') return s.ramadan === 'on';
  return hijriDate(d, s.hijriOffset).month === 9;
}

function nightAt(now: Date, days: Days, s: Settings): boolean {
  if (!s.night.enabled) return false;
  const windows: [Date, Date][] = [
    [days.yesterday.isha, days.today.fajr],
    [days.today.isha, days.tomorrow.fajr],
  ];
  const n = now.getTime();
  return windows.some(
    ([isha, fajr]) => n >= isha.getTime() + s.night.startAfterIsha * MIN && n < fajr.getTime() - s.night.endBeforeFajr * MIN,
  );
}

function upcomingFriday(now: Date): Date {
  return addDays(startOfDay(now), (5 - now.getDay() + 7) % 7);
}

export function clockState(
  now: Date,
  days: Days,
  s: Settings,
  athanLength: AthanLength,
  dismissed: ReadonlySet<string> = new Set(),
): ClockState {
  const ySlots = slotsFor(days.yesterday, s);
  const slots = slotsFor(days.today, s);
  const tmSlots = slotsFor(days.tomorrow, s);
  const all = [...ySlots, ...slots, ...tmSlots];
  const n = now.getTime();
  const currentIdx = all.findLastIndex((x) => x.athan.getTime() <= n);
  const current = all[currentIdx];
  const next = all[currentIdx + 1];

  let countdown: Countdown;
  if (n < current.iqamah.getTime()) {
    countdown = { kind: 'iqamah', slot: current, target: current.iqamah };
  } else if (next.prayer === 'maghrib' && isRamadan(now, s)) {
    countdown = { kind: 'iftar', slot: next, target: next.athan };
  } else if (next.prayer === 'fajr' && isRamadan(next.athan, s)) {
    countdown = { kind: 'suhoor', slot: next, target: next.athan };
  } else {
    countdown = { kind: 'athan', slot: next, target: next.athan };
  }

  const period = periodAt(now, days, slots);
  const takeover = takeoverAt(now, all, days, s, athanLength, dismissed);

  let theme: ThemeKey = s.dayTheme;
  if (nightAt(now, days, s)) theme = 'night';
  else if (n < current.athan.getTime() + s.calligraphyMinutes * MIN) theme = 'calligraphy';

  const friday = upcomingFriday(now);
  const tahajjud = n < days.today.lastThird.getTime() && n >= days.today.fajr.getTime()
    ? days.today.lastThird
    : n < days.today.fajr.getTime() && n < days.yesterday.lastThird.getTime()
      ? days.yesterday.lastThird
      : days.today.lastThird;

  return {
    now,
    today: days.today,
    slots,
    current,
    next,
    period,
    countdown,
    takeover,
    theme,
    makruh: makruhAt(now, days.today),
    ramadan: isRamadan(now, s) || countdown.kind === 'suhoor',
    hijri: hijriDate(now, s.hijriOffset),
    jumuah: s.jumuah.enabled ? s.jumuah.times.map((t) => parseHHMM(friday, t)) : [],
    tahajjud,
    duha: new Date(days.today.sunrise.getTime() + SUNRISE_MAKRUH),
  };
}
