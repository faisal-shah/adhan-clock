#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build the religious-text content of the app from a list of references.

Reads scripts/content/selection.json (references and extraction rules only),
fetches every Arabic text and English translation from the upstream sources,
extracts the selected passages, validates them and writes
src/content/daily.json and src/content/events.json.

Sources:
  Quran   api.alquran.cloud, editions quran-uthmani + en.sahih
  Hadith  fawazahmed0/hadith-api (GitHub), pinned to HADITH_API_COMMIT

Usage:
  uv run scripts/content/build.py             fetch (cached), validate, write
  uv run scripts/content/build.py --check     exit 1 if the committed files are stale
  uv run scripts/content/build.py --show      also print every extracted passage
  uv run scripts/content/build.py --tokens    also print indexed Arabic tokens (for "words")
  uv run scripts/content/build.py --offline   use the download cache only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SELECTION = Path(__file__).resolve().with_name("selection.json")
OUT_DIR = ROOT / "src" / "content"

QURAN_URL = "https://api.alquran.cloud/v1/ayah/{surah}:{ayah}/editions/quran-uthmani,en.sahih"
HADITH_API_COMMIT = "df57907be35291c91ad6a6691180e22ca9920784"
# raw.githubusercontent.com serves any file at a pinned commit; jsDelivr
# refuses commit-pinned files of this repository (package over 150 MB).
HADITH_BASE = f"https://raw.githubusercontent.com/fawazahmed0/hadith-api/{HADITH_API_COMMIT}"
HADITH_URL = HADITH_BASE + "/editions/{lang}-{book}/{number}.json"
HADITH_INFO_URL = HADITH_BASE + "/info.min.json"

# Display names follow sunnah.com. The two Sahihs are accepted as they are;
# Sunan hadith must be graded sahih or hasan by every grader in hadith-api.
BOOKS = {
    "bukhari": ("Sahih al-Bukhari", True),
    "muslim": ("Sahih Muslim", True),
    "abudawud": ("Sunan Abi Dawud", False),
    "tirmidhi": ("Jami' at-Tirmidhi", False),
    "nasai": ("Sunan an-Nasa'i", False),
    "ibnmajah": ("Sunan Ibn Majah", False),
}
DISPLAY_GRADER = "Al-Albani"
GRADE_OK = re.compile(r"\b(Sahih|Hasan)\b")
# Weak, fabricated, or not attributed to the Prophet (companion/successor words).
GRADE_BAD = re.compile(r"(?i)daif|munkar|shadh|mawdu|batil|maqtu|muquf|mauquf|mursal|malool")

DAILY_TYPES = ("ayah", "hadith", "dua")
DAILY_MAX_AR = 200
DAILY_MAX_EN = 230
TAGLINE_MAX_EN = 60
PRAYER_TAGLINES = ("dhuhr", "asr", "maghrib", "isha", "jumuah", "tahajjud", "duha")
EVENT_TEXTS = ("duaAfterAthan", "iftarDua", "suhoorReminder", "fajrTagline")

ARABIC_LETTER = re.compile(r"[\u0621-\u064a\u0671-\u06d3]")
# Harakat, Quranic annotation marks and tatweel: ignored when comparing skeletons.
ARABIC_MARKS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]")
# Tokens made only of these are trimmed from the ends of an Arabic passage
# (punctuation and Quranic pause / section marks).
ARABIC_EDGE = ".,:;!?'()-\u060c\u061b\u061f\u06d4\u06d6\u06d7\u06d8\u06d9\u06da\u06db\u06dc\u06de\u06e9"
INVISIBLE = re.compile(r"[\ufeff\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]")
EN_EDGE = " ,;:-\u2013\u2014"
# Typographic normalisation of the English sources (curly to straight quotes,
# backtick used for ayn to the transliteration letter).
EN_CHARS = str.maketrans({"\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'", "`": "\u02bf"})

SHOW_TOKENS = False


class ContentError(Exception):
    pass


# --------------------------------------------------------------------------
# Fetching


