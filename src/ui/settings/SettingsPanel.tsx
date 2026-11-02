import { useEffect, useRef, useState } from 'preact/hooks';
import { previewSound, setPreviewVolume, stopPreview } from '../../audio';
import { clockFace } from '../../core/calendar';
import { deviceTimezone, isDeviceTimezone } from '../../core/geo';
import { toggleFullscreen, underFully } from '../../core/kiosk';
import { audioDuration, type AudioUpload } from '../../core/media';
import { PERIOD_NAMES, type ClockState } from '../../core/schedule';
import {
  BG_SLOT_NAMES,
  BG_SLOTS,
  CALC_METHODS,
  CALLIGRAPHY_FONTS,
  DEFAULT_SETTINGS,
  GALLERY_CATEGORIES,
  type GalleryCategory,
  HIGH_LAT_RULES,
  PRAYERS,
  limits,
  type CalligraphyFont,
  type Settings,
  type SoundChoice,
} from '../../core/settings';
import {
  addUpload,
  bundledAudio,
  calligraphyArt,
  chosenBackgrounds,
  clock,
  picking,
  removeUpload,
  settings,
  setDayTheme,
  settingsOpen,
  upcomingBackgrounds,
  updateSettings,
  uploads,
  viewer,
  type ViewItem,
} from '../../store';
import { T } from '../parts';
import { Row, Segmented, Select, Slider, Stepper, TimeInput, Toggle } from './controls';
import { PhotoThumb } from './Library';
import { LocationPicker } from './LocationPicker';
import { PreviewSection } from './PreviewSection';

const SECTIONS = {
  place: 'Location',
  times: 'Prayer times',
  iqamah: "Iqamah & Jumu'ah",
  display: 'Display',
  night: 'Night',
  sound: 'Athan & sound',
  backgrounds: 'Backgrounds',
  preview: 'Preview',
  tablet: 'Tablet',
} as const;
type Section = keyof typeof SECTIONS;

const set = (patch: (s: Settings) => Partial<Settings>) => updateSettings(patch);

function PlaceSection() {
  const s = settings.value;
  const [changing, setChanging] = useState(false);
  return (
    <>
      <Row label="This clock is in" hint={s.place && `${s.place.latitude.toFixed(4)}, ${s.place.longitude.toFixed(4)}`}>
        <span class="row-value">{s.place?.name}</span>
      </Row>
      {s.place?.timezone && !isDeviceTimezone(s.place.timezone) && (
        <p class="panel-warn">
          This tablet's time zone is {deviceTimezone()}, but {s.place.name} uses {s.place.timezone}. Times are shown on the
          tablet's clock, so set the tablet's time zone to match.
        </p>
      )}
      {changing ? (
        <div class="panel-block">
          <LocationPicker
            onPick={(place) => {
              set(() => ({ place }));
              setChanging(false);
            }}
          />
        </div>
      ) : (
        <div class="panel-actions">
          <button class="btn" onClick={() => setChanging(true)}>
            Change location
          </button>
        </div>
      )}
    </>
  );
}

function TimesSection() {
  const s = settings.value;
  const st = clock.value;
  return (
    <>
      {st && (
        <div class="times-table">
          {[
            ['Fajr', st.today.fajr],
            ['Sunrise', st.today.sunrise],
            ['Dhuhr', st.today.dhuhr],
            ['Asr', st.today.asr],
            ['Maghrib', st.today.maghrib],
            ['Isha', st.today.isha],
            ['Last third', st.tahajjud],
          ].map(([label, d]) => (
            <div>
              <span>{label as string}</span>
              <T d={d as Date} />
            </div>
          ))}
        </div>
      )}
      <Row label="Calculation method">
        <Select value={s.method} options={CALC_METHODS} onChange={(method) => set(() => ({ method }))} />
      </Row>
      <Row label="Asr" hint="Hanafi: shadow twice an object's length. Standard: Shafi'i, Maliki, Hanbali.">
        <Segmented
          value={s.madhab}
          options={[
            ['hanafi', 'Hanafi'],
            ['shafi', 'Standard'],
          ]}
          onChange={(madhab) => set(() => ({ madhab }))}
        />
      </Row>
      <Row label="High-latitude rule" hint="How Fajr and Isha are found when twilight never fully ends.">
        <Select value={s.highLatRule} options={HIGH_LAT_RULES} onChange={(highLatRule) => set(() => ({ highLatRule }))} />
      </Row>
      <div class="panel-sub">Adjust calculated athan times</div>
      {PRAYERS.map((p) => (
        <Row label={PERIOD_NAMES[p]}>
          <Stepper
            value={s.adjust[p]}
            {...limits('adjust.*')}
            unit="min"
            signed
            onChange={(v) => set((x) => ({ adjust: { ...x.adjust, [p]: v } }))}
          />
        </Row>
      ))}
    </>
  );
}

