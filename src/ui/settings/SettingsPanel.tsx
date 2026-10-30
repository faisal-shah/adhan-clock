import { useEffect, useRef, useState } from 'preact/hooks';
import { previewSound, stopAthan } from '../../audio';
import { travelTo } from '../../core/clock';
import { deviceTimezone } from '../../core/geo';
import { toggleFullscreen, underFully } from '../../core/kiosk';
import { audioDuration, deleteUpload, newId, processImage, putUpload, type Upload } from '../../core/media';
import { addDays, startOfDay } from '../../core/prayer';
import { PERIOD_NAMES } from '../../core/schedule';
import {
  BG_SLOTS,
  CALC_METHODS,
  CALLIGRAPHY_FONTS,
  DEFAULT_SETTINGS,
  GALLERY_CATEGORIES,
  type GalleryCategory,
  HIGH_LAT_RULES,
  PRAYERS,
  type BgSlot,
  type Settings,
  type SoundChoice,
} from '../../core/settings';
import {
  backgroundFor,
  bundledAudio,
  bundledBackgrounds,
  clock,
  dismissed,
  forgetUploadUrl,
  settings,
  settingsOpen,
  updateSettings,
  uploadUrl,
  uploads,
} from '../../store';
import { T } from '../parts';
import { Row, Segmented, Select, Slider, Stepper, TimeInput, Toggle } from './controls';
import { LocationPicker } from './LocationPicker';

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

const SLOT_NAMES: Record<BgSlot, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise & Duha',
  dhuhr: "Dhuhr & Jumu'ah",
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  night: 'Night & Tahajjud',
};

const set = (patch: (s: Settings) => Partial<Settings>) => updateSettings(patch);

