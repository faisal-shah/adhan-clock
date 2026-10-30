# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.2"]
# ///
"""Build the bundled background photos in public/backgrounds/ from scripts/backgrounds/manifest.json.

For every manifest entry this script:

1. downloads ``source.url`` into a cache directory and checks its SHA-256;
2. applies the EXIF orientation and converts embedded ICC profiles to sRGB;
3. mirrors the photo horizontally when ``crop.mirror`` is true;
4. cover-crops it to the output aspect ratio around ``crop.focusX`` /
   ``crop.focusY`` (0..1, measured on the mirrored image). The window is the
   largest box of that aspect divided by ``crop.zoom`` (>= 1), clamped to the
   frame, so with zoom 1 the focus only matters along the axis that gets
   trimmed. Zoom exists to cut an unwanted strip (e.g. a crowd along the
   bottom edge) out of a photo that is already at the output aspect;
5. resizes it to the large and small widths and encodes WebP, lowering the
   quality in steps until the large file fits ``maxBytes``;
6. measures ``textTone`` and ``accent`` on the result.

``textTone`` is "dark" (navy text) when the mean WCAG relative luminance of
the text region (right part, upper part of the frame; see ``textRegion``) is
at least ``darkTextMinLuminance``, otherwise "light" (white text). The
threshold sits well above the plain contrast crossover (~0.2) because the
theme lays a dark scrim behind white text, which keeps it legible over
mid-tone skies; navy is reserved for clearly light skies. ``accent`` is the
dominant saturated hue of the photo, normalised to a mid-tone suitable for UI
pills.

It then writes ``index.json`` (consumed by the app) and ``CREDITS.md``.
Every derived value comes from this run, so the manifest is the single source
of truth.

Usage (from the repo root)::

    uv run scripts/backgrounds/process.py            # build everything
    uv run scripts/backgrounds/process.py --only fajr-1 isha-2
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import io
import json
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "scripts" / "backgrounds" / "manifest.json"
DEFAULT_OUT = REPO / "public" / "backgrounds"
DEFAULT_CACHE = Path(tempfile.gettempdir()) / "adhan-clock-backgrounds-src"
USER_AGENT = "adhan-clock-backgrounds-build/1.0 (https://github.com/faisal-shah/adhan-clock; faisal.shah@gmail.com)"

SLOTS = ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha", "night")
ID_RE = re.compile(r"^(?P<slot>[a-z]+)-(?P<n>[1-9][0-9]*)$")
CREDIT_KEYS = ("title", "author", "sourceUrl", "license", "licenseUrl")
SETTING_KEYS = (
    "width", "smallWidth", "aspect", "quality", "minQuality", "qualityStep",
    "maxBytes", "textRegion", "darkTextMinLuminance",
)
NEUTRAL_ACCENT = "#5b6b84"
OUTPUT_RE = re.compile(rf"^(?:{'|'.join(SLOTS)})-[1-9][0-9]*(?:-sm)?\.webp$")


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    width: int
    smallWidth: int
    aspect: tuple[int, int]
    quality: int
    minQuality: int
    qualityStep: int
    maxBytes: int
    textRegion: dict[str, float]
    darkTextMinLuminance: float

    @property
    def height(self) -> int:
        return round(self.width * self.aspect[1] / self.aspect[0])

    @property
    def smallHeight(self) -> int:
        return round(self.smallWidth * self.aspect[1] / self.aspect[0])


# ---------------------------------------------------------------- manifest

def _unit(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and 0.0 <= v <= 1.0


def load_manifest(path: Path) -> tuple[Settings, list[dict]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"manifest not found: {path}") from None
    except json.JSONDecodeError as e:
        raise ManifestError(f"{path}: invalid JSON: {e}") from None
    defaults, entries = data.get("defaults"), data.get("entries")
    if not isinstance(defaults, dict) or not isinstance(entries, list) or not entries:
        raise ManifestError("manifest needs a 'defaults' object and a non-empty 'entries' array")
    missing = [k for k in SETTING_KEYS if k not in defaults]
    if missing:
        raise ManifestError(f"defaults missing: {', '.join(missing)}")
    aspect = defaults["aspect"]
    if not (isinstance(aspect, list) and len(aspect) == 2 and all(isinstance(a, int) and a > 0 for a in aspect)):
        raise ManifestError("defaults.aspect must be [width, height] positive integers")
    for key in ("width", "smallWidth", "quality", "minQuality", "qualityStep", "maxBytes"):
        if not (isinstance(defaults[key], int) and defaults[key] > 0):
            raise ManifestError(f"defaults.{key} must be a positive integer")
    if not 1 <= defaults["minQuality"] <= defaults["quality"] <= 100:
        raise ManifestError("defaults need 1 <= minQuality <= quality <= 100")
    if defaults["smallWidth"] >= defaults["width"]:
        raise ManifestError("defaults.smallWidth must be smaller than defaults.width")
    region = defaults["textRegion"]
    if not (isinstance(region, dict) and set(region) == {"x0", "x1", "y0", "y1"} and all(map(_unit, region.values()))
            and region["x0"] < region["x1"] and region["y0"] < region["y1"]):
        raise ManifestError("defaults.textRegion needs x0 < x1 and y0 < y1, all within 0..1")
    if not (_unit(defaults["darkTextMinLuminance"]) and 0 < defaults["darkTextMinLuminance"] < 1):
        raise ManifestError("defaults.darkTextMinLuminance must be between 0 and 1 (exclusive)")

    seen: set[str] = set()
    for i, e in enumerate(entries):
        where = f"entries[{i}] ({e.get('id', '?')})"
        for key in ("id", "slot", "subject", "source", "credit", "crop"):
            if key not in e:
                raise ManifestError(f"{where}: missing '{key}'")
        m = ID_RE.match(e["id"])
        if e["slot"] not in SLOTS:
            raise ManifestError(f"{where}: slot must be one of {SLOTS}")
        if not m or m["slot"] != e["slot"]:
            raise ManifestError(f"{where}: id must be '<slot>-<n>' with n >= 1, matching the slot")
        if e["id"] in seen:
            raise ManifestError(f"{where}: duplicate id")
        seen.add(e["id"])
        src = e["source"]
        if not (isinstance(src, dict) and str(src.get("url", "")).startswith("https://")):
            raise ManifestError(f"{where}: source.url must be an https URL")
        if not re.fullmatch(r"[0-9a-f]{64}", str(src.get("sha256", ""))):
            raise ManifestError(f"{where}: source.sha256 must be a lowercase hex SHA-256")
        credit = e["credit"]
        missing = [k for k in CREDIT_KEYS if k != "licenseUrl" and not (isinstance(credit.get(k), str) and credit[k])]
        if missing:
            raise ManifestError(f"{where}: credit missing {', '.join(missing)}")
        lic_url = credit.get("licenseUrl", "absent")
        if not (lic_url is None or (isinstance(lic_url, str) and lic_url.startswith("https://"))):
            raise ManifestError(f"{where}: credit.licenseUrl must be an https URL or null (license unknown)")
        for key in ("sourceUrl", "authorUrl"):
            if key in credit and not str(credit[key]).startswith("https://"):
                raise ManifestError(f"{where}: credit.{key} must be an https URL")
        crop = e["crop"]
        if not (isinstance(crop, dict) and {"focusX", "focusY", "mirror"} <= set(crop) <= {"focusX", "focusY", "mirror", "zoom"}
                and _unit(crop["focusX"]) and _unit(crop["focusY"]) and isinstance(crop["mirror"], bool)):
            raise ManifestError(f"{where}: crop needs focusX, focusY (0..1), mirror (bool) and optionally zoom")
        zoom = crop.get("zoom", 1.0)
        if not (isinstance(zoom, (int, float)) and not isinstance(zoom, bool) and 1.0 <= zoom <= 4.0):
            raise ManifestError(f"{where}: crop.zoom must be a number in 1..4")
    settings = Settings(**{k: defaults[k] for k in SETTING_KEYS if k != "aspect"}, aspect=tuple(aspect))
    return settings, entries


# ---------------------------------------------------------------- sources

def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url: str, sha256: str, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
    dest = cache / f"{sha256}{suffix}"
    if dest.exists() and file_sha256(dest) == sha256:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as resp, open(tmp, "wb") as f:
        shutil.copyfileobj(resp, f)
    got = file_sha256(tmp)
    if got != sha256:
        tmp.unlink()
        raise RuntimeError(f"SHA-256 mismatch for {url}: expected {sha256}, got {got}")
    tmp.replace(dest)
    return dest


def open_srgb(path: Path) -> Image.Image:
    with Image.open(path) as raw:
        im = ImageOps.exif_transpose(raw)
        icc = raw.info.get("icc_profile")
        if icc:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            im = ImageCms.profileToProfile(im, src, ImageCms.createProfile("sRGB"), outputMode="RGB")
        return im.convert("RGB")


# ---------------------------------------------------------------- processing

def cover_box(w: int, h: int, aspect: tuple[int, int], fx: float, fy: float, zoom: float) -> tuple[int, int, int, int]:
    """Largest box of the target aspect inside w x h, shrunk by zoom, centred on (fx, fy), clamped to the frame."""
    target = aspect[0] / aspect[1]
    if w / h > target:
        cw, ch = h * target, h
    else:
        cw, ch = w, w / target
    cw, ch = round(cw / zoom), round(ch / zoom)
    x0 = min(max(round(fx * w - cw / 2), 0), w - cw)
    y0 = min(max(round(fy * h - ch / 2), 0), h - ch)
    return x0, y0, x0 + cw, y0 + ch


def encode_webp(im: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def encode_within(im: Image.Image, s: Settings) -> tuple[bytes, int]:
    q = s.quality
    while True:
        data = encode_webp(im, q)
        if len(data) <= s.maxBytes or q <= s.minQuality:
            return data, q
        q = max(q - s.qualityStep, s.minQuality)


def _lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_pixels(im: Image.Image) -> list[tuple[int, int, int]]:
    data = im.tobytes()
    return [tuple(data[i:i + 3]) for i in range(0, len(data), 3)]


def text_tone(im: Image.Image, s: Settings) -> tuple[str, float]:
    """Text tone from the mean WCAG relative luminance (averaged in linear light) of the text region."""
    w, h = im.size
    r = s.textRegion
    region = im.crop((round(r["x0"] * w), round(r["y0"] * h), round(r["x1"] * w), round(r["y1"] * h)))
    region = region.resize((max(1, region.width // 8), max(1, region.height // 8)), Image.Resampling.BOX)
    lut = [_lin(v) for v in range(256)]
    pixels = rgb_pixels(region)
    y = sum(0.2126 * lut[r_] + 0.7152 * lut[g] + 0.0722 * lut[b] for r_, g, b in pixels) / len(pixels)
    return ("dark" if y >= s.darkTextMinLuminance else "light"), y


def accent_colour(im: Image.Image) -> str:
    """Dominant saturated hue, normalised to a mid-tone (HLS lightness 0.45-0.58, saturation 0.50-0.80).

    Hues are weighted by saturation squared times value, so a small vivid
    area (a dome, a lit facade) beats a large, faintly tinted sky or haze.
    Near-grey pixels (saturation below 0.06) never vote: their hue is noise.
    A photo with no coloured pixels at all gets ``NEUTRAL_ACCENT``.
    """
    small = im.resize((192, 120), Image.Resampling.BOX)
    pixels = rgb_pixels(small)
    hsv = [colorsys.rgb_to_hsv(r / 255, g / 255, b / 255) for r, g, b in pixels]
    for min_s in (0.30, 0.15, 0.06):
        picked = [(px, hh) for px, hh in zip(pixels, hsv) if hh[1] >= min_s and 0.25 <= hh[2] <= 0.97]
        if len(picked) >= len(pixels) * 0.01:
            break
    if not picked:
        return NEUTRAL_ACCENT
    bins = [0.0] * 24
    for _, (hue, sat, val) in picked:
        bins[int(hue * 24) % 24] += sat * sat * val
    smoothed = [bins[i - 1] * 0.5 + bins[i] + bins[(i + 1) % 24] * 0.5 for i in range(24)]
    best = max(range(24), key=smoothed.__getitem__)
    members = [px for px, (hue, _, _) in picked if min(abs(int(hue * 24) - best), 24 - abs(int(hue * 24) - best)) <= 1]
    r, g, b = (sorted(px[c] for px in members)[len(members) // 2] / 255 for c in range(3))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    light = min(max(light, 0.45), 0.58)
    sat = min(max(sat, 0.50), 0.80)
    r, g, b = colorsys.hls_to_rgb(hue, light, sat)
    return "#" + "".join(f"{round(v * 255):02x}" for v in (r, g, b))


def process_entry(entry: dict, s: Settings, out_dir: Path, cache: Path) -> dict:
    src_path = fetch(entry["source"]["url"], entry["source"]["sha256"], cache)
    im = open_srgb(src_path)
    src_w, src_h = im.size
    crop = entry["crop"]
    if crop["mirror"]:
        im = ImageOps.mirror(im)
    box = cover_box(src_w, src_h, s.aspect, crop["focusX"], crop["focusY"], crop.get("zoom", 1.0))
    im = im.crop(box)
    upscaled = im.width < s.width
    large = im.resize((s.width, s.height), Image.Resampling.LANCZOS)
    small = large.resize((s.smallWidth, s.smallHeight), Image.Resampling.LANCZOS)

    eid = entry["id"]
    file, file_sm = f"{eid}.webp", f"{eid}-sm.webp"
    data, q = encode_within(large, s)
    data_sm, q_sm = encode_within(small, s)
    (out_dir / file).write_bytes(data)
    (out_dir / file_sm).write_bytes(data_sm)

    tone, lum = text_tone(large, s)
    accent = accent_colour(large)
    cw, ch = box[2] - box[0], box[3] - box[1]
    steps = [f"Cropped to {s.aspect[0]}:{s.aspect[1]} ({cw}x{ch} px of the {src_w}x{src_h} px original)"]
    if crop["mirror"]:
        steps.append("mirrored horizontally")
    steps.append(f"{'upscaled' if upscaled else 'resized'} to {s.width}x{s.height} and {s.smallWidth}x{s.smallHeight}")
    steps.append("encoded as WebP")
    modified = ", ".join(steps) + "."
    credit = entry["credit"]
    print(f"{eid:10} {src_w}x{src_h} -> {file} {len(data) / 1024:.0f} KiB q{q}, {file_sm} {len(data_sm) / 1024:.0f} KiB q{q_sm}, "
          f"textTone={tone} (Y={lum:.3f}) accent={accent}" + (" [upscaled]" if upscaled else ""))
    if len(data) > s.maxBytes:
        print(f"warning: {file} is {len(data)} bytes, above maxBytes={s.maxBytes} even at quality {q}", file=sys.stderr)
    return {
        "id": eid,
        "slot": entry["slot"],
        "file": file,
        "fileSm": file_sm,
        "textTone": tone,
        "accent": accent,
        "credit": {**{k: credit.get(k) for k in CREDIT_KEYS}, "modified": modified},
    }


# ---------------------------------------------------------------- outputs

def write_credits(path: Path, items: list[dict], entries: dict[str, dict]) -> None:
    lines = [
        "# Background photo credits",
        "",
        "Generated by `scripts/backgrounds/process.py` from `scripts/backgrounds/manifest.json`. Do not edit by hand.",
        "",
    ]
    for it in items:
        e, c = entries[it["id"]], it["credit"]
        author = f"[{c['author']}]({e['credit']['authorUrl']})" if e["credit"].get("authorUrl") else c["author"]
        lic = f"[{c['license']}]({c['licenseUrl']})" if c["licenseUrl"] else c["license"]
        lines += [
            f"## `{it['file']}` — {e['subject']}",
            "",
            f"- Title: {c['title']}",
            f"- Photographer: {author}",
            f"- Source: <{c['sourceUrl']}>",
            f"- License: {lic}",
        ]
        if e.get("licenseNote"):
            lines.append(f"- License note: {e['licenseNote']}")
        lines += [f"- Changes: {c['modified']}", f"- Also served as `{it['fileSm']}` (same crop, smaller).", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE,
                    help=f"where downloaded originals are kept (default: {DEFAULT_CACHE})")
    ap.add_argument("--only", nargs="+", metavar="ID", help="rebuild only these ids (index/credits still list all)")
    args = ap.parse_args(argv)

    try:
        settings, entries = load_manifest(args.manifest)
    except ManifestError as e:
        ap.error(str(e))
    by_id = {e["id"]: e for e in entries}
    if args.only:
        unknown = sorted(set(args.only) - set(by_id))
        if unknown:
            ap.error(f"--only: unknown ids {', '.join(unknown)} (known: {', '.join(by_id)})")
    if not args.out_dir.is_dir():
        ap.error(f"--out-dir does not exist: {args.out_dir}")

    index_path = args.out_dir / "index.json"
    previous: dict[str, dict] = {}
    if args.only:
        if not index_path.exists():
            ap.error("--only needs an existing index.json; run a full build first")
        previous = {it["id"]: it for it in json.loads(index_path.read_text(encoding="utf-8"))}
        missing = sorted(set(by_id) - set(args.only) - set(previous))
        if missing:
            ap.error(f"--only: index.json lacks {', '.join(missing)}; run a full build first")

    items = []
    for e in sorted(entries, key=lambda e: (SLOTS.index(e["slot"]), int(ID_RE.match(e["id"])["n"]))):
        if args.only and e["id"] not in args.only:
            items.append(previous[e["id"]])
        else:
            items.append(process_entry(e, settings, args.out_dir, args.cache_dir))

    expected = {f for it in items for f in (it["file"], it["fileSm"])}
    for stale in sorted(p for p in args.out_dir.iterdir() if OUTPUT_RE.match(p.name) and p.name not in expected):
        print(f"removing stale {stale.name}")
        stale.unlink()

    index_path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_credits(args.out_dir / "CREDITS.md", items, by_id)
    empty = [s for s in SLOTS if not any(it["slot"] == s for it in items)]
    print(f"wrote {len(items)} backgrounds, index.json and CREDITS.md to {args.out_dir}"
          + (f"; slots without photos: {', '.join(empty)}" if empty else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
