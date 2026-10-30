import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes, SunnahTimes } from 'adhan';
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