class Fetcher:
    def __init__(self, cache_dir: Path, offline: bool):
        self.cache_dir = cache_dir
        self.offline = offline
        cache_dir.mkdir(parents=True, exist_ok=True)

    def json(self, url: str):
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("://", 1)[1])
        digest = hashlib.sha256(url.encode()).hexdigest()[:12]
        path = self.cache_dir / f"{name[-120:]}.{digest}"
        if not path.exists():
            if self.offline:
                raise ContentError(f"not cached (offline): {url}")
            path.write_bytes(self._download(url))
        return json.loads(path.read_bytes())

    @staticmethod
    def _download(url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": "adhan-clock-content-build"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    body = resp.read()
                json.loads(body)
                return body
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                client_error = isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 429
                if attempt == 3 or client_error:
                    raise ContentError(f"download failed: {url}: {exc}") from exc
                time.sleep(1.5 * (attempt + 1))
        raise AssertionError("unreachable")


# --------------------------------------------------------------------------
# Text helpers


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", INVISIBLE.sub("", text)).strip()


def skeleton(word: str) -> str:
    return ARABIC_MARKS.sub("", word)


def trim_arabic(tokens: list[str]) -> str:
    while tokens and all(c in ARABIC_EDGE for c in tokens[0]):
        tokens = tokens[1:]
    while tokens and all(c in ARABIC_EDGE for c in tokens[-1]):
        tokens = tokens[:-1]
    if not tokens:
        raise ContentError("Arabic passage is empty after trimming")
    return " ".join(tokens).strip(ARABIC_EDGE + " ")


def quoted_segments(text: str) -> list[str]:
    return text.split('"')[1::2]


def tidy_english(text: str) -> str:
    """Edge clean-up of an extracted passage; never changes its words.

    Fixes spacing before punctuation, drops a quote mark the cut left
    unmatched at an edge, upper-cases the first letter and ends the passage
    with a full stop (hadith-api drops the closing punctuation of most texts).
    """
    text = re.sub(r"\s+([,;:.!?])", r"\1", text).strip(EN_EDGE)
    dangling = False
    if text.count('"') % 2:
        if text.endswith('"'):
            text = text[:-1].rstrip(EN_EDGE)
        elif text.startswith('"'):
            text = text[1:].lstrip(EN_EDGE)
        else:
            dangling = True
    core, closing = re.fullmatch(r"(.*?)(['\"]*)", text, re.S).groups()
    core = core.rstrip(EN_EDGE)
    if core and core[-1] not in ".!?":
        core += "."
    text = core + closing + ('"' if dangling else "")
    return text[:1].upper() + text[1:]


def is_balanced(text: str) -> bool:
    pairs = {")": "(", "]": "["}
    stack: list[str] = []
    for c in text:
        if c in "([":
            stack.append(c)
        elif c in ")]" and (not stack or stack.pop() != pairs[c]):
            return False
    return not stack and text.count('"') % 2 == 0


# --------------------------------------------------------------------------
# Passage extraction


def check_quote(quote) -> None:
    if quote is not None and (type(quote) is not int or quote < 0):
        raise ContentError(f"quote must be a non-negative integer or null, got {quote!r}")


def extract_arabic(text: str, spec: dict | None, default_quote: int | None) -> tuple[str, bool]:
    """Return (passage, is_partial).

    spec.quote: take the n-th quoted segment (sunnah.com marks the Prophet's
    words with quotes, which separates the matn from the isnad).
    spec.words: [start, end] slice of the whitespace tokens (null = open end).
    """
    spec = spec or {}
    unknown = set(spec) - {"quote", "words"}
    if unknown:
        raise ContentError(f"unknown Arabic spec keys {sorted(unknown)}")
    quote = spec.get("quote", default_quote)
    check_quote(quote)
    words = spec.get("words")
    if "words" in spec and not (
        isinstance(words, list) and len(words) == 2 and all(w is None or type(w) is int for w in words)
    ):
        raise ContentError(f"ar.words must be [start, end] with integers or null, got {words!r}")
    if quote is not None:
        segments = quoted_segments(text)
        if quote >= len(segments):
            raise ContentError(f"Arabic quote {quote} not found ({len(segments)} quoted segments)")
        text = segments[quote]
    tokens = collapse(text.replace('"', " ")).split(" ")
    if SHOW_TOKENS:
        print("    tokens: " + " ".join(f"{i}:{t}" for i, t in enumerate(tokens)))
    partial = False
    if "words" in spec:
        start, end = spec["words"]
        sliced = tokens[start:end]
        partial = len(sliced) != len(tokens)
        tokens = sliced
    return trim_arabic(tokens), partial


def extract_english(text: str, spec: dict | None, default_quote: int | None) -> tuple[str, str]:
    """Return (passage, dropped) where dropped is the source text left out.

    spec.quote: take the n-th double-quoted segment.
    spec.from / spec.to: take the span from the first occurrence of "from"
    to the end of the next occurrence of "to" (either may be omitted).
    """
    spec = spec or {}
    unknown = set(spec) - {"quote", "from", "to"}
    if unknown:
        raise ContentError(f"unknown English spec keys {sorted(unknown)}")
    for key in ("from", "to"):
        if key in spec and not (isinstance(spec[key], str) and spec[key].strip()):
            raise ContentError(f"en.{key} must be a non-empty string, got {spec[key]!r}")
    if "quote" in spec and ("from" in spec or "to" in spec):
        raise ContentError("en.quote cannot be combined with en.from/en.to")
    check_quote(spec.get("quote"))
    full = collapse(text).translate(EN_CHARS)
    if "from" in spec or "to" in spec:
        start = full.find(spec["from"]) if "from" in spec else 0
        if start < 0:
            raise ContentError(f"English anchor not found: {spec['from']!r}")
        end = len(full)
        if "to" in spec:
            found = full.find(spec["to"], start)
            if found < 0:
                raise ContentError(f"English anchor not found after start: {spec['to']!r}")
            end = found + len(spec["to"])
        return tidy_english(full[start:end]), full[:start] + " " + full[end:]
    quote = spec.get("quote", default_quote)
    if quote is not None:
        segments = quoted_segments(full + '"')
        if quote >= len(segments):
            raise ContentError(f"English quote {quote} not found")
        return tidy_english(segments[quote]), ""
    return tidy_english(full), ""


# --------------------------------------------------------------------------
# Sources


@dataclass
class Passage:
    arabic: str
    english: str
    ref: str
    slug: str


class Quran:
    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self._basmala: list[str] | None = None

    def _ayah(self, surah: int, ayah: int) -> tuple[str, str, str]:
        data = self.fetcher.json(QURAN_URL.format(surah=surah, ayah=ayah))
        if data.get("code") != 200 or len(data.get("data", [])) != 2:
            raise ContentError(f"unexpected Quran API response for {surah}:{ayah}")
        ar, en = data["data"]
        if (ar["edition"]["identifier"], en["edition"]["identifier"]) != ("quran-uthmani", "en.sahih"):
            raise ContentError(f"unexpected editions for {surah}:{ayah}")
        for part in (ar, en):
            if part["surah"]["number"] != surah or part["numberInSurah"] != ayah:
                raise ContentError(f"Quran API returned the wrong ayah for {surah}:{ayah}")
        arabic = collapse(ar["text"])
        if ayah == 1 and surah not in (1, 9):
            arabic = self._strip_basmala(arabic, surah)
        return arabic, collapse(en["text"]), ar["surah"]["englishName"]

    def _strip_basmala(self, arabic: str, surah: int) -> str:
        """quran-uthmani prefixes ayah 1 of most surahs with the basmala."""
        if self._basmala is None:
            basmala, _, _ = self._ayah(1, 1)
            self._basmala = [skeleton(w) for w in basmala.split(" ")]
        words = arabic.split(" ")
        n = len(self._basmala)
        if [skeleton(w) for w in words[:n]] != self._basmala:
            raise ContentError(f"{surah}:1 does not start with the basmala")
        return " ".join(words[n:])

    def passage(self, item: dict) -> Passage:
        match = re.fullmatch(r"(\d+):(\d+)(?:-(\d+))?", item["ayah"])
        if not match:
            raise ContentError(f"bad ayah reference {item['ayah']!r}")
        surah, first = int(match[1]), int(match[2])
        last = int(match[3] or first)
        if not (1 <= surah <= 114 and 1 <= first < last + 1):
            raise ContentError(f"bad ayah reference {item['ayah']!r}")
        parts = [self._ayah(surah, a) for a in range(first, last + 1)]
        arabic, ar_partial = extract_arabic(" ".join(p[0] for p in parts), item.get("ar"), None)
        english, dropped = extract_english(" ".join(p[1] for p in parts), item.get("en"), None)
        # Words of the ayah may only be dropped from both languages together;
        # English alone may drop the translator's [bracketed] framing.
        dropped_words = re.sub(r"\[[^\]]*\]|[^A-Za-z]", "", dropped)
        if dropped_words and not ar_partial:
            raise ContentError(f"{item['ayah']}: English excerpt drops words but the Arabic is whole")
        if ar_partial and not dropped_words:
            raise ContentError(f"{item['ayah']}: Arabic is an excerpt but the English is whole")
        verses = f"{surah}:{first}" + (f"-{last}" if last != first else "")
        ref = f"{parts[0][2]} {verses}"
        if ar_partial:
            ref = f"From {ref}"
        return Passage(arabic, english, ref, verses.replace(":", "-"))


class Hadith:
    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self._muslim_index: dict[str, int] | None = None

    def _muslim_hadithnumber(self, number: str) -> int:
        """Map a sunnah.com Sahih Muslim number (e.g. 2564c) to hadith-api's sequence."""
        if self._muslim_index is None:
            info = self.fetcher.json(HADITH_INFO_URL)
            self._muslim_index = {
                str(h["arabicnumber"]): h["hadithnumber"]
                for h in info["muslim"]["hadiths"]
                if h.get("arabicnumber") is not None
            }
        match = re.fullmatch(r"(\d+)([a-z]?)", number)
        if not match:
            raise ContentError(f"bad Sahih Muslim number {number!r}")
        key = match[1] + (f".{ord(match[2]) - ord('a') + 1:02d}" if match[2] else "")
        if key not in self._muslim_index:
            hint = " (it has variants: add the letter)" if f"{match[1]}.01" in self._muslim_index else ""
            raise ContentError(f"Sahih Muslim {number} is not in hadith-api{hint}")
        return self._muslim_index[key]

    @staticmethod
    def _display_number(book: str, arabicnumber) -> str:
        text = str(arabicnumber)
        if book == "muslim" and "." in text:
            base, variant = text.split(".")
            return base + chr(ord("a") + int(variant) - 1)
        return text

    def _fetch(self, lang: str, book: str, seq: int) -> dict:
        data = self.fetcher.json(HADITH_URL.format(lang=lang, book=book, number=seq))
        hadiths = data["hadiths"]
        if len(hadiths) != 1 or hadiths[0]["hadithnumber"] != seq:
            raise ContentError(f"unexpected hadith-api payload for {lang}-{book}/{seq}")
        return hadiths[0]

    def passage(self, item: dict) -> Passage:
        book, number = item["book"], str(item["number"])
        if book not in BOOKS:
            raise ContentError(f"unsupported hadith collection {book!r}")
        name, is_sahih = BOOKS[book]
        seq = self._muslim_hadithnumber(number) if book == "muslim" else int(number)
        eng = self._fetch("eng", book, seq)
        ara = self._fetch("ara", book, seq)
        for edition in (eng, ara):
            got = self._display_number(book, edition.get("arabicnumber"))
            if got != number:
                raise ContentError(f"{name} {number}: hadith-api numbering mismatch (got {got})")
        ref = f"{name} {number}"
        if not is_sahih:
            grades = {g["name"]: g["grade"].strip() for g in eng["grades"]}
            rejected = {k: v for k, v in grades.items() if not GRADE_OK.search(v) or GRADE_BAD.search(v)}
            if DISPLAY_GRADER not in grades or rejected:
                raise ContentError(f"{ref}: grade not accepted: {grades}")
            ref += f" ({grades[DISPLAY_GRADER].lower()})"
        arabic, ar_partial = extract_arabic(ara["text"], item.get("ar"), 0)
        english, _ = extract_english(eng["text"], item.get("en"), 0)
        if ar_partial:
            ref = f"From {ref}"
        return Passage(arabic, english, ref, f"{book}-{number}")


# --------------------------------------------------------------------------
# Build


def resolve(item: dict, quran: Quran, hadith: Hadith) -> Passage:
    if "ayah" in item:
        return quran.passage(item)
    if "book" in item:
        return hadith.passage(item)
    raise ContentError(f"item needs 'ayah' or 'book': {item}")


def check_passage(where: str, p: Passage, max_ar: int | None, max_en: int | None) -> list[str]:
    errors = []
    for field in ("arabic", "english", "ref"):
        if not getattr(p, field).strip():
            errors.append(f"{where}: empty {field}")
    if not ARABIC_LETTER.search(p.arabic):
        errors.append(f"{where}: Arabic has no Arabic letters")
    if re.search(r"[A-Za-z]", p.arabic):
        errors.append(f"{where}: Latin letters in Arabic")
    if ARABIC_LETTER.search(p.english) or ARABIC_LETTER.search(p.ref):
        errors.append(f"{where}: Arabic letters in English/ref")
    if "\ufffd" in p.arabic + p.english or INVISIBLE.search(p.arabic + p.english):
        errors.append(f"{where}: replacement or invisible control characters in text")
    if re.match(r"(?i)(narrated|it was narrated|\S+( \S+){0,6} (reported|narrated|said:))", p.english):
        errors.append(f"{where}: English still starts with a narrator chain")
    if not is_balanced(p.english):
        errors.append(f"{where}: unbalanced brackets/quotes in English")
    if max_ar is not None and len(p.arabic) > max_ar:
        errors.append(f"{where}: Arabic is {len(p.arabic)} chars (max {max_ar})")
    if max_en is not None and len(p.english) > max_en:
        errors.append(f"{where}: English is {len(p.english)} chars (max {max_en})")
    return errors


def interleave(items: list[dict]) -> list[dict]:
    """Order the rotation ayah, hadith, dua, ayah, ... so neighbours differ."""
    queues = {t: [i for i in items if i["type"] == t] for t in DAILY_TYPES}
    out: list[dict] = []
    while any(queues.values()):
        for t in DAILY_TYPES:
            if queues[t]:
                out.append(queues[t].pop(0))
    return out


def build(selection: dict, fetcher: Fetcher, show: bool) -> tuple[list[dict], dict, list[str]]:
    quran, hadith = Quran(fetcher), Hadith(fetcher)
    errors: list[str] = []
    rows: list[tuple[str, str, Passage]] = []

    def get(where: str, item: dict) -> Passage | None:
        if SHOW_TOKENS:
            print(f"{where}: {item.get('ayah') or item.get('book', '') + ' ' + str(item.get('number'))}")
        try:
            return resolve(item, quran, hadith)
        except (ContentError, KeyError) as exc:
            errors.append(f"{where}: {exc}")
            return None

    daily: list[dict] = []
    for n, item in enumerate(selection["daily"]):
        kind = item.get("type")
        where = f"daily[{n}]"
        if kind not in DAILY_TYPES:
            errors.append(f"{where}: bad type {kind!r}")
            continue
        p = get(where, item)
        if p is None:
            continue
        item_id = f"{kind}-{p.slug}"
        errors += check_passage(f"{where} {item_id}", p, DAILY_MAX_AR, DAILY_MAX_EN)
        daily.append({"id": item_id, "type": kind, "arabic": p.arabic, "english": p.english, "ref": p.ref})
        rows.append((item_id, kind, p))
    ids = [d["id"] for d in daily]
    sources = [i.split("-", 1)[1] for i in ids]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"daily: duplicate id {dup}")
    for dup in sorted({s for s in sources if sources.count(s) > 1}):
        errors.append(f"daily: source {dup} is used under more than one type")

    sel_events = selection["events"]
    if set(sel_events) != {*EVENT_TEXTS, "prayerTaglines"}:
        errors.append(f"events: expected keys {EVENT_TEXTS} + prayerTaglines, got {sorted(sel_events)}")
    if set(sel_events.get("prayerTaglines", {})) != set(PRAYER_TAGLINES):
        errors.append(f"events.prayerTaglines: expected keys {PRAYER_TAGLINES}")
    events: dict = {}
    for key in EVENT_TEXTS:
        spec = dict(sel_events.get(key, {}))
        ref = spec.pop("ref", None)
        p = get(f"events.{key}", spec)
        if p is None:
            continue
        if ref is not None:
            p.ref = ref
        max_en = TAGLINE_MAX_EN if key == "fajrTagline" else None
        errors += check_passage(f"events.{key}", p, None, max_en)
        events[key] = {"arabic": p.arabic, "english": p.english, "ref": p.ref}
        rows.append((key, "event", p))
    events["prayerTaglines"] = {}
    for prayer in PRAYER_TAGLINES:
        spec = sel_events.get("prayerTaglines", {}).get(prayer)
        if spec is None:
            continue
        p = get(f"events.prayerTaglines.{prayer}", spec)
        if p is None:
            continue
        errors += check_passage(f"events.prayerTaglines.{prayer}", p, None, TAGLINE_MAX_EN)
        events["prayerTaglines"][prayer] = {"arabic": p.arabic, "english": p.english, "ref": p.ref}
        rows.append((prayer, "tagline", p))

    counts = {t: sum(1 for d in daily if d["type"] == t) for t in DAILY_TYPES}
    for t, c in counts.items():
        if not 25 <= c <= 35:
            errors.append(f"daily: {c} {t} items (expected about 30)")

    print_table(rows, show)
    print(
        f"\ndaily: {len(daily)} items ({', '.join(f'{c} {t}' for t, c in counts.items())}); "
        f"events: {len(events) - 1} texts + {len(events['prayerTaglines'])} prayer taglines"
    )
    return interleave(daily), events, errors