function PlaceSection() {
  const s = settings.value;
  const [changing, setChanging] = useState(false);
  return (
    <>
      <Row label="This clock is in" hint={s.place && `${s.place.latitude.toFixed(4)}, ${s.place.longitude.toFixed(4)}`}>
        <span class="row-value">{s.place?.name}</span>
      </Row>
      {s.place?.timezone && s.place.timezone !== deviceTimezone() && (
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
            min={-30}
            max={30}
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
            min={0}
            max={90}
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

function DisplaySection() {
  const s = settings.value;
  return (
    <>
      <Row label="Daytime theme" hint="Shown outside the calligraphy window and the night hours.">
        <Segmented
          value={s.dayTheme}
          options={[
            ['calligraphy', 'Calligraphy'],
            ['classic', 'Classic'],
            ['kids', 'Kids'],
            ['gallery', 'Gallery'],
          ]}
          onChange={(dayTheme) => set(() => ({ dayTheme }))}
        />
      </Row>
      {s.dayTheme === 'gallery' && (
        <>
          <Row label="Change the photo every">
            <Stepper
              value={s.gallery.minutes}
              min={1}
              max={60}
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
          min={0}
          max={120}
          step={5}
          unit="min"
          onChange={(calligraphyMinutes) => set(() => ({ calligraphyMinutes }))}
        />
      </Row>
      <Row label="Calligraphy style">
        <Segmented
          value={s.calligraphyFont}
          options={CALLIGRAPHY_FONTS}
          onChange={(calligraphyFont) => set(() => ({ calligraphyFont }))}
        />
      </Row>
      <Row label="24-hour clock">
        <Toggle value={s.clock24h} onChange={(clock24h) => set(() => ({ clock24h }))} />
      </Row>
      <Row label="Hijri date adjustment" hint="Shift to match local moonsighting.">
        <Stepper
          value={s.hijriOffset}
          min={-2}
          max={2}
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
              min={0}
              max={240}
              step={15}
              unit="min"
              onChange={(startAfterIsha) => setNight({ startAfterIsha })}
            />
          </Row>
          <Row label="Ends before Fajr" hint="0 keeps it dark until the Fajr athan.">
            <Stepper
              value={n.endBeforeFajr}
              min={0}
              max={120}
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
          <Slider value={choice.volume} onChange={(volume) => onChange({ ...choice, volume })} />
          <button
            class="btn small"
            onClick={() => {
              if (playing) {
                stopRef.current?.();
                setPlaying(false);
              } else {
                stopRef.current = previewSound(choice.audioId, choice.volume);
                setPlaying(true);
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

async function addUpload(u: Omit<Upload, 'id'>) {
  const full = { ...u, id: newId() } as Upload;
  await putUpload(full);
  uploads.value = [...uploads.value, full];
  return full;
}

async function removeUpload(id: string) {
  await deleteUpload(id);
  forgetUploadUrl(id);
  uploads.value = uploads.value.filter((u) => u.id !== id);
  const ref = `upload:${id}`;
  set((x) => ({
    sounds: Object.fromEntries(
      PRAYERS.map((p) => [p, x.sounds[p].audioId === ref ? DEFAULT_SETTINGS.sounds[p] : x.sounds[p]]),
    ) as Settings['sounds'],
    tahajjud: x.tahajjud.audioId === ref ? { ...x.tahajjud, audioId: DEFAULT_SETTINGS.tahajjud.audioId } : x.tahajjud,
    backgrounds: Object.fromEntries(
      BG_SLOTS.map((b) => [b, x.backgrounds[b] === ref ? 'auto' : x.backgrounds[b]]),
    ) as Settings['backgrounds'],
  }));
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
          <Row label={u.name} hint={u.durationSec ? `${Math.round(u.durationSec)} s` : undefined}>
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
                await addUpload({ kind: 'audio', name: file.name.replace(/\.[^.]+$/, ''), durationSec, blob: file });
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
  const s = settings.value;
  const [busy, setBusy] = useState<BgSlot | null>(null);
  const day = clock.value?.now ?? new Date();
  return (
    <>
      <p class="panel-note">
        Each part of the day has its own photo for the calligraphy theme. "Auto" changes it daily. Uploaded photos join the
        rotation, or tap one to keep it.
      </p>
      {BG_SLOTS.map((slot) => {
        const choice = s.backgrounds[slot];
        const showing = backgroundFor(slot, day);
        const items = [
          ...bundledBackgrounds.value
            .filter((b) => b.slot === slot)
            .map((b) => ({ id: b.id, url: `/backgrounds/${b.fileSm}`, upload: null as Upload | null })),
          ...uploads.value
            .filter((u) => u.kind === 'image' && u.slot === slot)
            .map((u) => ({ id: `upload:${u.id}`, url: uploadUrl(u), upload: u })),
        ];
        const pick = (id: string) => set((x) => ({ backgrounds: { ...x.backgrounds, [slot]: id } }));
        return (
          <div class="bg-slot">
            <div class="bg-slot-head">
              <span>{SLOT_NAMES[slot]}</span>
              <button class={`chip ${choice === 'auto' ? 'on' : ''}`} onClick={() => pick('auto')}>
                Auto
              </button>
            </div>
            <div class="bg-thumbs">
              {items.map((it) => (
                <div class={`bg-thumb ${choice === it.id ? 'pinned' : ''} ${showing?.id === it.id ? 'showing' : ''}`}>
                  <button style={{ backgroundImage: `url(${it.url})` }} onClick={() => pick(it.id)} aria-label="Use this photo" />
                  {it.upload && (
                    <button class="bg-del" aria-label="Delete photo" onClick={() => removeUpload(it.upload!.id)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              <label class={`bg-add ${busy === slot ? 'busy' : ''}`}>
                +
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const input = e.target as HTMLInputElement;
                    const file = input.files?.[0];
                    input.value = '';
                    if (!file) return;
                    setBusy(slot);
                    try {
                      const { blob, textTone } = await processImage(file);
                      const u = await addUpload({ kind: 'image', name: file.name, slot, textTone, blob });
                      pick(`upload:${u.id}`);
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              </label>
            </div>
          </div>
        );
      })}
    </>
  );
}

function PreviewSection() {
  const st = clock.value;
  if (!st) return null;
  const go = (t: Date, id?: string) => {
    if (id) dismissed.value = new Set([...dismissed.value].filter((x) => x !== id));
    stopAthan();
    travelTo(t);
    settingsOpen.value = false;
  };
  const sec = 1000;
  const friday = addDays(startOfDay(st.now), (5 - st.now.getDay() + 7) % 7);
  return (
    <>
      <p class="panel-note">
        Jump to a few seconds before an athan and watch the whole sequence with sound. A bar at the top returns to the real time.
      </p>
      <div class="preview-grid">
        {st.slots.map((slot) => (
          <button class="btn" onClick={() => go(new Date(slot.athan.getTime() - 65 * sec), slot.id)}>
            {PERIOD_NAMES[slot.name]} athan
          </button>
        ))}
        <button class="btn" onClick={() => go(new Date(st.slots[1].iqamah.getTime() - 70 * sec), st.slots[1].id)}>
          {PERIOD_NAMES[st.slots[1].name]} iqamah
        </button>
        <button
          class="btn"
          onClick={() => {
            const d = friday.getTime() === startOfDay(st.now).getTime() ? st.today.dhuhr : null;
            go(d ? new Date(d.getTime() - 65 * sec) : new Date(friday.getTime() + 12.5 * 3600 * sec));
          }}
        >
          Jumu'ah
        </button>
        <button
          class="btn"
          onClick={() => go(new Date(st.today.isha.getTime() + (settings.value.night.startAfterIsha + 5) * 60 * sec))}
        >
          Night theme
        </button>
        <button class="btn" onClick={() => go(new Date(st.today.sunrise.getTime() + 5 * 60 * sec))}>
          Sunrise
        </button>
        <button class="btn" onClick={() => go(new Date(st.today.sunrise.getTime() + 90 * 60 * sec))}>
          Duha
        </button>
        <button class="btn" onClick={() => go(new Date(st.tahajjud.getTime() - 5 * sec))}>
          Tahajjud
        </button>
      </div>
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
        <a href="/backgrounds/CREDITS.md" target="_blank" rel="noreferrer">
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
  preview: PreviewSection,
  tablet: TabletSection,
};

export function SettingsPanel() {
  const [section, setSection] = useState<Section>('display');
  const Body = RENDER[section];
  const close = () => {
    stopAthan();
    settingsOpen.value = false;
  };
  return (
    <div class="settings" onPointerDown={(e) => e.target === e.currentTarget && close()}>
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
