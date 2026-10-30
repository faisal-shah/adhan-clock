import { countdownFace } from '../core/calendar';
import { EVENTS, isUthmani, taglineFor } from '../core/content';
import { PERIOD_NAMES, type ClockState, type PeriodKey, type Takeover as TakeoverState } from '../core/schedule';
import type { BgSlot } from '../core/settings';
import { backgroundFor, dismiss, resolveAudio, settings } from '../store';
import { Calligraphy, Clock, SpeakerIcon, dateLine } from './parts';
import { splitTagline } from './themes/CalligraphyTheme';

const BG_OF: Record<PeriodKey, BgSlot> = {
  fajr: 'fajr',
  sunrise: 'sunrise',
  duha: 'sunrise',
  dhuhr: 'dhuhr',
  jumuah: 'dhuhr',
  asr: 'asr',
  maghrib: 'maghrib',
  isha: 'isha',
  tahajjud: 'night',
};

/** Deterministic dust motes drifting up through the light. */
const MOTES = Array.from({ length: 18 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return {
    left: `${8 + r(1) * 84}%`,
    size: `${0.3 + r(2) * 0.7}rem`,
    delay: `${-r(3) * 20}s`,
    duration: `${14 + r(4) * 14}s`,
    opacity: 0.25 + r(5) * 0.5,
  };
});

function Backdrop({ slot, now, blur }: { slot: BgSlot; now: Date; blur: boolean }) {
  const bg = backgroundFor(slot, now);
  return (
    <div class={`tk-bg p-${slot} ${blur ? 'blur' : ''}`}>
      {bg && <img src={bg.url} alt="" />}
    </div>
  );
}

function Ring({ t, now, label, sub }: { t: TakeoverState; now: Date; label: string; sub: string }) {
  const total = t.phaseEnd.getTime() - t.phaseStart.getTime();
  const left = t.phaseEnd.getTime() - now.getTime();
  const f = countdownFace(left);
  const R = 47;
  const C = 2 * Math.PI * R;
  return (
    <div class="tk-ring-wrap rise">
      <svg class="tk-ring" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={R} class="track" />
        <circle cx="50" cy="50" r={R} class="arc" stroke-dasharray={`${C * (1 - left / total)} ${C}`} />
      </svg>
      <div class="tk-ring-text">
        <div class="tk-ring-label">{label}</div>
        <div class="tk-ring-sub">{sub}</div>
        <div class="tk-ring-num">{f.value}</div>
      </div>
    </div>
  );
}

function SoundPill({ t }: { t: TakeoverState }) {
  const s = settings.value;
  const choice = t.kind === 'tahajjud' ? s.tahajjud : t.prayer ? s.sounds[t.prayer] : null;
  const playing = choice?.enabled && resolveAudio(choice.audioId);
  return (
    <button class="tk-stop" onClick={() => dismiss(t.id)}>
      <SpeakerIcon off={!playing} />
      {playing ? 'Stop the athan' : 'Close'}
    </button>
  );
}

export function TakeoverLayer({ st }: { st: ClockState }) {
  const t = st.takeover!;
  const s = settings.value;
  const slot = BG_OF[t.name];
  const name = PERIOD_NAMES[t.name].toUpperCase();

  if (t.phase === 'pre' || t.phase === 'iqamah') {
    return (
      <div class="tk tk-count">
        <Backdrop slot={slot} now={st.now} blur />
        <div class="tk-veil" />
        <div class="tk-count-arabic rise">
          <Calligraphy word={t.name} font={s.calligraphyFont} tone="gold" reveal={false} />
        </div>
        <Ring t={t} now={st.now} label={name} sub={t.phase === 'pre' ? 'ATHAN IN' : 'IQAMAH IN'} />
        <div class="tk-count-foot rise" style={{ animationDelay: '0.3s' }}>
          {t.phase === 'pre' ? 'Prepare for prayer' : 'Stand for prayer · straighten the rows'}
        </div>
        <button class="tk-close" aria-label="Close" onClick={() => dismiss(t.id)}>
          ×
        </button>
      </div>
    );
  }

  if (t.phase === 'dua') {
    const iftar = st.ramadan && t.prayer === 'maghrib';
    const dua = iftar ? EVENTS.iftarDua : EVENTS.duaAfterAthan;
    return (
      <div class="tk tk-dua">
        <Backdrop slot={slot} now={st.now} blur />
        <div class="tk-veil deep" />
        {dua && (
          <div class="tk-dua-card rise">
            <div class="tk-dua-head">{iftar ? 'DUA AT IFTAR' : 'DUA AFTER THE ATHAN'}</div>
            <div class={`tk-dua-ar ${isUthmani(dua.arabic) ? 'quranic' : ''}`}>{dua.arabic}</div>
            <div class="tk-ornament">
              <span />
              <i />
              <span />
            </div>
            <div class="tk-dua-en">{dua.english}</div>
            <div class="tk-dua-ref">{dua.ref}</div>
          </div>
        )}
        <button class="tk-close" aria-label="Close" onClick={() => dismiss(t.id)}>
          ×
        </button>
      </div>
    );
  }

  const tagline = taglineFor(t.name);
  return (
    <div class={`tk tk-athan ${t.kind === 'tahajjud' ? 'night' : ''}`}>
      <Backdrop slot={slot} now={st.now} blur={false} />
      <div class="tk-veil radial" />
      <div class="tk-rays" />
      <div class="tk-motes">
        {MOTES.map((m) => (
          <span
            style={{ left: m.left, width: m.size, height: m.size, animationDelay: m.delay, animationDuration: m.duration, opacity: m.opacity }}
          />
        ))}
      </div>
      <div class="tk-top rise">
        <Clock d={st.now} />
        <span class="tk-top-date">{dateLine(st.now, st.hijri)}</span>
      </div>
      <div class="tk-center">
        <div class="tk-halo" />
        <div class="tk-word">
          <Calligraphy word={t.name} font={s.calligraphyFont} tone="gold" />
        </div>
        <div class="tk-headline rise" style={{ animationDelay: '1.6s' }}>
          <span class="small">IT'S</span>
          <span class="big">{name}</span>
          <span class="small">TIME</span>
        </div>
        {tagline && (
          <div class="tk-tags rise" style={{ animationDelay: '2.2s' }}>
            {splitTagline(tagline.english.toUpperCase()).map((l) => (
              <div class="tk-tag">{l}</div>
            ))}
          </div>
        )}
      </div>
      <SoundPill t={t} />
    </div>
  );
}
