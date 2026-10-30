export interface Weather {
  tempC: number;
  code: number;
  isDay: boolean;
  fetchedAt: number;
}

/** Current conditions from Open-Meteo (free, no key, CORS-enabled). */
export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code,is_day';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather: HTTP ${r.status}`);
  const j = await r.json();
  const c = j?.current;
  if (typeof c?.temperature_2m !== 'number' || typeof c?.weather_code !== 'number') throw new Error('weather: bad payload');
  return { tempC: c.temperature_2m, code: c.weather_code, isDay: c.is_day === 1, fetchedAt: Date.now() };
}

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO weather interpretation codes -> icon kind + label. */
export function describeWeather(code: number): { kind: WeatherKind; label: string } {
  if (code === 0) return { kind: 'clear', label: 'Clear' };
  if (code <= 2) return { kind: 'partly', label: 'Partly cloudy' };
  if (code === 3) return { kind: 'cloudy', label: 'Cloudy' };
  if (code <= 48) return { kind: 'fog', label: 'Fog' };
  if (code <= 57) return { kind: 'drizzle', label: 'Drizzle' };
  if (code <= 67 || (code >= 80 && code <= 82)) return { kind: 'rain', label: 'Rain' };
  if (code <= 77 || code === 85 || code === 86) return { kind: 'snow', label: 'Snow' };
  return { kind: 'storm', label: 'Storm' };
}

export const toUnit = (c: number, unit: 'f' | 'c') => Math.round(unit === 'f' ? c * 1.8 + 32 : c);
