import type { Place } from './settings';

/** City search via Open-Meteo geocoding (free, no key). */
export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&name=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`Search failed (HTTP ${r.status})`);
  const j = await r.json();
  const results: unknown[] = Array.isArray(j?.results) ? j.results : [];
  return results.flatMap((x) => {
    const p = x as Record<string, unknown>;
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number' || typeof p.name !== 'string') return [];
    const parts = [p.name, p.admin1, p.country].filter((v): v is string => typeof v === 'string' && v.length > 0);
    return [{ name: parts.join(', '), latitude: p.latitude, longitude: p.longitude, timezone: typeof p.timezone === 'string' ? p.timezone : null }];
  });
}

/** Device location, named via BigDataCloud's free client-side reverse geocoder. */
export async function locateDevice(): Promise<Place> {
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 20000, maximumAge: 3600_000 }),
  );
  const { latitude, longitude } = pos.coords;
  let name = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
    );
    const j = await r.json();
    const parts = [j?.city || j?.locality, j?.principalSubdivision, j?.countryName].filter((v) => typeof v === 'string' && v);
    if (parts.length) name = parts.join(', ');
  } catch {
    // Keep the coordinate name; the place itself is what matters.
  }
  return { name, latitude, longitude, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
