import { useState } from 'preact/hooks';
import { stopAthan } from '../../audio';
import { nextHijriDate } from '../../core/calendar';
import { travelTo } from '../../core/clock';
import type { CalligraphyArt } from '../../core/media';
import { addDays, computeDay, startOfDay } from '../../core/prayer';
import { PERIOD_NAMES, type ClockState, type PeriodKey } from '../../core/schedule';
import { BG_SLOTS, GALLERY_CATEGORIES, type GalleryCategory, type ThemeKey } from '../../core/settings';
import {
  bundledBackgrounds,
  calligraphyArt,
  dismissed,
  gallery,
  previewTheme,
  settings,
  settingsOpen,
  viewer,
  type ViewItem,
} from '../../store';
import { Phrase } from '../parts';
import { viewLabel } from '../Viewer';
import { Segmented } from './controls';

const MIN = 60_000;

interface Moment {
  label: string;
  at: Date;
  /** Force a theme for the preview (the clock would otherwise pick its own). */
  theme?: ThemeKey;
}

function moments(st: ClockState): { title: string; note: string; items: Moment[] }[] {
  const s = settings.value;
  const today = startOfDay(st.now);
  const t = st.today;
  const plus = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
  const dayAt = (d: Date) => computeDay(d, s);

  const friday = addDays(today, (5 - today.getDay() + 7) % 7);
  const fri = dayAt(friday);
  const ramadan = nextHijriDate(addDays(today, 1), 9, 3, s.hijriOffset);
  const fitr = nextHijriDate(addDays(today, 1), 10, 1, s.hijriOffset);
  const adha = nextHijriDate(addDays(today, 1), 12, 10, s.hijriOffset);
  const at = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const seasons: Moment[] = [{ label: `Jumu'ah · ${fmt(friday)}`, at: plus(fri.dhuhr, 10), theme: 'calligraphy' }];
  seasons.push({ label: `Jumu'ah athan · ${fmt(friday)}`, at: plus(fri.dhuhr, -65 / 60) });
  if (ramadan) {
    const r = dayAt(ramadan);
    seasons.push(
      { label: `Ramadan · suhoor · ${fmt(ramadan)}`, at: plus(r.fajr, -40) },
      { label: `Ramadan · before iftar · ${fmt(ramadan)}`, at: plus(r.maghrib, -30) },
      { label: `Ramadan · iftar athan · ${fmt(ramadan)}`, at: plus(r.maghrib, -65 / 60) },
    );
  }
  if (fitr) seasons.push({ label: `Eid al-Fitr · ${fmt(fitr)}`, at: at(fitr, 10) });
  if (adha) seasons.push({ label: `Eid al-Adha · ${fmt(adha)}`, at: at(adha, 10) });

  return [
    {
      title: 'Athan sequences',
      note: 'Lands a minute before the athan: countdown, athan with sound, dua, then the theme.',
      items: [
        ...st.slots.map((slot) => ({ label: `${PERIOD_NAMES[slot.name]} athan`, at: plus(slot.athan, -65 / 60) })),
        { label: `${PERIOD_NAMES[st.slots[1].name]} iqamah`, at: plus(st.slots[1].iqamah, -70 / 60) },
        ...(s.tahajjud.enabled ? [{ label: 'Tahajjud athan', at: plus(st.tahajjud, -5 / 60) }] : []),
      ],
    },
    {
      title: 'Through the day',
      note: 'The calligraphy theme at each part of the day, then the night theme.',
      items: [
        ...(['fajr', 'sunrise', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'] as PeriodKey[]).map((p) => {
          const base = p === 'sunrise' ? plus(t.sunrise, 5) : p === 'duha' ? plus(t.sunrise, 90) : plus(t[p as 'fajr'], 10);
          return { label: PERIOD_NAMES[p], at: base, theme: 'calligraphy' as const };
        }),
        { label: 'Last third of the night', at: plus(st.tahajjud, 5), theme: 'calligraphy' },
        { label: 'Night theme', at: plus(t.isha, s.night.startAfterIsha + 5), theme: 'night' },
      ],
    },
    {
      title: 'Seasons',
      note: 'Real dates from the Hijri calendar, with the greetings, suhoor and iftar countdowns and the iftar dua.',
      items: seasons,
    },
  ];
}

