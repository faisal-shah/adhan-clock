import { countdownFace } from '../../core/calendar';
import { dailyItem, isUthmani } from '../../core/content';
import { PERIOD_NAMES, type ClockState } from '../../core/schedule';
import { backgroundFor, settings } from '../../store';
import { Clock, T, dateLine } from '../parts';

/** Fixed star positions (deterministic) for a quiet sky. */
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => (((Math.sin(i * 91.17 + n * 12.345) * 24634.6345) % 1) + 1) % 1;
  return { x: r(1) * 100, y: r(2) * 70, s: 0.12 + r(3) * 0.28, d: r(4) * 8, o: 0.25 + r(5) * 0.55 };
});

export function NightTheme({ st }: { st: ClockState }) {
  const s = settings.value;
  const bg = backgroundFor('night', st.now);
  const minute = st.now.getHours() * 60 + st.now.getMinutes();
  // Slow drift so nothing stays lit on the same pixels all night.
  const dx = Math.sin(minute / 23) * 3;
  const dy = Math.cos(minute / 31) * 2;
  const c = st.countdown;
  const f = countdownFace(c.target.getTime() - st.now.getTime());
  const dua = s.showDaily ? dailyItem(st.now, 10, 'dua', 160) : null;
  const nextLabel =
    c.kind === 'suhoor' ? 'Suhoor ends' : c.kind === 'iqamah' ? `${PERIOD_NAMES[c.slot.name]} iqamah` : PERIOD_NAMES[c.slot.name];
  return (
    <div class="nt">
      {bg && <img class="nt-photo" src={bg.url} alt="" />}
      <div class="nt-sky">
        {STARS.map((x) => (
          <i
            style={{
              left: `${x.x}%`,
              top: `${x.y}%`,
              width: `${x.s}rem`,
              height: `${x.s}rem`,
              opacity: x.o,
              animationDelay: `${-x.d}s`,
            }}
          />
        ))}
      </div>
      <svg class="nt-moon" viewBox="0 0 100 100">
        <path d="M62 12a40 40 0 1 0 26 66A34 34 0 0 1 62 12Z" />
      </svg>
      <div class="nt-center" style={{ transform: `translate(${dx}rem, ${dy}rem)` }}>
        <div class="nt-clock">
          <Clock d={st.now} />
        </div>
        <div class="nt-date">{dateLine(st.now, st.hijri)}</div>
        <div class="nt-info">
          <div>
            <span class="nt-k">{nextLabel}</span>
            <T d={c.target} />
            <span class="nt-in">
              in {f.value}
              {f.unit === 'HRS' ? ' h' : ' min'}
            </span>
          </div>
          <div>
            <span class="nt-k">Last third of the night</span>
            <T d={st.tahajjud} />
          </div>
        </div>
        {dua && (
          <div class="nt-dua">
            <div class={`nt-dua-ar ${isUthmani(dua.arabic) ? 'quranic' : ''}`}>{dua.arabic}</div>
            <div class="nt-dua-en">{dua.english}</div>
          </div>
        )}
      </div>
    </div>
  );
}
