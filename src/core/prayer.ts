import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PolarCircleResolution, PrayerTimes, SunnahTimes } from 'adhan';
import type { PrayerKey, Settings } from './settings';

export interface DayTimes {
  /** Local midnight of the day these times belong to. */
  date: Date;
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
  /** Start of the last third of the night that follows this day's Maghrib. */
  lastThird: Date;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The place's calendar day at `now`, as local midnight of that date (the
 * form computeDay takes). It differs from the tablet's own date only when the
 * tablet is set to another time zone.
 */
export function placeDay(now: Date, timezone: string | null): Date {
  if (!timezone) return startOfDay(now);
  let f = dayFormats.get(timezone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric' });
    } catch {
      return startOfDay(now); // not a zone this browser knows
    }
    dayFormats.set(timezone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, Number(p.value)]));
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** Days since 1970-01-01 on the local calendar: one step per date, whatever the clocks did. */
export function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

type CalcSettings = Pick<Settings, 'place' | 'method' | 'madhab' | 'highLatRule' | 'adjust'>;

export function computeDay(day: Date, s: CalcSettings): DayTimes {
  if (!s.place) throw new Error('computeDay requires a place');
  const coords = new Coordinates(s.place.latitude, s.place.longitude);
  const params = CalculationMethod[s.method]();
  params.madhab = s.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  params.highLatitudeRule = s.highLatRule === 'recommended' ? HighLatitudeRule.recommended(coords) : s.highLatRule;
  // Inside the polar circles some days have no sunrise or sunset; take those times from the nearest latitude that has them.
  params.polarCircleResolution = PolarCircleResolution.AqrabBalad;
  params.adjustments = { ...params.adjustments, ...s.adjust };
  const date = startOfDay(day);
  const pt = new PrayerTimes(coords, date, params);
  return {
    date,
    fajr: pt.fajr,
    sunrise: pt.sunrise,
    dhuhr: pt.dhuhr,
    asr: pt.asr,
    maghrib: pt.maghrib,
    isha: pt.isha,
    lastThird: new SunnahTimes(pt).lastThirdOfTheNight,
  };
}

export function athanOf(t: DayTimes, p: PrayerKey): Date {
  return t[p];
}
