# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.2"]
# ///
"""Build the Gallery theme photos in public/gallery/ from scripts/gallery/manifest.json.

For every manifest entry this script:

1. downloads ``source.url`` into a cache directory and checks its SHA-256;
2. applies the EXIF orientation and converts embedded ICC profiles to sRGB;
3. trims the optional ``crop`` box (fractions of the source frame);
4. scales the result down to ``maxLongSide`` (never up) and encodes WebP,
   stepping the quality from ``quality`` down to ``minQuality`` until the file
   fits ``maxBytes``; when even ``minQuality`` is too big, it shrinks the long
   side by ``sizeStep`` and tries again, but never below ``minLongSide``
   (a very detailed photo may then stay above ``maxBytes``; the run says so);
5. measures ``textTone``.

``textTone`` is measured on the frame the theme actually shows on a
``referenceAspect`` screen (see ``display_frame``): cover items cover-fitted at
their ``focus`` (a CSS ``object-position``); contain items drawn whole inside
``containLayout.objectBox`` over a blurred, darkened full-screen copy of
themselves. ``containLayout`` mirrors ``.gl-object`` and ``.gl-blur`` in
``src/styles/gallery.css``; update both together. The mean WCAG relative
luminance (averaged in linear light) over the ``toneRegions`` (caption and
clock) decides it: "dark" when it is at least ``darkTextMinLuminance``,
otherwise "light".

It then writes ``index.json`` (consumed by the app) and ``CREDITS.md``. Every
derived value comes from this run, so the manifest is the single source of
truth. Category ids and their order come from ``GALLERY_CATEGORIES`` in
``src/core/settings.ts``.

Usage (from the repo root)::

    uv run scripts/gallery/process.py                      # build everything
    uv run scripts/gallery/process.py --only minaret-of-jam kaaba-curtain
    uv run scripts/gallery/process.py --pin                 # record sha256 for new entries
    uv run scripts/gallery/process.py --contact-sheet /tmp/gallery-sheet.png
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw, ImageFilter, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "scripts" / "gallery" / "manifest.json"
DEFAULT_OUT = REPO / "public" / "gallery"
SETTINGS_TS = REPO / "src" / "core" / "settings.ts"
DEFAULT_CACHE = Path(tempfile.gettempdir()) / "adhan-clock-gallery-src"
USER_AGENT = "adhan-clock-gallery-build/1.0 (https://github.com/faisal-shah/adhan-clock; faisal.shah@gmail.com)"
REQUEST_GAP_S = 2.0  # pause before every download; Wikimedia rate-limits bursts of original-file requests

# Sources are pinned by SHA-256, so large museum scans are trusted to decode.
Image.MAX_IMAGE_PIXELS = 400_000_000

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FOCUS_RE = re.compile(r"^(?P<x>\d{1,3})% (?P<y>\d{1,3})%$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
OUTPUT_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$")
CREDIT_KEYS = ("title", "author", "sourceUrl", "license", "licenseUrl")
INT_SETTINGS = ("maxLongSide", "minLongSide", "quality", "minQuality", "qualityStep", "maxBytes")
SETTING_KEYS = (*INT_SETTINGS, "sizeStep", "referenceAspect", "toneRegions", "darkTextMinLuminance", "containLayout")
LIMITS = {"title": 48, "subtitle": 70}
TONE_SAMPLE_WIDTH = 480  # px; luminance is a mean, so a small render is exact enough


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    maxLongSide: int
    minLongSide: int
    sizeStep: float
    quality: int
    minQuality: int
    qualityStep: int
    maxBytes: int
    referenceAspect: tuple[int, int]
    toneRegions: dict[str, dict[str, float]]
    darkTextMinLuminance: float
    containLayout: dict


# ---------------------------------------------------------------- manifest

def app_categories(path: Path) -> dict[str, str]:
    """GALLERY_CATEGORIES (id -> label, in declaration order) from the app's settings module."""
    src = path.read_text(encoding="utf-8")
    m = re.search(r"GALLERY_CATEGORIES\s*=\s*\{(?P<body>[^}]*)\}", src)
    if not m:
        raise ManifestError(f"GALLERY_CATEGORIES not found in {path}")
    cats = dict(re.findall(r"^\s*([a-z]+)\s*:\s*'([^']*)'", m["body"], flags=re.MULTILINE))
    if not cats:
        raise ManifestError(f"GALLERY_CATEGORIES in {path} has no entries")
    return cats


