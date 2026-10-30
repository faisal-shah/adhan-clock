import { describe, expect, it } from 'vitest';
import { clockState, computeDays, type AthanLength } from '../../src/core/schedule';
import type { Settings } from '../../src/core/settings';
import { CHICAGO } from './prayer.test';

// Chicago 2026-10-29 (Thursday): Fajr 06:02, Sunrise 07:19, Dhuhr 12:35,
// Asr 16:06, Maghrib 17:48, Isha 19:06. Tests run with TZ=America/Chicago.
const at = (hhmmss: string, day = 29) => {
  const [h, m, s = 0] = hhmmss.split(':').map(Number);
  return new Date(2026, 9, day, h, m, s);
};
const athan200: AthanLength = () => 200;
const state = (now: Date, s: Settings = CHICAGO, len: AthanLength = athan200, dismissed?: Set<string>) =>
  clockState(now, computeDays(now, s), s, len, dismissed);

describe('clockState', () => {
  it('tracks current/next prayers and the athan countdown', () => {
    const st = state(at('14:00'));
    expect(st.current.prayer).toBe('dhuhr');
    expect(st.next.prayer).toBe('asr');
    expect(st.countdown.kind).toBe('athan');
    expect(st.period.key).toBe('dhuhr');
    expect(st.takeover).toBeNull();
  });

  it('counts down to iqamah between athan and iqamah', () => {
    const st = state(at('12:45'));
    expect(st.countdown).toMatchObject({ kind: 'iqamah' });
    expect(st.countdown.target.getTime() - st.current.athan.getTime()).toBe(15 * 60_000);
  });

  it('runs the athan sequence: pre -> athan -> dua -> iqamah', () => {
    const dhuhr = state(at('12:00')).slots[1].athan.getTime();
    const phase = (offsetSec: number) => state(new Date(dhuhr + offsetSec * 1000)).takeover?.phase ?? null;
    expect(phase(-61)).toBeNull();
    expect(phase(-30)).toBe('pre');
    expect(phase(0)).toBe('athan');
    expect(phase(199)).toBe('athan');
    expect(phase(200)).toBe('dua');
    expect(phase(275)).toBeNull();
    expect(phase(15 * 60 - 30)).toBe('iqamah');
    expect(phase(15 * 60)).toBeNull();
  });

  it('uses a fixed screen length when the athan sound is off and honours dismissal', () => {
    const silent: AthanLength = () => null;
    const dhuhr = state(at('12:00')).slots[1].athan.getTime();
    expect(state(new Date(dhuhr + 89_000), CHICAGO, silent).takeover?.phase).toBe('athan');
    expect(state(new Date(dhuhr + 91_000), CHICAGO, silent).takeover?.phase).toBe('dua');
    const id = state(new Date(dhuhr)).takeover!.id;
    expect(state(new Date(dhuhr + 5000), CHICAGO, athan200, new Set([id])).takeover).toBeNull();
  });

  it('shortens or drops the iqamah countdown when the dua runs into iqamah (Maghrib +5)', () => {
    const maghrib = state(at('17:00')).slots[3].athan.getTime();
    expect(state(new Date(maghrib + 4 * 60_000)).takeover?.phase).toBe('dua');
    expect(state(new Date(maghrib + 4.9 * 60_000)).takeover?.phase).toBe('iqamah');
    const long: AthanLength = () => 280;
    expect(state(new Date(maghrib + 5.5 * 60_000), CHICAGO, long).takeover?.phase).toBe('dua');
    expect(state(new Date(maghrib + 6 * 60_000), CHICAGO, long).takeover).toBeNull();
  });

  it('picks the night theme between Isha+60 and Fajr, calligraphy after each athan', () => {
    expect(state(at('19:30')).theme).toBe('calligraphy'); // 24 min after Isha
    expect(state(at('20:00')).theme).toBe('classic');
    expect(state(at('20:10')).theme).toBe('night');
    expect(state(at('03:00')).theme).toBe('night');
    expect(state(at('06:10')).theme).toBe('calligraphy');
    expect(state(at('07:00')).theme).toBe('classic');
    expect(state(at('20:10'), { ...CHICAGO, night: { ...CHICAGO.night, enabled: false } }).theme).toBe('classic');
  });

  it('names periods including sunrise, duha and tahajjud', () => {
    expect(state(at('07:25')).period.key).toBe('sunrise');
    expect(state(at('07:25')).makruh?.kind).toBe('sunrise');
    expect(state(at('09:00')).period.key).toBe('duha');
    expect(state(at('12:30')).makruh?.kind).toBe('zawal');
    expect(state(at('03:30')).period.key).toBe('tahajjud');
    expect(state(at('23:00')).period.key).toBe('isha');
  });

  it("wraps across midnight: after Isha the next prayer is tomorrow's Fajr", () => {
    const st = state(at('23:30'));
    expect(st.current.prayer).toBe('isha');
    expect(st.next.prayer).toBe('fajr');
    expect(st.next.athan.getDate()).toBe(30);
    const early = state(at('02:00'));
    expect(early.current.prayer).toBe('isha');
    expect(early.current.athan.getDate()).toBe(28);
  });

  it("renames Friday Dhuhr to Jumu'ah with iqamah at the first Jumu'ah time", () => {
    const fri = state(at('13:00', 30));
    expect(fri.slots[1].name).toBe('jumuah');
    expect(fri.slots[1].iqamah.getHours()).toBe(13);
    expect(fri.slots[1].iqamah.getMinutes()).toBe(30);
    expect(state(at('13:00')).slots[1].name).toBe('dhuhr');
  });

  it('switches countdowns to iftar and suhoor during Ramadan', () => {
    const ram: Settings = { ...CHICAGO, ramadan: 'on' };
    expect(state(at('17:00'), ram).countdown.kind).toBe('iftar');
    expect(state(at('03:00'), ram).countdown.kind).toBe('suhoor');
    expect(state(at('03:00')).countdown.kind).toBe('athan');
  });

  it('adds a tahajjud athan only when enabled', () => {
    const on: Settings = { ...CHICAGO, tahajjud: { ...CHICAGO.tahajjud, enabled: true } };
    const lastThird = state(at('23:00')).tahajjud;
    expect(state(new Date(lastThird.getTime() + 10_000), on).takeover?.kind).toBe('tahajjud');
    expect(state(new Date(lastThird.getTime() + 10_000)).takeover).toBeNull();
  });
});
