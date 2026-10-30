import { clockFace, minutesLeft } from '../../core/calendar';
import { kidReminder } from '../../core/content';
import { PERIOD_NAMES, type ClockState } from '../../core/schedule';
import { settings } from '../../store';
import { T, WeatherGlyph, dateLine, useWeather } from '../parts';

const CLOUD =
  'M34 86C14 86 6 64 22 55 16 36 38 22 56 33 64 12 98 6 113 26 128 13 158 20 158 44 180 42 194 66 180 80 176 85 170 86 164 86Z';

function Cloud({ class: cls, children }: { class: string; children?: preact.ComponentChildren }) {
  return (
    <div class={`kd-cloud ${cls}`}>
      <svg class="kd-cloud-shape" viewBox="0 0 200 92" preserveAspectRatio="none">
        <path d={CLOUD} />
      </svg>
      {children && <div class="kd-cloud-text">{children}</div>}
    </div>
  );
}

/** Deterministic blade heights so the grass doesn't shimmer between renders. */
function grassPath(width: number, height: number, blades: number, seed: number, base: number): string {
  let x = 0;
  let r = seed;
  const rand = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const step = width / blades;
  let d = `M0 ${height} L0 ${base}`;
  for (let i = 0; i < blades; i++) {
    const tip = base - (8 + rand() * 22);
    const lean = (rand() - 0.5) * step * 0.9;
    d += ` Q${x + step * 0.3} ${base - 4} ${x + step / 2 + lean} ${tip} Q${x + step * 0.7} ${base - 4} ${x + step} ${base}`;
    x += step;
  }
  return `${d} L${width} ${height} Z`;
}

const GRASS_BACK = grassPath(1600, 160, 90, 7, 52);
const GRASS_FRONT = grassPath(1600, 160, 70, 3, 70);

function Mosque() {
  return (
    <svg class="kd-mosque" viewBox="0 0 220 200">
      <rect x="22" y="70" width="18" height="120" rx="3" fill="#ffffff" />
      <path d="M18 70h26l-13-34Z" fill="#2fb6d4" />
      <rect x="180" y="70" width="18" height="120" rx="3" fill="#ffffff" />
      <path d="M176 70h26l-13-34Z" fill="#2fb6d4" />
      <rect x="20" y="100" width="22" height="6" rx="2" fill="#2fb6d4" />
      <rect x="178" y="100" width="22" height="6" rx="2" fill="#2fb6d4" />
      <path d="M110 46c-40 6-62 40-62 74h124c0-34-22-68-62-74Z" fill="#2fb6d4" />
      <path d="M110 30v16" stroke="#f6b81a" stroke-width="4" stroke-linecap="round" />
      <path d="M115 18a9 9 0 1 0 2 15 7 7 0 1 1-2-15Z" fill="#f6b81a" />
      <rect x="48" y="118" width="124" height="72" rx="4" fill="#ffffff" />
      <path d="M96 190v-30a14 14 0 0 1 28 0v30Z" fill="#2fb6d4" />
      <path d="M64 150v-12a7 7 0 0 1 14 0v12ZM142 150v-12a7 7 0 0 1 14 0v12Z" fill="#9fe2f0" />
    </svg>
  );
}

function Sun() {
  return (
    <div class="kd-sun">
      <svg class="kd-rays" viewBox="-100 -100 200 200">
        {Array.from({ length: 16 }, (_, i) => (
          <line x1="0" y1="-62" x2="0" y2={i % 2 ? -76 : -86} transform={`rotate(${i * 22.5})`} />
        ))}
      </svg>
      <div class="kd-sun-disc" />
    </div>
  );
}

/** Flowers along the front of the grass: x position (design px), scale, petal colour. */
const FLOWERS: [number, number, string][] = [
  [90, 1, '#ff7aa8'],
  [160, 0.75, '#ffd23f'],
  [520, 0.9, '#ffffff'],
  [610, 0.7, '#ff7aa8'],
  [930, 0.85, '#ffd23f'],
  [1010, 1.05, '#b38cff'],
  [1180, 0.8, '#ffffff'],
];

