import { taglineFor } from '../../core/content';
import type { Background } from '../../core/media';
import { PERIOD_NAMES, type ClockState, type Slot } from '../../core/schedule';
import { backgroundFor, settings } from '../../store';
import {
  Calligraphy,
  Clock,
  GreetingMark,
  CountdownPill,
  Crossfade,
  MakruhBadge,
  T,
  WeatherGlyph,
  dateLine,
  useWeather,
} from '../parts';

const DAYLIT = new Set(['sunrise', 'duha', 'dhuhr', 'jumuah', 'asr']);

/**
 * Splits a tagline into one or two balanced pills, like Masjidal's stacked
 * banners. Translator's brackets and the closing stop are dropped for display.
 */
export function splitTagline(raw: string): string[] {
  const text = raw.replace(/[[\]]/g, '').replace(/[.,;:]+$/, '');
  if (text.length <= 30) return [text];
  const words = text.split(' ');
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function DialRow({ slot, top, ramadan }: { slot: Slot; top: boolean; ramadan: boolean }) {
  const athanLabel = ramadan && slot.prayer === 'maghrib' ? 'IFTAR' : 'ATHAN';
  const name = PERIOD_NAMES[slot.name].toUpperCase();
  if (top) {
    return (
      <div class="dial-top">
        <div class="dial-name">{name}</div>
        <div class="dial-label">{athanLabel}</div>
        <div class="dial-pill">
          <T d={slot.athan} />
        </div>
      </div>
    );
  }
  return (
    <div class="dial-bottom">
      <div class="dial-name">{name}</div>
      <div class="dial-label">NEXT</div>
      <div class="dial-cols">
        <div>
          <T d={slot.athan} />
          <div class="dial-label">{athanLabel}</div>
        </div>
        <div>
          <T d={slot.iqamah} />
          <div class="dial-label">{slot.name === 'jumuah' ? 'JUMU’AH' : 'IQAMAH'}</div>
        </div>
      </div>
    </div>
  );
}

export function PrayerDial({ st }: { st: ClockState }) {
  return (
    <div class="dial">
      <div class="dial-face">
        <DialRow slot={st.current} top ramadan={st.ramadan} />
        <div class="dial-rule" />
        <DialRow slot={st.next} top={false} ramadan={st.ramadan} />
      </div>
    </div>
  );
}

export function SunMedallion({ st }: { st: ClockState }) {
  return (
    <div class="sun-medal">
      <div class="dial-label light">SUNRISE</div>
      <T d={st.today.sunrise} />
      <div class="sun-rule" />
      <span class="gold-t">
        <T d={st.today.maghrib} />
      </span>
      <div class="dial-label">SUNSET</div>
    </div>
  );
}

function WeatherMedallion() {
  const w = useWeather();
  if (!w) return null;
  return (
    <div class="wx-medal">
      <WeatherGlyph kind={w.kind} night={w.night} />
      <div class="wx-temp">{w.temp}</div>
    </div>
  );
}

/** `bg` pins a background (the showcase); otherwise the period's choice is used. */
export function CalligraphyTheme({ st, bg: pinned }: { st: ClockState; bg?: Background }) {
  const s = settings.value;
  const period = st.period.key;
  const bg = pinned ?? backgroundFor(st.period.bg, st.now);
  const tone = bg?.textTone ?? 'light';
  const tagline = taglineFor(period);
  const headline = PERIOD_NAMES[period].toUpperCase();
  return (
    <div class={`ct tone-${tone} p-${st.period.bg}`}>
      <div class="ct-photo">
        <Crossfade k={bg?.url ?? st.period.bg} ms={2500}>
          {bg && <img src={bg.url} alt="" decoding="async" />}
        </Crossfade>
      </div>
      <div class="ct-scrim" />
      {DAYLIT.has(period) && <div class="ct-flare" />}
      <div class="grain" />

      <GreetingMark st={st} class="corner" tone={tone === 'light' ? 'gold' : 'ink'} />
      <div class="ct-right">
        <div class="ct-clock">
          <Clock d={st.now} />
        </div>
        <div class="ct-date">{dateLine(st.now, st.hijri)}</div>
        <CountdownPill st={st} />
        <MakruhBadge st={st} />
        <div class="ct-word">
          <Calligraphy word={period} font={s.calligraphyFont} tone={tone === 'light' ? 'gold' : 'ink'} />
        </div>
        <div class="ct-headline rise" key={period}>
          {period === 'sunrise' ? (
            <span class="big">SUNRISE</span>
          ) : (
            <>
              <span class="small">IT'S</span>
              <span class="big">{headline}</span>
              <span class="small">TIME</span>
            </>
          )}
        </div>
        <div class="ct-taglines rise" key={`t-${period}`} style={{ animationDelay: '0.4s' }}>
          {period === 'sunrise' ? (
            <div class="ct-tag">
              DUHA BEGINS AT <T d={st.duha} />
            </div>
          ) : (
            tagline && splitTagline(tagline.english.toUpperCase()).map((line) => <div class="ct-tag">{line}</div>)
          )}
        </div>
      </div>

      {bg?.caption && (
        <div class="ct-caption" key={bg.id}>
          {bg.caption}
        </div>
      )}
      <PrayerDial st={st} />
      <SunMedallion st={st} />
      <WeatherMedallion />
    </div>
  );
}
