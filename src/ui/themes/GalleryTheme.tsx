import type { CalligraphyArt, GalleryItem } from '../../core/media';
import { startOfDay } from '../../core/prayer';
import { PERIOD_NAMES, type ClockState } from '../../core/schedule';
import { GALLERY_CATEGORIES } from '../../core/settings';
import { calligraphyArt, gallery, settings } from '../../store';
import { Clock, CountdownPill, Crossfade, GreetingMark, MakruhBadge, Phrase, T, dateLine } from '../parts';

/** A photograph, or a calligraphy piece from the artwork set. */
type Piece = { kind: 'photo'; id: string; item: GalleryItem } | { kind: 'art'; id: string; art: CalligraphyArt };

/** Today's order: a seeded shuffle, so each day walks the collection differently. */
function todaysOrder<T>(items: T[], day: number): T[] {
  // mulberry32
  let seed = day >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function currentPiece(now: Date): Piece | null {
  const g = settings.value.gallery;
  const pool: Piece[] = [
    ...gallery.value.filter((x) => g.categories[x.category]).map((item) => ({ kind: 'photo' as const, id: item.id, item })),
    ...(g.categories.calligraphy
      ? calligraphyArt.value.filter((a) => a.kind === 'gallery').map((art) => ({ kind: 'art' as const, id: art.id, art }))
      : []),
  ];
  if (!pool.length) return null;
  const day = Math.floor(startOfDay(now).getTime() / 86_400_000);
  const order = todaysOrder(pool, day);
  const slot = Math.floor((now.getTime() - startOfDay(now).getTime()) / (g.minutes * 60_000));
  return order[slot % order.length];
}

function Photo({ item }: { item: GalleryItem }) {
  const url = `/gallery/${item.file}`;
  if (item.fit === 'contain') {
    return (
      <div class="gl-photo contain">
        <img class="gl-blur" src={url} alt="" />
        <img class="gl-object" src={url} alt="" />
      </div>
    );
  }
  return (
    <div class="gl-photo">
      <img class="gl-cover" src={url} alt="" style={{ objectPosition: item.focus ?? '50% 50%' }} />
    </div>
  );
}

function ArtPiece({ art }: { art: CalligraphyArt }) {
  return (
    <div class="gl-photo gl-art">
      <div class="gl-art-pattern" />
      <div class="gl-art-piece">
        <Phrase id={art.id} text={art.arabic ?? ''} scale={1} />
      </div>
    </div>
  );
}

function caption(p: Piece): { cat: string; title: string; sub: string } {
  if (p.kind === 'photo') return { cat: GALLERY_CATEGORIES[p.item.category], title: p.item.title, sub: p.item.subtitle };
  const a = p.art;
  const clean = a.english?.replace(/[[\]]/g, '');
  const english = clean && clean.length <= 150 ? clean : '';
  return {
    cat: GALLERY_CATEGORIES.calligraphy,
    title: a.transliteration ?? a.ref ?? '',
    sub: [english && (/["“]/.test(english) ? english : `“${english}”`), a.ref].filter(Boolean).join(' · '),
  };
}

export function GalleryTheme({ st }: { st: ClockState }) {
  const piece = currentPiece(st.now);
  const item = piece?.kind === 'photo' ? piece.item : null;
  const cap = piece && caption(piece);
  return (
    <div class={`gl ${item?.fit ?? ''} ${piece?.kind === 'art' ? 'art' : ''}`}>
      <Crossfade k={piece?.id ?? 'none'} ms={2500}>
        {piece && (piece.kind === 'photo' ? <Photo item={piece.item} /> : <ArtPiece art={piece.art} />)}
      </Crossfade>
      <div class="gl-scrim" />

      <GreetingMark st={st} class="corner" />
      <div class="gl-top">
        <div class="gl-clock">
          <Clock d={st.now} />
        </div>
        <div class="gl-date">{dateLine(st.now, st.hijri)}</div>
        <CountdownPill st={st} />
        <MakruhBadge st={st} />
      </div>

      {piece && cap && (
        <div class="gl-caption" key={piece.id}>
          <div class="gl-cat">{cap.cat}</div>
          <div class="gl-title">{cap.title}</div>
          <div class="gl-sub">{cap.sub}</div>
        </div>
      )}

      <div class="gl-strip">
        {st.slots.map((slot) => (
          <div class={`gl-p ${slot.id === st.current.id ? 'current' : ''}`}>
            <span class="gl-p-name">{PERIOD_NAMES[slot.name]}</span>
            <T d={slot.athan} />
          </div>
        ))}
      </div>
    </div>
  );
}