function Flower({ x, k, color }: { x: number; k: number; color: string }) {
  return (
    <svg
      class="kd-flower"
      viewBox="-20 -20 40 70"
      style={{ left: `${x / 10}rem`, width: `${5.6 * k}rem`, height: `${9.8 * k}rem` }}
    >
      <path d="M0 6V46" stroke="#2f9e44" stroke-width="3" />
      <path d="M0 30c6-8 14-8 16-4-4 5-10 7-16 4Z" fill="#2f9e44" />
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse cx="0" cy="-9" rx="6" ry="9" fill={color} transform={`rotate(${a})`} />
      ))}
      <circle r="6" fill="#ffb000" />
    </svg>
  );
}

function Star() {
  return (
    <svg class="kd-star" viewBox="0 0 24 24">
      <path d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8Z" />
    </svg>
  );
}

function WeatherCloud() {
  const w = useWeather();
  return (
    <Cloud class="c-d">
      {w && (
        <div class="kd-weather">
          <WeatherGlyph kind={w.kind} night={w.night} />
          <b>{w.temp}</b>
        </div>
      )}
    </Cloud>
  );
}

export function KidsTheme({ st }: { st: ClockState }) {
  const f = clockFace(st.now, settings.value.clock24h);
  const c = st.countdown;
  const mins = minutesLeft(c.target.getTime() - st.now.getTime());
  const what =
    c.kind === 'iqamah'
      ? `${PERIOD_NAMES[c.slot.name]} iqamah`
      : c.kind === 'iftar'
        ? 'Iftar'
        : c.kind === 'suhoor'
          ? 'Suhoor ends'
          : PERIOD_NAMES[c.slot.name];
  const inText = mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`;
  const reminder = kidReminder(st.now, st.next, st.current);
  return (
    <div class="kd">
      <Sun />
      <div class="kd-birds">
        {[0, 1, 2].map((i) => (
          <svg class={`kd-bird b${i}`} viewBox="0 0 40 16">
            <path d="M2 10Q10 1 20 10Q30 1 38 10" />
          </svg>
        ))}
      </div>
      <Cloud class="c-a">
        <div class="kd-cl-row">
          <T d={st.today.sunrise} />
          <span>Sunrise</span>
        </div>
        <div class="kd-cl-row">
          <T d={st.today.maghrib} />
          <span>Sunset</span>
        </div>
      </Cloud>
      {st.jumuah.length > 0 && (
        <Cloud class="c-b">
          {st.jumuah.map((d, i) => (
            <div class="kd-cl-row">
              <T d={d} />
              <span>Jumu’ah{st.jumuah.length > 1 ? ` ${i + 1}` : ''}</span>
            </div>
          ))}
        </Cloud>
      )}
      <Cloud class="c-c" />
      <WeatherCloud />
      <Cloud class="c-e">
        <div class="kd-next">
          <span>{what} in</span>
          <b>{inText}</b>
        </div>
      </Cloud>

      <div class="canvas">
        <div class="kd-clock">
          <span class="kd-hm">{f.hm}</span>
          {f.ampm && (
            <span class="kd-ampm">
              <span>{f.ampm[0]}</span>
              <span>{f.ampm[1]}</span>
            </span>
          )}
        </div>
        <div class="kd-date">{dateLine(st.now, st.hijri)}</div>

        <div class="kd-cards">
          {st.slots.map((slot) => (
            <div class={`kd-card ${slot.id === st.current.id ? 'current' : ''}`}>
              {slot.id === st.current.id && <Star />}
              <div class="kd-card-name">{PERIOD_NAMES[slot.name].toUpperCase()}</div>
              <div class="kd-card-time">
                <T d={slot.athan} />
              </div>
              <div class="kd-card-label">{st.ramadan && slot.prayer === 'maghrib' ? 'Iftar' : 'Athan'}</div>
              <div class="kd-card-time">
                <T d={slot.iqamah} />
              </div>
              <div class="kd-card-label">{slot.name === 'jumuah' ? 'Jumu’ah' : 'Iqamah'}</div>
            </div>
          ))}
        </div>
      </div>

      <div class="kd-ground">
        <svg class="kd-grass" viewBox="0 0 1600 160" preserveAspectRatio="none">
          <path d={GRASS_BACK} fill="#2f9e44" />
          <path d={GRASS_FRONT} fill="#43c25a" />
        </svg>
        {FLOWERS.map(([x, k, c]) => (
          <Flower x={x} k={k} color={c} />
        ))}
        <Mosque />
        <div class="kd-reminder" key={reminder}>
          <Star />
          {reminder}
        </div>
      </div>
    </div>
  );
}
