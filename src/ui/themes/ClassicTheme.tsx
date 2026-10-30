import { minutesLeft } from '../../core/calendar';
import { dailyItem, DAILY_LABEL, isUthmani } from '../../core/content';
import { PERIOD_NAMES, type ClockState } from '../../core/schedule';
import { settings } from '../../store';
import { Clock, MakruhBadge, T, WeatherGlyph, dateLine, useWeather } from '../parts';

function Medallion({ st }: { st: ClockState }) {
  const c = st.countdown;
  const ms = c.target.getTime() - st.now.getTime();
  const mins = minutesLeft(ms);
  const name = c.kind === 'iftar' ? 'IFTAR' : c.kind === 'suhoor' ? 'SUHOOR' : PERIOD_NAMES[c.slot.name].toUpperCase();
  const sub = c.kind === 'iqamah' ? 'IQAMAH IN' : c.kind === 'suhoor' ? 'ENDS IN' : 'NEXT IN';
  const big = mins >= 100 ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` : String(mins);
  // Progress through the current interval, drawn as a gold arc.
  const span = c.target.getTime() - st.current.athan.getTime();
  const progress = span > 0 ? Math.min(1, Math.max(0, 1 - ms / span)) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div class="cl-medal">
      <svg class="cl-medal-ring" viewBox="0 0 100 100">
        <circle class="dots outer" cx="50" cy="50" r="49" />
        <circle class="dots inner" cx="50" cy="50" r="46.6" />
      </svg>
      <div class="cl-medal-face">
        <svg class="cl-medal-arc" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} class="track" />
          <circle cx="50" cy="50" r={R} class="arc" stroke-dasharray={`${C * progress} ${C}`} />
        </svg>
        <div class="cl-medal-name">{name}</div>
        <div class="cl-medal-sub">{sub}</div>
        <div class="cl-medal-num">{big}</div>
        <div class="cl-medal-unit">{mins >= 100 ? 'HOURS' : mins === 1 ? 'MINUTE' : 'MINUTES'}</div>
      </div>
    </div>
  );
}

function WeatherChip() {
  const w = useWeather();
  if (!w) return null;
  return (
    <div class="cl-weather">
      <div>
        <div class="cl-weather-temp">{w.temp}</div>
        <div class="cl-weather-label">{w.label}</div>
      </div>
      <WeatherGlyph kind={w.kind} night={w.night} />
    </div>
  );
}

export function ClassicTheme({ st }: { st: ClockState }) {
  const s = settings.value;
  const item = s.showDaily ? dailyItem(st.now, 4, undefined, 150) : null;
  return (
    <div class="cl">
      <div class="cl-pattern" />
      <div class="cl-band" />

      <div class="canvas">
        <div class="cl-pills left">
          {st.jumuah.map((d, i) => (
            <div class="cl-pill">
              <div class="cl-pill-label">{st.jumuah.length > 1 ? `JUMU’AH ${i + 1}` : 'JUMU’AH'}</div>
              <T d={d} />
            </div>
          ))}
        </div>
        <div class="cl-pills right">
          <div class="cl-pill">
            <div class="cl-pill-label">SUNRISE</div>
            <T d={st.today.sunrise} />
          </div>
          <div class="cl-pill">
            <div class="cl-pill-label">SUNSET</div>
            <T d={st.today.maghrib} />
          </div>
        </div>

        <div class="cl-card">
          <WeatherChip />
          <div class="cl-clock">
            <Clock d={st.now} />
          </div>
          <div class="cl-date">{dateLine(st.now, st.hijri)}</div>
          <MakruhBadge st={st} />
        </div>

        <div class="cl-row">
          {st.slots.map((slot) => {
            const current = slot.id === st.current.id;
            const iftar = st.ramadan && slot.prayer === 'maghrib';
            return (
              <div class={`cl-prayer ${current ? 'current' : ''}`}>
                <div class="cl-tiny">{iftar ? 'IFTAR' : 'ATHAN'}</div>
                <div class="cl-time">
                  <T d={slot.athan} />
                </div>
                <div class="cl-name">{PERIOD_NAMES[slot.name].toUpperCase()}</div>
                <div class="cl-time iq">
                  <T d={slot.iqamah} />
                </div>
                <div class="cl-tiny">{slot.name === 'jumuah' ? 'JUMU’AH' : 'IQAMAH'}</div>
              </div>
            );
          })}
          <Medallion st={st} />
        </div>

        <div class="cl-foot">
          {item ? (
            <div class="cl-daily" key={item.id}>
              <span class="cl-daily-label">{DAILY_LABEL[item.type]}</span>
              <span class={`cl-daily-ar ${isUthmani(item.arabic) ? 'quranic' : ''}`}>{item.arabic}</span>
              <span class="cl-daily-en">
                “{item.english}” <i>{item.ref}</i>
              </span>
            </div>
          ) : (
            <div class="cl-daily-en">Prayer times for {s.title || s.place?.name}</div>
          )}
        </div>
      </div>
    </div>
  );
}
