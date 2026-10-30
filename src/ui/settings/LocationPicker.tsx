import { useState } from 'preact/hooks';
import { deviceTimezone, locateDevice, searchPlaces } from '../../core/geo';
import type { Place } from '../../core/settings';

export function LocationPicker({ onPick }: { onPick: (p: Place) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await f();
    } catch (e) {
      setError(
        e instanceof GeolocationPositionError
          ? 'Location permission was denied or timed out. Search for your city instead.'
          : String((e as Error).message ?? e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="loc">
      <button class="btn primary" disabled={busy} onClick={() => run(async () => onPick(await locateDevice()))}>
        Use this tablet's location
      </button>
      <form
        class="loc-search"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await searchPlaces(query);
            setResults(r);
            if (!r.length) setError('No matching places. Try "City, Country".');
          });
        }}
      >
        <input
          type="search"
          placeholder="Or search for a city"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button class="btn" type="submit" disabled={busy || query.trim().length < 2}>
          Search
        </button>
      </form>
      {error && <div class="loc-error">{error}</div>}
      {results.length > 0 && (
        <ul class="loc-results">
          {results.map((p) => (
            <li>
              <button class="loc-result" onClick={() => onPick(p)}>
                <span>{p.name}</span>
                <small>
                  {p.latitude.toFixed(2)}, {p.longitude.toFixed(2)}
                  {p.timezone && p.timezone !== deviceTimezone() && ` · ${p.timezone} (tablet is ${deviceTimezone()})`}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