def _unit(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and 0.0 <= v <= 1.0


def _region_ok(r: object) -> bool:
    return (isinstance(r, dict) and set(r) == {"x0", "y0", "x1", "y1"} and all(map(_unit, r.values()))
            and r["x0"] < r["x1"] and r["y0"] < r["y1"])


def _check_defaults(d: dict) -> None:
    missing = [k for k in SETTING_KEYS if k not in d]
    if missing:
        raise ManifestError(f"defaults missing: {', '.join(missing)}")
    for key in INT_SETTINGS:
        if not (isinstance(d[key], int) and not isinstance(d[key], bool) and d[key] > 0):
            raise ManifestError(f"defaults.{key} must be a positive integer")
    if not 1 <= d["minQuality"] <= d["quality"] <= 100:
        raise ManifestError("defaults need 1 <= minQuality <= quality <= 100")
    if d["minLongSide"] > d["maxLongSide"]:
        raise ManifestError("defaults need minLongSide <= maxLongSide")
    if not (_unit(d["sizeStep"]) and 0 < d["sizeStep"] < 1):
        raise ManifestError("defaults.sizeStep must be between 0 and 1 (exclusive)")
    aspect = d["referenceAspect"]
    if not (isinstance(aspect, list) and len(aspect) == 2 and all(isinstance(a, int) and a > 0 for a in aspect)):
        raise ManifestError("defaults.referenceAspect must be [width, height] positive integers")
    regions = d["toneRegions"]
    if not (isinstance(regions, dict) and regions and all(_region_ok(r) for r in regions.values())):
        raise ManifestError("defaults.toneRegions must map names to {x0, y0, x1, y1} boxes (0..1, x0 < x1, y0 < y1)")
    if not (_unit(d["darkTextMinLuminance"]) and 0 < d["darkTextMinLuminance"] < 1):
        raise ManifestError("defaults.darkTextMinLuminance must be between 0 and 1 (exclusive)")
    cl = d["containLayout"]
    if not (isinstance(cl, dict) and set(cl) == {"objectBox", "backdropBrightness", "backdropBlur"}
            and _region_ok(cl["objectBox"]) and _unit(cl["backdropBrightness"]) and _unit(cl["backdropBlur"])):
        raise ManifestError("defaults.containLayout needs objectBox {x0, y0, x1, y1}, backdropBrightness (0..1) "
                            "and backdropBlur (blur radius as a fraction of the screen width, 0..1)")


def _check_entry(e: dict, where: str, categories: dict[str, str], allow_unpinned: bool) -> None:
    for key in ("id", "category", "title", "subtitle", "fit", "source", "credit", "captionSource"):
        if key not in e:
            raise ManifestError(f"{where}: missing '{key}'")
    if not ID_RE.match(str(e["id"])):
        raise ManifestError(f"{where}: id must be lowercase words joined by '-'")
    if e["category"] not in categories:
        raise ManifestError(f"{where}: category must be one of {', '.join(categories)}")
    for key, limit in LIMITS.items():
        if not (isinstance(e[key], str) and e[key].strip() == e[key] and 0 < len(e[key]) <= limit):
            raise ManifestError(f"{where}: {key} must be 1..{limit} characters without outer spaces")
    if e["fit"] not in ("cover", "contain"):
        raise ManifestError(f"{where}: fit must be 'cover' or 'contain'")
    if e["fit"] == "cover":
        m = FOCUS_RE.match(str(e.get("focus", "")))
        if not m or int(m["x"]) > 100 or int(m["y"]) > 100:
            raise ManifestError(f"{where}: cover entries need focus 'X% Y%' with X, Y in 0..100")
    elif "focus" in e:
        raise ManifestError(f"{where}: contain entries are shown whole; drop 'focus'")
    if "crop" in e:
        if e["fit"] == "contain":
            raise ManifestError(f"{where}: contain entries (museum objects) are never cropped; drop 'crop'")
        if not _region_ok(e["crop"]):
            raise ManifestError(f"{where}: crop must be {{x0, y0, x1, y1}} fractions with x0 < x1, y0 < y1")
    src = e["source"]
    if not (isinstance(src, dict) and str(src.get("url", "")).startswith("https://")):
        raise ManifestError(f"{where}: source.url must be an https URL")
    sha = src.get("sha256")
    if not (SHA_RE.match(str(sha)) or (sha is None and allow_unpinned)):
        raise ManifestError(f"{where}: source.sha256 must be a lowercase hex SHA-256 (run with --pin to record it)")
    credit = e["credit"]
    missing = [k for k in CREDIT_KEYS if k != "licenseUrl" and not (isinstance(credit.get(k), str) and credit[k])]
    if missing:
        raise ManifestError(f"{where}: credit missing {', '.join(missing)}")
    lic_url = credit.get("licenseUrl", "absent")
    if not (lic_url is None or (isinstance(lic_url, str) and lic_url.startswith("https://"))):
        raise ManifestError(f"{where}: credit.licenseUrl must be an https URL or null (no license applies)")
    if not str(credit["sourceUrl"]).startswith("https://"):
        raise ManifestError(f"{where}: credit.sourceUrl must be an https URL")
    if not (isinstance(e["captionSource"], str) and e["captionSource"]):
        raise ManifestError(f"{where}: captionSource must say where the title and subtitle facts come from")


def load_manifest(path: Path, categories: dict[str, str], allow_unpinned: bool) -> tuple[Settings, list[dict]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"manifest not found: {path}") from None
    except json.JSONDecodeError as e:
        raise ManifestError(f"{path}: invalid JSON: {e}") from None
    defaults, entries = data.get("defaults"), data.get("entries")
    if not isinstance(defaults, dict) or not isinstance(entries, list) or not entries:
        raise ManifestError("manifest needs a 'defaults' object and a non-empty 'entries' array")
    _check_defaults(defaults)
    seen: set[str] = set()
    for i, e in enumerate(entries):
        where = f"entries[{i}] ({e.get('id', '?')})"
        _check_entry(e, where, categories, allow_unpinned)
        if e["id"] in seen:
            raise ManifestError(f"{where}: duplicate id")
        seen.add(e["id"])
    settings = Settings(**{k: defaults[k] for k in SETTING_KEYS if k != "referenceAspect"},
                        referenceAspect=tuple(defaults["referenceAspect"]))
    return settings, entries


# ---------------------------------------------------------------- sources

def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _suffix(url: str) -> str:
    return Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"


def download(url: str, dest: Path, attempts: int = 6) -> None:
    """Fetch url to dest, pausing before every request and backing off when the host says 429/503."""
    tmp = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        time.sleep(REQUEST_GAP_S)
        try:
            with urllib.request.urlopen(req, timeout=300) as resp, open(tmp, "wb") as f:
                shutil.copyfileobj(resp, f)
            tmp.replace(dest)
            return
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or attempt == attempts - 1:
                raise
            retry_after = e.headers.get("Retry-After", "")
            wait = int(retry_after) if retry_after.isdigit() else 15 * 2 ** attempt
            print(f"  {e.code} from {urllib.parse.urlparse(url).netloc}; retrying in {wait} s", file=sys.stderr)
            time.sleep(wait)


def fetch(url: str, sha256: str, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / f"{sha256}{_suffix(url)}"
    if dest.exists() and file_sha256(dest) == sha256:
        return dest
    download(url, dest)
    got = file_sha256(dest)
    if got != sha256:
        dest.unlink()
        raise RuntimeError(f"SHA-256 mismatch for {url}: expected {sha256}, got {got}")
    return dest


def pin(url: str, cache: Path) -> str:
    """Download an unpinned source, file it in the cache under its SHA-256 and return the hash."""
    cache.mkdir(parents=True, exist_ok=True)
    tmp = cache / f"unpinned{_suffix(url)}"
    download(url, tmp)
    sha = file_sha256(tmp)
    tmp.replace(cache / f"{sha}{_suffix(url)}")
    return sha


def open_srgb(path: Path, min_long_side: int) -> Image.Image:
    """Decode (JPEG at a reduced DCT scale when that still leaves min_long_side), orient, convert to sRGB."""
    with Image.open(path) as raw:
        if raw.format == "JPEG":
            scale = min(1.0, min_long_side / max(raw.size))
            raw.draft("RGB", (math.ceil(raw.width * scale), math.ceil(raw.height * scale)))
        im = ImageOps.exif_transpose(raw)
        icc = raw.info.get("icc_profile")
        if im.mode not in ("RGB", "RGBA", "CMYK"):
            # Greyscale and palette images: their profiles (if any) do not apply to RGB data.
            im, icc = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB"), None
        if icc:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            im = ImageCms.profileToProfile(im, src, ImageCms.createProfile("sRGB"),
                                           outputMode="RGBA" if im.mode == "RGBA" else "RGB")
        if im.mode == "RGBA":
            flat = Image.new("RGB", im.size, (255, 255, 255))
            flat.paste(im, mask=im.getchannel("A"))
            return flat
        return im.convert("RGB")


# ---------------------------------------------------------------- processing

def crop_box(w: int, h: int, c: dict[str, float]) -> tuple[int, int, int, int]:
    return round(c["x0"] * w), round(c["y0"] * h), round(c["x1"] * w), round(c["y1"] * h)


def parse_focus(focus: str) -> tuple[float, float]:
    m = FOCUS_RE.match(focus)
    return int(m["x"]) / 100, int(m["y"]) / 100


def cover_frame(im: Image.Image, aspect: tuple[int, int], focus: tuple[float, float], width: int) -> Image.Image:
    """The image as CSS object-fit: cover with object-position focus shows it in a box of the given aspect."""
    target = aspect[0] / aspect[1]
    w, h = im.size
    if w / h > target:
        cw, ch = h * target, h
    else:
        cw, ch = w, w / target
    x0, y0 = focus[0] * (w - cw), focus[1] * (h - ch)
    height = round(width / target)
    return im.resize((width, height), Image.Resampling.LANCZOS, box=(x0, y0, x0 + cw, y0 + ch))


def display_frame(im: Image.Image, fit: str, focus: str | None, s: Settings, width: int) -> Image.Image:
    """What the Gallery theme shows on a referenceAspect screen `width` px wide (before its scrims)."""
    if fit == "cover":
        return cover_frame(im, s.referenceAspect, parse_focus(focus), width)
    cl = s.containLayout
    back = cover_frame(im, s.referenceAspect, (0.5, 0.5), width)
    back = back.filter(ImageFilter.GaussianBlur(cl["backdropBlur"] * width))
    frame = back.point(lambda v: round(v * cl["backdropBrightness"]))
    x0, y0, x1, y1 = crop_box(*frame.size, cl["objectBox"])
    obj = im.copy()
    obj.thumbnail((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    frame.paste(obj, (x0 + (x1 - x0 - obj.width) // 2, y0 + (y1 - y0 - obj.height) // 2))
    return frame


def encode_webp(im: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def long_sides(native: int, s: Settings) -> list[int]:
    """Candidate long sides: maxLongSide (or the native size, if smaller), shrinking by sizeStep to minLongSide."""
    side = min(native, s.maxLongSide)
    out = [side]
    while side > s.minLongSide:
        side = max(s.minLongSide, round(side * s.sizeStep))
        out.append(side)
    return out


def encode_fitting(im: Image.Image, s: Settings) -> tuple[bytes, Image.Image, int]:
    """Largest size, then highest quality, whose WebP fits maxBytes; the smallest allowed encode otherwise."""
    for side in long_sides(max(im.size), s):
        scale = side / max(im.size)
        sized = im if scale >= 1 else im.resize((round(im.width * scale), round(im.height * scale)),
                                                Image.Resampling.LANCZOS)
        q = s.quality
        while True:
            data = encode_webp(sized, q)
            if len(data) <= s.maxBytes:
                return data, sized, q
            if q == s.minQuality:
                break
            q = max(q - s.qualityStep, s.minQuality)
    return data, sized, q


_LIN = [((v / 255) / 12.92) if v / 255 <= 0.04045 else (((v / 255) + 0.055) / 1.055) ** 2.4 for v in range(256)]


def mean_luminance(im: Image.Image) -> float:
    """Mean WCAG relative luminance, averaged in linear light."""
    data = im.convert("RGB").tobytes()
    total = sum(0.2126 * _LIN[data[i]] + 0.7152 * _LIN[data[i + 1]] + 0.0722 * _LIN[data[i + 2]]
                for i in range(0, len(data), 3))
    return total / (len(data) // 3)


def text_tone(frame: Image.Image, s: Settings) -> tuple[str, dict[str, float]]:
    w, h = frame.size
    lum = {name: mean_luminance(frame.crop(crop_box(w, h, r))) for name, r in s.toneRegions.items()}
    y = sum(lum.values()) / len(lum)
    return ("dark" if y >= s.darkTextMinLuminance else "light"), lum


def process_entry(entry: dict, s: Settings, out_dir: Path, cache: Path) -> tuple[dict, Image.Image]:
    src_path = fetch(entry["source"]["url"], entry["source"]["sha256"], cache)
    crop = entry.get("crop")
    span = max(crop["x1"] - crop["x0"], crop["y1"] - crop["y0"]) if crop else 1.0
    im = open_srgb(src_path, math.ceil(2 * s.maxLongSide / span))
    decoded = im.size
    if crop:
        im = im.crop(crop_box(*im.size, crop))

    eid = entry["id"]
    file = f"{eid}.webp"
    data, out, q = encode_fitting(im, s)
    (out_dir / file).write_bytes(data)

    focus = entry.get("focus")
    tone, lum = text_tone(display_frame(out, entry["fit"], focus, s, TONE_SAMPLE_WIDTH), s)
    lum_txt = " ".join(f"{k}={v:.3f}" for k, v in lum.items())
    print(f"{eid:22} {decoded[0]}x{decoded[1]} -> {out.width}x{out.height} {len(data) / 1024:.0f} KiB q{q} "
          f"{entry['fit']:7} textTone={tone} ({lum_txt})")
    if max(out.size) < s.minLongSide:
        print(f"warning: {file} is only {max(out.size)} px on its long side (source too small)", file=sys.stderr)
    if len(data) > s.maxBytes:
        print(f"warning: {file} is {len(data) / 1024:.0f} KiB, above maxBytes even at "
              f"{max(out.size)} px and quality {q}", file=sys.stderr)
    credit = entry["credit"]
    item = {
        "id": eid,
        "file": file,
        "category": entry["category"],
        "title": entry["title"],
        "subtitle": entry["subtitle"],
        "fit": entry["fit"],
        "textTone": tone,
        **({"focus": focus} if focus else {}),
        "credit": {k: credit.get(k) for k in CREDIT_KEYS},
    }
    return item, out


# ---------------------------------------------------------------- outputs

def write_credits(path: Path, items: list[dict], entries: dict[str, dict], categories: dict[str, str],
                  sizes: dict[str, tuple[int, int]]) -> None:
    lines = [
        "# Gallery photo credits",
        "",
        "Generated by `scripts/gallery/process.py` from `scripts/gallery/manifest.json`. Do not edit by hand.",
        "",
        "Every image was downscaled and re-encoded as WebP; cropped entries say so. Captions are written",
        "from the sources listed under *Caption facts*. Personal, non-commercial use.",
        "",
    ]
    for cat, label in categories.items():
        group = [it for it in items if it["category"] == cat]
        if not group:
            continue
        lines += [f"## {label}", ""]
        for it in group:
            e, c = entries[it["id"]], it["credit"]
            lic = f"[{c['license']}]({c['licenseUrl']})" if c["licenseUrl"] else c["license"]
            w, h = sizes[it["id"]]
            change = f"resized to {w}×{h}, WebP"
            if e.get("crop"):
                cr = e["crop"]
                change = (f"cropped to x {cr['x0']:.2f}–{cr['x1']:.2f}, y {cr['y0']:.2f}–{cr['y1']:.2f} "
                          f"of the frame, {change}")
            lines += [
                f"### `{it['file']}` — {it['title']}",
                "",
                f"- Caption: {it['title']} — {it['subtitle']}",
                f"- Source title: {c['title']}",
                f"- Author: {c['author']}",
                f"- Source: <{c['sourceUrl']}>",
                f"- Original file: <{e['source']['url']}>",
                f"- License: {lic}",
                f"- Caption facts: {e['captionSource']}",
                f"- Changes: {change}",
                "",
            ]
    path.write_text("\n".join(lines), encoding="utf-8")


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def contact_sheet(path: Path, items: list[dict], images: dict[str, Image.Image], s: Settings,
                  categories: dict[str, str], cols: int = 4, tile_w: int = 480) -> None:
    """Each item as the theme frames it (display_frame), labelled, with the tone regions outlined."""
    tile_h = round(tile_w * s.referenceAspect[1] / s.referenceAspect[0])
    label_h = 64
    rows = math.ceil(len(items) / cols)
    sheet = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    f_big, f_small = _font(15), _font(12)
    for i, it in enumerate(items):
        tile = display_frame(images[it["id"]], it["fit"], it.get("focus"), s, tile_w)
        td = ImageDraw.Draw(tile)
        for r in s.toneRegions.values():
            td.rectangle(crop_box(tile_w, tile_h, r), outline=(255, 210, 90) if it["textTone"] == "dark" else (120, 200, 255))
        r, c = divmod(i, cols)
        x, y = c * tile_w, r * (tile_h + label_h)
        sheet.paste(tile, (x, y))
        draw.text((x + 6, y + tile_h + 4), it["title"], fill=(255, 255, 255), font=f_big)
        draw.text((x + 6, y + tile_h + 24), it["subtitle"], fill=(200, 200, 200), font=f_small)
        draw.text((x + 6, y + tile_h + 42), f"{it['id']} · {categories[it['category']]} · {it['fit']} · {it['textTone']}",
                  fill=(150, 170, 190), font=f_small)
    sheet.save(path)
    print(f"contact sheet: {path} ({sheet.width}x{sheet.height})")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE,
                    help=f"where downloaded originals are kept (default: {DEFAULT_CACHE})")
    ap.add_argument("--only", nargs="+", metavar="ID", help="rebuild only these ids (index/credits still list all)")
    ap.add_argument("--pin", action="store_true",
                    help="download entries whose source.sha256 is null and write their hashes into the manifest")
    ap.add_argument("--contact-sheet", type=Path, metavar="PNG",
                    help="also write a labelled contact sheet of every item (needs a full build)")
    args = ap.parse_args(argv)

    try:
        categories = app_categories(SETTINGS_TS)
        settings, entries = load_manifest(args.manifest, categories, allow_unpinned=args.pin)
    except ManifestError as e:
        ap.error(str(e))
    if args.only and args.contact_sheet:
        ap.error("--contact-sheet needs a full build; drop --only")
    by_id = {e["id"]: e for e in entries}
    if args.only:
        unknown = sorted(set(args.only) - set(by_id))
        if unknown:
            ap.error(f"--only: unknown ids {', '.join(unknown)}")
    if not args.out_dir.is_dir():
        ap.error(f"--out-dir does not exist: {args.out_dir}")
    if args.contact_sheet and not args.contact_sheet.parent.is_dir():
        ap.error(f"--contact-sheet: directory does not exist: {args.contact_sheet.parent}")

    if args.pin:
        for e in entries:
            if e["source"].get("sha256") is not None:
                continue
            e["source"]["sha256"] = pin(e["source"]["url"], args.cache_dir)
            print(f"pinned {e['id']}: {e['source']['sha256']}")
            # Save after every pin so an interrupted run keeps its progress.
            data = json.loads(args.manifest.read_text(encoding="utf-8"))
            data["entries"] = entries
            args.manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    index_path = args.out_dir / "index.json"
    previous: dict[str, dict] = {}
    if args.only:
        if not index_path.exists():
            ap.error("--only needs an existing index.json; run a full build first")
        previous = {it["id"]: it for it in json.loads(index_path.read_text(encoding="utf-8"))}
        missing = sorted(set(by_id) - set(args.only) - set(previous))
        if missing:
            ap.error(f"--only: index.json lacks {', '.join(missing)}; run a full build first")

    order = list(categories)
    items, images, sizes = [], {}, {}
    for e in sorted(entries, key=lambda e: order.index(e["category"])):
        if args.only and e["id"] not in args.only:
            items.append(previous[e["id"]])
            with Image.open(args.out_dir / previous[e["id"]]["file"]) as im:
                sizes[e["id"]] = im.size
            continue
        item, out = process_entry(e, settings, args.out_dir, args.cache_dir)
        items.append(item)
        sizes[e["id"]] = out.size
        if args.contact_sheet:
            images[e["id"]] = out

    expected = {it["file"] for it in items}
    for stale in sorted(p for p in args.out_dir.iterdir() if OUTPUT_RE.match(p.name) and p.name not in expected):
        print(f"removing stale {stale.name}")
        stale.unlink()
    index_path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_credits(args.out_dir / "CREDITS.md", items, by_id, categories, sizes)
    counts = ", ".join(f"{c}={sum(it['category'] == c for it in items)}" for c in order)
    total = sum((args.out_dir / it["file"]).stat().st_size for it in items)
    print(f"wrote {index_path} ({len(items)} items: {counts}; {total / 2**20:.1f} MiB of WebP) and CREDITS.md")
    if args.contact_sheet:
        contact_sheet(args.contact_sheet, items, images, settings, categories)
    return 0


if __name__ == "__main__":
    sys.exit(main())
