import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { clockFace, countdownFace, gregorianLine, hijriLine, type HijriDate } from '../core/calendar';
import { PERIOD_ARABIC, type ClockState, type Countdown, type PeriodKey } from '../core/schedule';
import { PERIOD_NAMES } from '../core/schedule';
import type { CalligraphyFont } from '../core/settings';
import { describeWeather, toUnit, type WeatherKind } from '../core/weather';
import { settings, weather } from '../store';

export function Clock({ d }: { d: Date }) {
  const f = clockFace(d, settings.value.clock24h);
  return (
    <span class="clock">
      {f.hm}
      {f.ampm && <span class="clock-ampm">{f.ampm}</span>}
    </span>
  );
}

/** A small time like "5:21PM" with the meridiem set smaller. */
export function T({ d }: { d: Date }) {
  const f = clockFace(d, settings.value.clock24h);
  return (
    <span class="t">
      {f.hm}
      {f.ampm && <small>{f.ampm}</small>}
    </span>
  );
}

export function dateLine(now: Date, hijri: HijriDate): string {
  return `${hijriLine(hijri)} | ${gregorianLine(now)}`;
}

export function countdownLabel(c: Countdown): string {
  const name = PERIOD_NAMES[c.slot.name].toUpperCase();
  switch (c.kind) {
    case 'iqamah':
      return `${name} IQAMAH IN`;
    case 'iftar':
      return 'IFTAR IN';
    case 'suhoor':
      return 'SUHOOR ENDS IN';
    default:
      return `${name} ATHAN IN`;
  }
}

export function CountdownPill({ st }: { st: ClockState }) {
  const f = countdownFace(st.countdown.target.getTime() - st.now.getTime());
  return (
    <div class="cd-pill">
      <span class="cd-label">{countdownLabel(st.countdown)}</span>
      <span class="cd-value">
        <span class="t">{f.value}</span>
        <span class="cd-unit">{f.unit}</span>
      </span>
    </div>
  );
}

export function Calligraphy({
  word,
  font,
  tone,
  reveal = true,
}: {
  word: PeriodKey;
  font: CalligraphyFont;
  tone: 'gold' | 'ink';
  reveal?: boolean;
}) {
  return (
    <div class={reveal ? 'callig-reveal' : undefined} key={word}>
      <div class={`callig f-${font} ${tone}`}>{PERIOD_ARABIC[word]}</div>
    </div>
  );
}

export function MakruhBadge({ st }: { st: ClockState }) {
  if (!st.makruh || !settings.value.makruhBadge) return null;
  const what = { sunrise: 'Sun rising', zawal: 'Sun at its zenith', sunset: 'Sun setting' }[st.makruh.kind];
  return (
    <div class="makruh">
      <span class="makruh-dot" />
      {what} · avoid voluntary prayer until <T d={st.makruh.end} />
    </div>
  );
}

/**
 * Keeps the outgoing child mounted underneath while the incoming one fades in.
 * With `fadeOut`, the outgoing layer also fades (for overlays that disappear).
 */
export function Crossfade({
  k,
  ms = 1200,
  fadeOut = false,
  children,
}: {
  k: string;
  ms?: number;
  fadeOut?: boolean;
  children: ComponentChildren;
}) {
  const live = useRef<{ k: string; node: ComponentChildren }>({ k, node: children });
  const outgoing = useRef<{ k: string; node: ComponentChildren } | null>(null);
  const [, bump] = useState(0);
  if (live.current.k !== k) outgoing.current = live.current;
  live.current = { k, node: children };
  useEffect(() => {
    if (!outgoing.current) return;
    const t = setTimeout(() => {
      outgoing.current = null;
      bump((n) => n + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [k]);
  return (
    <>
      {outgoing.current && (
        <div class={`xf ${fadeOut ? 'xf-out' : ''}`} key={outgoing.current.k} style={{ '--xf-ms': `${ms}ms` }}>
          {outgoing.current.node}
        </div>
      )}
      <div class="xf xf-in" key={k} style={{ '--xf-ms': `${ms}ms` }}>
        {children}
      </div>
    </>
  );
}

// --- Icons ------------------------------------------------------------------

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function SpeakerIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor" fill-opacity="0.15" />
      {off ? <path d="m22 9-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
    </svg>
  );
}

export function WeatherGlyph({ kind, night }: { kind: WeatherKind; night: boolean }) {
  const sun = night ? (
    <path d="M15.5 4.5a7 7 0 1 0 4 12.6A8 8 0 0 1 15.5 4.5Z" fill="currentColor" fill-opacity="0.18" />
  ) : (
    <g>
      <circle cx="12" cy="12" r="4.2" fill="currentColor" fill-opacity="0.18" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </g>
  );
  const cloud = (dx = 0, dy = 0) => (
    <path
      transform={`translate(${dx} ${dy})`}
      d="M7 18.5h9.5a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.3 11.6 3.5 3.5 0 0 0 7 18.5Z"
      fill="currentColor"
      fill-opacity="0.14"
    />
  );
  const drops = (n: number, len = 2.2) => (
    <path d={Array.from({ length: n }, (_, i) => `M${8 + i * 3.5} 20.5l-1 ${len}`).join('')} />
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      {kind === 'clear' && sun}
      {kind === 'partly' && (
        <>
          <g transform="translate(-3.5 -3.5) scale(0.85)">{sun}</g>
          {cloud(1.5, 1)}
        </>
      )}
      {kind === 'cloudy' && cloud(0, -1)}
      {kind === 'fog' && (
        <>
          {cloud(0, -3)}
          <path d="M4 19h16M6 22h12" />
        </>
      )}
      {(kind === 'drizzle' || kind === 'rain') && (
        <>
          {cloud(0, -3)}
          {drops(3, kind === 'rain' ? 2.6 : 1.4)}
        </>
      )}
      {kind === 'snow' && (
        <>
          {cloud(0, -3)}
          <path d="M8 20.5h.01M12 22h.01M16 20.5h.01" stroke-width="2.4" />
        </>
      )}
      {kind === 'storm' && (
        <>
          {cloud(0, -3)}
          <path d="m12.5 15.5-2 4h3l-2 4" />
        </>
      )}
    </svg>
  );
}

export function useWeather(): { temp: string; label: string; kind: WeatherKind; night: boolean } | null {
  const w = weather.value;
  const s = settings.value;
  if (!w || !s.weather.enabled) return null;
  const d = describeWeather(w.code);
  return {
    temp: `${toUnit(w.tempC, s.weather.unit)}°${s.weather.unit.toUpperCase()}`,
    label: d.label,
    kind: d.kind,
    night: !w.isDay,
  };
}