function IqamahSection() {
  const s = settings.value;
  const times = s.jumuah.times;
  const setTimes = (t: string[]) => set((x) => ({ jumuah: { ...x.jumuah, times: t } }));
  return (
    <>
      <div class="panel-sub">Iqamah, minutes after athan</div>
      {PRAYERS.map((p) => (
        <Row label={PERIOD_NAMES[p]}>
          <Stepper
            value={s.iqamah[p]}
            {...limits('iqamah.*')}
            unit="min"
            onChange={(v) => set((x) => ({ iqamah: { ...x.iqamah, [p]: v } }))}
          />
        </Row>
      ))}
      <div class="panel-sub">Jumu'ah</div>
      <Row label="Show Jumu'ah" hint="On Fridays Dhuhr becomes Jumu'ah and its iqamah is the first Jumu'ah time.">
        <Toggle value={s.jumuah.enabled} onChange={(enabled) => set((x) => ({ jumuah: { ...x.jumuah, enabled } }))} />
      </Row>
      {s.jumuah.enabled && (
        <>
          {times.map((t, i) => (
            <Row label={`Jumu'ah ${times.length > 1 ? i + 1 : ''}`}>
              <div class="inline">
                <TimeInput value={t} onChange={(v) => setTimes(times.map((x, j) => (j === i ? v : x)).sort())} />
                {times.length > 1 && (
                  <button class="btn small" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            </Row>
          ))}
          {times.length < 2 && (
            <div class="panel-actions">
              <button class="btn" onClick={() => setTimes([...times, times[0] ? bump(times[0], 60) : '13:30'].sort())}>
                Add a second Jumu'ah
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function bump(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** What is covering the daytime theme right now, if anything. */
function themeNote(st: ClockState, s: Settings): string {
  if (!st.themeUntil || st.theme === s.dayTheme) return 'Shown outside the calligraphy window and the night hours.';
  const f = clockFace(st.themeUntil, s.clock24h);
  const until = f.ampm ? `${f.hm}\u00a0${f.ampm}` : f.hm;
  if (st.theme === 'night') return `The night theme is on until ${until}, then this one.`;
  return `Calligraphy is on after the ${PERIOD_NAMES[st.current.name]} athan until ${until}. Choosing a theme here ends it now.`;
}

function DisplaySection() {
  const s = settings.value;
  const hasArt = calligraphyArt.value.length > 0;
  return (
    <>
      <Row label="Daytime theme" hint={themeNote(clock.value!, s)}>
        <Segmented
          value={s.dayTheme}
          options={[
            ['calligraphy', 'Calligraphy'],
            ['classic', 'Classic'],
            ['kids', 'Kids'],
            ['gallery', 'Gallery'],
          ]}
          onChange={setDayTheme}
        />
      </Row>
      {s.dayTheme === 'gallery' && (
        <>
          <Row label="Change the photo every">
            <Stepper
              value={s.gallery.minutes}
              {...limits('gallery.minutes')}
              unit="min"
              onChange={(minutes) => set((x) => ({ gallery: { ...x.gallery, minutes } }))}
            />
          </Row>
          {(Object.keys(GALLERY_CATEGORIES) as GalleryCategory[]).map((c) => (
            <Row label={GALLERY_CATEGORIES[c]}>
              <Toggle
                value={s.gallery.categories[c]}
                onChange={(v) => set((x) => ({ gallery: { ...x.gallery, categories: { ...x.gallery.categories, [c]: v } } }))}
              />
            </Row>
          ))}
        </>
      )}
      <Row label="Calligraphy after each athan" hint="How long the calligraphy theme stays after the athan.">
        <Stepper
          value={s.calligraphyMinutes}
          {...limits('calligraphyMinutes')}
          step={5}
          unit="min"
          onChange={(calligraphyMinutes) => set(() => ({ calligraphyMinutes }))}
        />
      </Row>
      <Row label="Calligraphy style">
        <Segmented
          value={s.calligraphyFont === 'art' && !hasArt ? 'ruqaa' : s.calligraphyFont}
          options={(Object.entries(CALLIGRAPHY_FONTS) as [CalligraphyFont, string][]).filter(([k]) => hasArt || k !== 'art')}
          onChange={(calligraphyFont) => set(() => ({ calligraphyFont }))}
        />
      </Row>
      <Row label="24-hour clock">
        <Toggle value={s.clock24h} onChange={(clock24h) => set(() => ({ clock24h }))} />
      </Row>
      <Row label="Hijri date adjustment" hint="Shift to match local moonsighting.">
        <Stepper
          value={s.hijriOffset}
          {...limits('hijriOffset')}
          unit="days"
          signed
          onChange={(hijriOffset) => set(() => ({ hijriOffset }))}
        />
      </Row>
      <Row label="Ramadan mode" hint="Suhoor and iftar countdowns and the iftar dua.">
        <Segmented
          value={s.ramadan}
          options={[
            ['auto', 'Auto'],
            ['on', 'On'],
            ['off', 'Off'],
          ]}
          onChange={(ramadan) => set(() => ({ ramadan }))}
        />
      </Row>
      <Row label="Weather">
        <div class="inline">
          {s.weather.enabled && (
            <Segmented
              value={s.weather.unit}
              options={[
                ['f', '°F'],
                ['c', '°C'],
              ]}
              onChange={(unit) => set((x) => ({ weather: { ...x.weather, unit } }))}
            />
          )}
          <Toggle value={s.weather.enabled} onChange={(enabled) => set((x) => ({ weather: { ...x.weather, enabled } }))} />
        </div>
      </Row>
      <Row label="Verse, hadith and dua of the day">
        <Toggle value={s.showDaily} onChange={(showDaily) => set(() => ({ showDaily }))} />
      </Row>
      <Row label="Makruh-time notice" hint="During sunrise, zenith and sunset.">
        <Toggle value={s.makruhBadge} onChange={(makruhBadge) => set(() => ({ makruhBadge }))} />
      </Row>
      <Row label="Motion" hint="Calm stops the slow zoom, light rays and drifting clouds (for slower tablets).">
        <Segmented
          value={s.motion}
          options={[
            ['full', 'Full'],
            ['calm', 'Calm'],
          ]}
          onChange={(motion) => set(() => ({ motion }))}
        />
      </Row>
      <Row label="Name" hint="Shown at the foot of the classic theme.">
        <input
          class="text-input"
          value={s.title}
          maxLength={40}
          onInput={(e) => set(() => ({ title: (e.target as HTMLInputElement).value }))}
        />
      </Row>
    </>
  );
}

function NightSection() {
  const s = settings.value;
  const n = s.night;
  const setNight = (patch: Partial<Settings['night']>) => set((x) => ({ night: { ...x.night, ...patch } }));
  return (
    <>
      <Row label="Night theme" hint="A dim, low-glare clock while the house sleeps.">
        <Toggle value={n.enabled} onChange={(enabled) => setNight({ enabled })} />
      </Row>
      {n.enabled && (
        <>
          <Row label="Starts after Isha">
            <Stepper
              value={n.startAfterIsha}
              {...limits('night.startAfterIsha')}
              step={15}
              unit="min"
              onChange={(startAfterIsha) => setNight({ startAfterIsha })}
            />
          </Row>
          <Row label="Ends before Fajr" hint="0 keeps it dark until the Fajr athan.">
            <Stepper
              value={n.endBeforeFajr}
              {...limits('night.endBeforeFajr')}
              step={5}
              unit="min"
              onChange={(endBeforeFajr) => setNight({ endBeforeFajr })}
            />
          </Row>
        </>
      )}
      <div class="panel-sub">Screen brightness {underFully() ? '' : '(needs Fully Kiosk Browser)'}</div>
      <Row label="At night">
        <Slider value={n.brightness / 100} onChange={(v) => setNight({ brightness: Math.round(v * 100) })} />
      </Row>
      <Row label="During the day">
        <Slider value={n.dayBrightness / 100} onChange={(v) => setNight({ dayBrightness: Math.round(v * 100) })} />
      </Row>
    </>
  );
}

/** "Fajr athan — Mishary Rashid Alafasy (maqam Hijaz)" -> "Fajr · Mishary Rashid Alafasy" */
function shortLabel(label: string): string {
  const [kind, who = ''] = label.split(' — ');
  return `${kind.startsWith('Fajr') ? 'Fajr · ' : ''}${who.replace(/\s*\(.*\)$/, '')}`;
}

function SoundPicker({
  choice,
  kind,
  onChange,
}: {
  choice: SoundChoice;
  kind: 'athan' | 'fajr';
  onChange: (c: SoundChoice) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const opts: [string, string][] = [
    ...bundledAudio.value
      .filter((a) => a.kind === 'athan' || a.kind === 'fajr')
      .map((a) => [a.id, shortLabel(a.label)] as [string, string]),
    ...uploads.value.filter((u) => u.kind === 'audio').map((u) => [`upload:${u.id}`, `Uploaded: ${u.name}`] as [string, string]),
  ];
  // Fajr athans first for Fajr.
  if (kind === 'fajr') opts.sort((a, b) => Number(b[0].startsWith('fajr')) - Number(a[0].startsWith('fajr')));
  return (
    <div class="sound">
      <Toggle value={choice.enabled} onChange={(enabled) => onChange({ ...choice, enabled })} />
      {choice.enabled && (
        <>
          <Select value={choice.audioId} options={opts} onChange={(audioId) => onChange({ ...choice, audioId })} />
          <Slider
            value={choice.volume}
            onChange={(volume) => {
              if (playing) setPreviewVolume(volume);
              onChange({ ...choice, volume });
            }}
          />
          <button
            class="btn small"
            onClick={() => {
              if (playing) {
                stopRef.current?.();
                setPlaying(false);
              } else {
                stopRef.current = previewSound(choice.audioId, choice.volume);
                setPlaying(stopRef.current !== null);
              }
            }}
          >
            {playing ? 'Stop' : 'Play'}
          </button>
        </>
      )}
    </div>
  );
}

function SoundSection() {
  const s = settings.value;
  const [error, setError] = useState('');
  const seq = s.sequence;
  const setSeq = (patch: Partial<Settings['sequence']>) => set((x) => ({ sequence: { ...x.sequence, ...patch } }));
  return (
    <>
      <div class="panel-sub">At each prayer</div>
      <Row label="One-minute countdown before the athan">
        <Toggle value={seq.preCountdown} onChange={(preCountdown) => setSeq({ preCountdown })} />
      </Row>
      <Row label="Dua after the athan">
        <Toggle value={seq.dua} onChange={(dua) => setSeq({ dua })} />
      </Row>
      <Row label="Full-screen iqamah countdown" hint="The last minute before iqamah.">
        <Toggle value={seq.iqamahCountdown} onChange={(iqamahCountdown) => setSeq({ iqamahCountdown })} />
      </Row>
      <Row label="Chime before the athan">
        <div class="sound">
          <Toggle value={s.chime.enabled} onChange={(enabled) => set((x) => ({ chime: { ...x.chime, enabled } }))} />
          {s.chime.enabled && (
            <Slider value={s.chime.volume} onChange={(volume) => set((x) => ({ chime: { ...x.chime, volume } }))} />
          )}
        </div>
      </Row>
      <div class="panel-sub">Athan</div>
      {PRAYERS.map((p) => (
        <Row label={PERIOD_NAMES[p]}>
          <SoundPicker
            choice={s.sounds[p]}
            kind={p === 'fajr' ? 'fajr' : 'athan'}
            onChange={(c) => set((x) => ({ sounds: { ...x.sounds, [p]: c } }))}
          />
        </Row>
      ))}
      <Row label="Tahajjud" hint="An athan at the start of the last third of the night.">
        <SoundPicker choice={s.tahajjud} kind="athan" onChange={(tahajjud) => set(() => ({ tahajjud }))} />
      </Row>
      <div class="panel-sub">Your recordings</div>
      {uploads.value
        .filter((u) => u.kind === 'audio')
        .map((u) => (
          <Row label={u.name} hint={u.kind === 'audio' && u.durationSec ? `${Math.round(u.durationSec)} s` : undefined}>
            <button class="btn small" onClick={() => removeUpload(u.id)}>
              Delete
            </button>
          </Row>
        ))}
      <div class="panel-actions">
        <label class="btn">
          Upload an athan (MP3, M4A, OGG)
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={async (e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              setError('');
              try {
                const durationSec = await audioDuration(file);
                await addUpload<AudioUpload>({ kind: 'audio', name: file.name.replace(/\.[^.]+$/, ''), durationSec, blob: file });
              } catch (err) {
                setError(String((err as Error).message ?? err));
              }
            }}
          />
        </label>
      </div>
      {error && <div class="loc-error">{error}</div>}
    </>
  );
}

function BackgroundsSection() {
  const day = clock.value?.now ?? new Date();
  return (
    <>
      <p class="panel-note">
        Each part of the day has a set of photos for the calligraphy theme and the athan screen, and shows a different one each
        day. Choose any photos from the gallery, or add your own.
      </p>
      {BG_SLOTS.map((slot) => {
        // Today's photo first, then the days after it.
        const set = upcomingBackgrounds(slot, day);
        const choice = settings.value.backgrounds[slot];
        const items: ViewItem[] = set.map((photo) => ({ kind: 'background', photo, slot }));
        return (
          <div class="bg-slot">
            <div class="bg-slot-head">
              <div>
                <div class="bg-slot-name">{BG_SLOT_NAMES[slot]}</div>
                <div class="bg-slot-count">
                  {choice === 'all' ? 'All ' : ''}
                  {set.length} {set.length === 1 ? 'photo' : 'photos'}
                  {choice === null || !chosenBackgrounds(slot).length ? ' · suggested' : ''}
                </div>
              </div>
              <button class="btn small" onClick={() => (picking.value = slot)}>
                Choose photos
              </button>
            </div>
            <div class="bg-thumbs">
              {set.map((p, i) => (
                <button
                  class={`bg-thumb ${i === 0 ? 'showing' : ''}`}
                  aria-label={`Preview ${p.title}`}
                  onClick={() => (viewer.value = { items, index: i })}
                >
                  <PhotoThumb photo={p} />
                  {i === 0 && <span class="bg-today">Today</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TabletSection() {
  return (
    <>
      <div class="panel-actions">
        <button class="btn" onClick={toggleFullscreen}>
          Toggle full screen
        </button>
        <button
          class="btn"
          onClick={() => {
            if (confirm('Reset all settings? Uploaded photos and recordings are kept.')) {
              settings.value = { ...DEFAULT_SETTINGS, place: settings.value.place };
            }
          }}
        >
          Reset settings
        </button>
      </div>
      <p class="panel-note">
        For a wall-mounted tablet, open this page in <b>Fully Kiosk Browser</b> (Android): set it as the start URL, enable
        "Autoplay audio" and "Enable JavaScript Interface" (for night brightness), "Keep screen on" and "Launch on boot". In plain
        Chrome, use "Add to Home screen"; the athan sound then needs one tap after each restart.
      </p>
      <p class="panel-note">
        Prayer times are calculated on this tablet. Settings, photos and recordings are stored only in this browser.
        {underFully() ? ' Running under Fully Kiosk Browser.' : ''}
      </p>
      <div class="panel-sub">Sources</div>
      <p class="panel-note">
        Quran text from{' '}
        <a href="https://tanzil.net" target="_blank" rel="noreferrer">
          Tanzil.net
        </a>{' '}
        (Uthmani), English translation Saheeh International. Hadith from the hadith-api collection, numbered as on sunnah.com;
        only sahih and hasan narrations. Prayer times by adhan-js. Weather by Open-Meteo. Photo and recording credits:{' '}
        <a href="/gallery/CREDITS.md" target="_blank" rel="noreferrer">
          photos
        </a>
        ,{' '}
        <a href="/audio/CREDITS.md" target="_blank" rel="noreferrer">
          athans
        </a>
        .
      </p>
    </>
  );
}

const RENDER: Record<Section, () => preact.JSX.Element | null> = {
  place: PlaceSection,
  times: TimesSection,
  iqamah: IqamahSection,
  display: DisplaySection,
  night: NightSection,
  sound: SoundSection,
  backgrounds: BackgroundsSection,
  preview: () => (clock.value ? <PreviewSection st={clock.value} /> : null),
  tablet: TabletSection,
};

export function SettingsPanel() {
  const [section, setSection] = useState<Section>('display');
  const Body = RENDER[section];
  const close = () => {
    stopPreview();
    picking.value = null;
    settingsOpen.value = false;
  };
  return (
    <div class="settings" inert={picking.value !== null} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div class="panel">
        <nav class="panel-nav">
          <div class="panel-title">Settings</div>
          {(Object.keys(SECTIONS) as Section[]).map((k) => (
            <button class={k === section ? 'on' : ''} onClick={() => setSection(k)}>
              {SECTIONS[k]}
            </button>
          ))}
        </nav>
        <div class="panel-body">
          <div class="panel-head">
            <h2>{SECTIONS[section]}</h2>
            <button class="panel-close" aria-label="Close settings" onClick={close}>
              ×
            </button>
          </div>
          <Body />
        </div>
      </div>
    </div>
  );
}