def print_table(rows: list[tuple[str, str, Passage]], show: bool) -> None:
    print(f"\n{'id':<30} {'type':<8} {'ar':>4} {'en':>4}  ref")
    print("-" * 88)
    for item_id, kind, p in rows:
        print(f"{item_id:<30} {kind:<8} {len(p.arabic):>4} {len(p.english):>4}  {p.ref}")
        if show:
            print(f"    AR: {p.arabic}")
            print(f"    EN: {p.english}")


def dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    global SHOW_TOKENS
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    default_cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "adhan-clock-content"
    parser.add_argument(
        "--cache", type=Path, default=default_cache, help="download cache directory (default: %(default)s)"
    )
    parser.add_argument("--offline", action="store_true", help="use only cached downloads")
    parser.add_argument("--check", action="store_true", help="verify the committed output is up to date; write nothing")
    parser.add_argument("--show", action="store_true", help="print every extracted passage")
    parser.add_argument("--tokens", action="store_true", help="print indexed Arabic tokens of each source text")
    args = parser.parse_args()
    SHOW_TOKENS = args.tokens

    try:
        selection = json.loads(SELECTION.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: cannot read {SELECTION}: {exc}", file=sys.stderr)
        return 2
    try:
        daily, events, errors = build(selection, Fetcher(args.cache, args.offline), args.show)
    except ContentError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if errors:
        print(f"\n{len(errors)} validation error(s):", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        return 1

    outputs = {OUT_DIR / "daily.json": dump(daily), OUT_DIR / "events.json": dump(events)}
    if args.check:
        stale = [p for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        for p in stale:
            print(f"stale: {p.relative_to(ROOT)}", file=sys.stderr)
        if not stale:
            print("up to date")
        return 1 if stale else 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path, text in outputs.items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
