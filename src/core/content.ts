import daily from '../content/daily.json';
import events from '../content/events.json';
import { PERIOD_NAMES, type PeriodKey, type Slot } from './schedule';

export interface TextItem {
  arabic: string;
  english: string;
  ref: string;
}

export interface DailyItem extends TextItem {
  id: string;
  type: 'ayah' | 'hadith' | 'dua';
}

export const DAILY = daily as DailyItem[];

/** Uthmani script (alef wasla, Quranic annotation marks) needs the Quran font. */
export const isUthmani = (arabic: string) => /[\u0671\u06D6-\u06ED]/.test(arabic);

interface Events {
  duaAfterAthan: TextItem;
  iftarDua: TextItem;
  suhoorReminder: TextItem;
  fajrTagline: TextItem;
  prayerTaglines: Record<string, TextItem>;
}

export const EVENTS = events as Events;

export const DAILY_LABEL: Record<DailyItem['type'], string> = {
  ayah: 'Verse of the day',
  hadith: 'Hadith of the day',
  dua: 'Dua of the day',
};

/**
 * Rotates through the daily set every `minutes`, starting at a different item
 * each day. `maxEnglish` keeps long texts out of tight layouts.
 */
export function dailyItem(now: Date, minutes = 4, type?: DailyItem['type'], maxEnglish = Infinity): DailyItem | null {
  const pool = DAILY.filter((d) => (!type || d.type === type) && d.english.length <= maxEnglish);
  if (!pool.length) return null;
  const day = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000);
  const slot = Math.floor((now.getHours() * 60 + now.getMinutes()) / minutes);
  return pool[(day * 7 + slot) % pool.length];
}

export interface Greeting {
  /** Calligraphy artwork id */
  id: 'eid' | 'ramadan' | 'jumuah-mubarak';
  arabic: string;
  english: string;
}

/** Eid (1–3 Shawwal, 10–13 Dhu al-Hijjah), then Ramadan, then Friday. */
export function greetingFor(now: Date, hijri: { day: number; month: number }, ramadan: boolean): Greeting | null {
  const { day, month } = hijri;
  if ((month === 10 && day <= 3) || (month === 12 && day >= 10 && day <= 13)) {
    return { id: 'eid', arabic: 'عيد مبارك', english: 'Eid Mubarak' };
  }
  if (ramadan) return { id: 'ramadan', arabic: 'رمضان كريم', english: 'Ramadan Kareem' };
  if (now.getDay() === 5) return { id: 'jumuah-mubarak', arabic: 'جمعة مباركة', english: 'Jumu’ah Mubarak' };
  return null;
}

/** The short line under "It's Dhuhr time". */
export function taglineFor(period: PeriodKey): TextItem | null {
  if (period === 'fajr') return EVENTS.fajrTagline;
  if (period === 'sunrise') return null;
  return EVENTS.prayerTaglines[period] ?? null;
}

const KID_REMINDERS = [
  'Say Bismillah before you eat, and Alhamdulillah when you finish.',
  'Smile and say salaam to everyone you meet today.',
  'Help someone at home without being asked.',
  'Make a dua for your mom and dad.',
  'Read a little Quran today, even one page.',
  'Say SubhanAllah 10 times. It only takes a minute!',
  'Be kind to your brothers and sisters.',
  'Drink some water and say Alhamdulillah.',
  'Tidy up your toys and keep your room clean.',
  'Say JazakAllahu khayran when someone helps you.',
  'Think of three blessings and thank Allah for them.',
  'Share something with a friend today.',
  'Speak gently, even when you feel upset.',
  'Say Bismillah before you start your homework.',
  'Say Assalamu alaykum when you come home.',
  'Give someone a hug and tell them you love them for Allah.',
];

export function kidReminder(now: Date, next: Slot, current: Slot): string {
  const mins = Math.round((next.athan.getTime() - now.getTime()) / 60000);
  const sinceCurrent = (now.getTime() - current.athan.getTime()) / 60000;
  if (sinceCurrent >= 0 && sinceCurrent < 20) return `It's ${PERIOD_NAMES[current.name]} time! Let's go pray together.`;
  if (mins <= 15) return `${PERIOD_NAMES[next.name]} is in ${mins} minutes. Time to make wudu!`;
  const idx = Math.floor(now.getTime() / (45 * 1000)) % (KID_REMINDERS.length + 1);
  if (idx === KID_REMINDERS.length) return `Next up: ${PERIOD_NAMES[next.name]}. Get ready!`;
  return KID_REMINDERS[idx];
}