function MomentsTab({ st }: { st: ClockState }) {
  const go = (m: Moment) => {
    dismissed.value = new Set();
    stopAthan();
    previewTheme.value = m.theme ?? null;
    travelTo(m.at);
    settingsOpen.value = false;
  };
  return (
    <>
      {moments(st).map((g) => (
        <div class="pv-group">
          <div class="panel-sub">{g.title}</div>
          <p class="panel-note">{g.note}</p>
          <div class="preview-grid">
            {g.items.map((m) => (
              <button class="btn" onClick={() => go(m)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p class="panel-note">A bar at the top shows the date being previewed; fast-forward runs the clock at 60×.</p>
    </>
  );
}

const open = (items: ViewItem[], index: number) => (viewer.value = { items, index });

function Tile({
  items,
  index,
  image,
  children,
  wide = false,
}: {
  items: ViewItem[];
  index: number;
  image?: string;
  children?: preact.ComponentChildren;
  wide?: boolean;
}) {
  return (
    <button class={`pv-tile ${wide ? 'wide' : ''}`} onClick={() => open(items, index)}>
      <span class="pv-thumb" style={image ? { backgroundImage: `url(${image})` } : undefined}>
        {children}
      </span>
      <span class="pv-label">{viewLabel(items[index])}</span>
    </button>
  );
}

function ThemesTab() {
  const items: ViewItem[] = (
    [
      ['calligraphy', 'Calligraphy'],
      ['classic', 'Classic'],
      ['kids', 'Kids'],
      ['gallery', 'Gallery'],
      ['night', 'Night'],
    ] as [ThemeKey, string][]
  ).map(([theme, label]) => ({ kind: 'theme', theme, label }));
  return (
    <>
      <p class="panel-note">Each theme as it looks right now.</p>
      <div class="pv-grid">
        {items.map((it, i) => (
          <Tile items={items} index={i}>
            <span class={`pv-swatch t-${(it as { theme: ThemeKey }).theme}`} />
          </Tile>
        ))}
      </div>
    </>
  );
}

function BackgroundsTab() {
  const items: ViewItem[] = BG_SLOTS.flatMap((slot) =>
    bundledBackgrounds.value.filter((b) => b.slot === slot).map((bg) => ({ kind: 'background' as const, bg })),
  );
  return (
    <>
      <p class="panel-note">Every photo as the calligraphy theme shows it. Open one to keep it for its time of day.</p>
      {BG_SLOTS.map((slot) => (
        <div class="pv-group">
          <div class="panel-sub">
            {PERIOD_NAMES[({ night: 'tahajjud' } as Record<string, PeriodKey>)[slot] ?? (slot as PeriodKey)]}
          </div>
          <div class="pv-grid">
            {items.map((it, i) =>
              it.kind === 'background' && it.bg.slot === slot ? (
                <Tile items={items} index={i} image={`/backgrounds/${it.bg.fileSm}`} />
              ) : null,
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function GalleryTab() {
  const cats = (Object.keys(GALLERY_CATEGORIES) as GalleryCategory[]).filter((c) => c !== 'calligraphy');
  const items: ViewItem[] = cats.flatMap((c) =>
    gallery.value.filter((g) => g.category === c).map((item) => ({ kind: 'gallery' as const, item })),
  );
  return (
    <>
      {cats.map((c) => (
        <div class="pv-group">
          <div class="panel-sub">{GALLERY_CATEGORIES[c]}</div>
          <div class="pv-grid">
            {items.map((it, i) =>
              it.kind === 'gallery' && it.item.category === c ? (
                <Tile items={items} index={i} image={`/gallery/${it.item.file}`} />
              ) : null,
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function CalligraphyTab() {
  const groups: [string, (a: CalligraphyArt) => boolean][] = [
    ['Prayer names', (a) => a.id in PERIOD_NAMES],
    ['Greetings and phrases', (a) => !(a.id in PERIOD_NAMES) && a.kind !== 'gallery'],
    ['Calligraphy pieces', (a) => a.kind === 'gallery'],
  ];
  const items: ViewItem[] = groups.flatMap(([, f]) =>
    calligraphyArt.value.filter(f).map((art) => ({ kind: 'art' as const, art })),
  );
  return (
    <>
      {groups.map(([title, f]) => (
        <div class="pv-group">
          <div class="panel-sub">{title}</div>
          <div class="pv-grid">
            {items.map((it, i) =>
              it.kind === 'art' && f(it.art) ? (
                <Tile items={items} index={i}>
                  <span class="pv-art">
                    <Phrase id={it.art.id} text={it.art.arabic ?? ''} scale={1} />
                  </span>
                </Tile>
              ) : null,
            )}
          </div>
        </div>
      ))}
    </>
  );
}

type Tab = 'moments' | 'themes' | 'backgrounds' | 'gallery' | 'calligraphy';

export function PreviewSection({ st }: { st: ClockState }) {
  const [tab, setTab] = useState<Tab>('moments');
  return (
    <>
      <div class="pv-tabs">
        <Segmented
          value={tab}
          options={[
            ['moments', 'Moments'],
            ['themes', 'Themes'],
            ['backgrounds', `Backgrounds · ${bundledBackgrounds.value.length}`],
            ['gallery', `Gallery · ${gallery.value.length}`],
            ['calligraphy', `Calligraphy · ${calligraphyArt.value.length}`],
          ]}
          onChange={setTab}
        />
      </div>
      {tab === 'moments' && <MomentsTab st={st} />}
      {tab === 'themes' && <ThemesTab />}
      {tab === 'backgrounds' && <BackgroundsTab />}
      {tab === 'gallery' && <GalleryTab />}
      {tab === 'calligraphy' && <CalligraphyTab />}
    </>
  );
}
