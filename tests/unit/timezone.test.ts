import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { clockState, computeDays } from '../../src/core/schedule';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings';

// The tablet set to Auckland, 19 hours ahead of the Chicago clock it shows.
beforeAll(() => vi.stubEnv('TZ', 'Pacific/Auckland'));
afterAll(() => vi.unstubAllEnvs());

describe('a tablet in another time zone', () => {
  it("takes the day from the place's calendar, so there is always a current and next prayer", () => {
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      place: { name: 'Chicago', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago' },
    };
    const start = Date.UTC(2026, 9, 28, 0, 0);
    for (let m = 0; m < 3 * 1440; m += 7) {
      const now = new Date(start + m * 60_000);
      const st = clockState(now, computeDays(now, s), s, () => 200);
      expect(st.current.athan.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(st.next.athan.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});
