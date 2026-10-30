# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26", "pillow>=10.2", "scipy>=1.11", "potracer==0.0.4"]
# ///
"""Build the prayer-name calligraphy in public/calligraphy/ from scripts/calligraphy/manifest.json.

Every word is cut out of an existing piece of calligraphy (see the manifest for
sources) and vectorised into a single filled SVG path that the app uses as a
CSS ``mask-image``. Per manifest word this script:

1. downloads ``source.url`` into a cache directory and checks its SHA-256;
   SVG sources are rasterised with Inkscape (only the paths whose ``class`` is
   ``source.svgClass``) at ``source.rasterWidth`` pixels;
2. crops ``crop`` = [x, y, w, h] (source pixels; every other coordinate in the
   entry is also in full-source pixels);
3. when ``watermark`` names a template set, removes that semi-transparent
   watermark by un-blending. The watermark is identical on every preview of
   the set, so over many previews the per-pixel median is the watermark
   composited over white (``M``) and a low order statistic is the watermark
   composited over black calligraphy (``m``). The underlying ink is then
   ``255 * (O - m) / (M - m)``. Only the ``templateCount`` templates whose
   faint watermark looks most like the target's are used (the sets mix
   watermark variants);
4. denoises (3x3 median; ``overlayMedian`` under the watermark, where
   un-blending amplifies JPEG noise), thresholds at ``threshold`` and edits
   the bitmap:
   ``stripVertical`` boxes keep only pixels on vertical runs of at least
   ``stripLength`` px (removes a mark that crosses an alif while keeping the
   alif), ``closeVertical`` boxes bridge gaps up to ``stripLength`` px in
   vertical strokes (a thin stroke cut by a watermark line), ``erase``
   polygons are cleared, and only connected components of at
   least ``minArea`` px whose centroid lies inside the ``keep`` polygon
   survive. Holes up to ``holeMax`` px (JPEG pinholes) are filled;
5. upsamples the masked greyscale by ``upscale`` (Lanczos), blurs it by
   ``blur`` source px and re-thresholds, which gives sub-pixel smooth edges;
6. traces it with potrace (``turdsize`` in source px^2, ``alphamax``,
   ``opttolerance``) and writes ``<id>.svg``: one evenodd ``<path>``, viewBox
   cropped to the glyph with ``padding`` (fraction of the long side) and the
   long side normalised to 1000 units.

It then writes ``index.json`` (consumed by the app) and ``CREDITS.md``.
Every entry has a ``kind``: ``prayer`` (a period name; periods absent from the
manifest fall back to the app's font), ``phrase`` (a greeting or dhikr cut to
its text) or ``gallery`` (a whole composition shown full screen with a
caption, which also needs ``english``, ``ref`` and ``transliteration``).
``arabic`` is the exact text the artwork shows. ``keep`` may be omitted to
keep every component inside ``crop``.

``sheet OUT.png`` renders all built SVGs gold-on-navy, as the app shows them,
for visual review (needs Inkscape).

Usage (from the repo root)::

    uv run scripts/calligraphy/process.py build
    uv run scripts/calligraphy/process.py build --only fajr asr --debug-dir /tmp/callig-debug
    uv run scripts/calligraphy/process.py index      # captions/credits only, no rebuild
    uv run scripts/calligraphy/process.py sheet /tmp/calligraphy-sheet.png --kind gallery
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import potrace
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "scripts" / "calligraphy" / "manifest.json"
DEFAULT_OUT = REPO / "public" / "calligraphy"
DEFAULT_CACHE = Path(tempfile.gettempdir()) / "adhan-clock-calligraphy-src"
USER_AGENT = "adhan-clock-calligraphy-build/1.0 (https://github.com/faisal-shah/adhan-clock; faisal.shah@gmail.com)"

ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
KINDS = ("prayer", "phrase", "gallery")
GALLERY_KEYS = ("english", "ref", "transliteration")
PARAM_KEYS = (
    "threshold", "minArea", "holeMax", "stripLength", "upscale", "blur",
    "turdsize", "alphamax", "opttolerance", "padding", "templateRank", "templateCount", "overlayMedian",
)
VIEWBOX_LONG_SIDE = 1000.0
SHEET_BG = (11, 22, 44)
GOLD_STOPS = ((0.0, (247, 226, 160)), (0.45, (214, 170, 82)), (0.7, (240, 205, 120)), (1.0, (168, 118, 44)))


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class Params:
    threshold: int
    minArea: int
    holeMax: int
    stripLength: int
    upscale: int
    blur: float
    turdsize: float
    alphamax: float
    opttolerance: float
    padding: float
    templateRank: int
    templateCount: int
    overlayMedian: int


@dataclass(frozen=True)
class Word:
    id: str
    kind: str
    arabic: str
    caption: dict[str, str]
    source: dict
    watermark: str | None
    crop: tuple[int, int, int, int]
    keep: list[tuple[float, float]] | None
    erase: list[list[tuple[float, float]]]
    strip_vertical: list[tuple[int, int, int, int]]
    close_vertical: list[tuple[int, int, int, int]]
    params: Params


# ---------------------------------------------------------------- manifest


def _poly(value, where: str) -> list[tuple[float, float]]:
    if not isinstance(value, list) or len(value) < 3 or not all(
        isinstance(p, list) and len(p) == 2 and all(isinstance(c, (int, float)) for c in p) for p in value
    ):
        raise ManifestError(f"{where}: expected a polygon [[x, y], ...] with at least 3 points")
    return [(float(x), float(y)) for x, y in value]


def _box(value, where: str) -> tuple[int, int, int, int]:
    if not isinstance(value, list) or len(value) != 4 or not all(isinstance(c, int) for c in value):
        raise ManifestError(f"{where}: expected four integers")
    return tuple(value)  # type: ignore[return-value]


def load_manifest(path: Path) -> tuple[dict[str, list[str]], list[Word]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    defaults = data.get("defaults", {})
    templates = data.get("watermarkTemplates", {})
    template_urls: dict[str, list[str]] = {}
    for name, spec in templates.items():
        base, paths = spec.get("base"), spec.get("paths")
        if not isinstance(base, str) or not isinstance(paths, list) or not paths:
            raise ManifestError(f"watermarkTemplates.{name}: needs 'base' and a non-empty 'paths' list")
        template_urls[name] = [base + p for p in paths]
    words: list[Word] = []
    seen: set[str] = set()
    for i, w in enumerate(data.get("words", [])):
        where = f"words[{i}]"
        wid = w.get("id")
        if not isinstance(wid, str) or not ID_RE.match(wid):
            raise ManifestError(f"{where}: id must be lowercase letters/digits joined by single hyphens")
        if wid in seen:
            raise ManifestError(f"{where}: duplicate id {wid!r}")
        seen.add(wid)
        where = f"words[{wid}]"
        kind = w.get("kind")
        if kind not in KINDS:
            raise ManifestError(f"{where}.kind: one of {KINDS}")
        if not isinstance(w.get("arabic"), str) or not w["arabic"].strip():
            raise ManifestError(f"{where}.arabic: required (the exact text of the artwork)")
        caption = {k: w.get(k) for k in GALLERY_KEYS if k in w}
        if kind == "gallery":
            bad = [k for k in GALLERY_KEYS if not isinstance(caption.get(k), str) or not caption[k].strip()]
            if bad:
                raise ManifestError(f"{where}: gallery entries need {bad}")
        elif caption:
            raise ManifestError(f"{where}: {sorted(caption)} only apply to gallery entries")
        src = w.get("source", {})
        for key in ("url", "sha256", "title", "author", "page", "terms"):
            if not isinstance(src.get(key), str) or not src[key]:
                raise ManifestError(f"{where}.source.{key}: required string")
        if src["url"].lower().endswith(".svg") and not (
            isinstance(src.get("svgClass"), str) and isinstance(src.get("rasterWidth"), int)
        ):
            raise ManifestError(f"{where}.source: SVG sources need svgClass and rasterWidth")
        wm = w.get("watermark")
        if wm is not None and wm not in template_urls:
            raise ManifestError(f"{where}.watermark: unknown template set {wm!r}")
        merged = {**defaults, **w.get("params", {})}
        missing = [k for k in PARAM_KEYS if k not in merged]
        unknown = [k for k in w.get("params", {}) if k not in PARAM_KEYS]
        if missing or unknown:
            raise ManifestError(f"{where}.params: missing {missing} unknown {unknown}")
        params = Params(**{k: merged[k] for k in PARAM_KEYS})
        if not (0 < params.threshold < 255 and params.upscale >= 1 and 0 <= params.padding < 0.5):
            raise ManifestError(f"{where}.params: threshold/upscale/padding out of range")
        crop = _box(w.get("crop"), f"{where}.crop")
        if crop[2] <= 0 or crop[3] <= 0:
            raise ManifestError(f"{where}.crop: width and height must be positive")
        words.append(Word(
            id=wid,
            kind=kind,
            arabic=w["arabic"],
            caption=caption,
            source=src,
            watermark=wm,
            crop=crop,
            keep=_poly(w["keep"], f"{where}.keep") if "keep" in w else None,
            erase=[_poly(p, f"{where}.erase[{j}]") for j, p in enumerate(w.get("erase", []))],
            strip_vertical=[_box(b, f"{where}.stripVertical[{j}]") for j, b in enumerate(w.get("stripVertical", []))],
            close_vertical=[_box(b, f"{where}.closeVertical[{j}]") for j, b in enumerate(w.get("closeVertical", []))],
            params=params,
        ))
    return template_urls, words


# ------------------------------------------------------------------ fetch


def fetch(url: str, cache: Path) -> Path:
    name = hashlib.sha256(url.encode()).hexdigest()[:24] + Path(urllib.parse.urlparse(url).path).suffix.lower()
    dest = cache / name
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(body)
        tmp.replace(dest)
    return dest


def load_source(word: Word, cache: Path) -> np.ndarray:
    path = fetch(word.source["url"], cache)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != word.source["sha256"]:
        raise SystemExit(f"{word.id}: sha256 mismatch for {word.source['url']}: got {digest}")
    if path.suffix == ".svg":
        img = rasterise_svg_class(path, word.source["svgClass"], word.source["rasterWidth"])
    else:
        img = Image.open(path)
        if img.mode in ("RGBA", "LA", "P"):
            img = Image.alpha_composite(Image.new("RGBA", img.size, "white"), img.convert("RGBA"))
        img = img.convert("L")
    return np.asarray(img, dtype=np.float32)


def rasterise_svg_class(path: Path, css_class: str, width: int) -> Image.Image:
    """Render only the paths of one CSS class, black on white."""
    text = path.read_text(encoding="utf-8")
    view_box = re.search(r'viewBox="([^"]+)"', text)
    if not view_box:
        raise SystemExit(f"{path}: SVG without viewBox")
    paths = [re.search(r'\bd="([^"]*)"', p, re.DOTALL).group(1)
             for p in re.findall(rf'<path\b[^>]*\bclass="{re.escape(css_class)}"[^>]*>', text, re.DOTALL)]
    if not paths:
        raise SystemExit(f"{path}: no <path class={css_class!r}>")
    vx, vy, vw, vh = (float(v) for v in view_box.group(1).replace(",", " ").split())
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx} {vy} {vw} {vh}">'
           f'<rect x="{vx}" y="{vy}" width="{vw}" height="{vh}" fill="#fff"/>'
           + "".join(f'<path fill="#000" d="{d}"/>' for d in paths) + "</svg>")
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "in.svg", Path(tmp) / "out.png"
        src.write_text(svg, encoding="utf-8")
        run_inkscape([str(src), "--export-type=png", f"--export-width={width}",
                      "--export-background=white", "--export-background-opacity=1", f"--export-filename={out}"])
        return Image.open(out).convert("L")


def run_inkscape(args: list[str]) -> None:
    exe = shutil.which("inkscape")
    if not exe:
        raise SystemExit("inkscape is required (SVG sources and the contact sheet)")
    subprocess.run([exe, *args], check=True, capture_output=True)


# -------------------------------------------------------------- watermark


def template_stats(obs: np.ndarray, size: tuple[int, int], box: tuple[int, int, int, int], urls: list[str],
                   cache: Path, rank: int, count: int) -> tuple[np.ndarray, np.ndarray, int]:
    """Watermark over black and over white for ``box``, from the ``count`` templates closest to ``obs``.

    The sets mix watermark variants (opacity, layout), so templates are ranked
    by their mean absolute difference to the target over pixels that are light
    in both, where only the faint watermark shows; the target's own preview
    (difference ~0) is skipped. Ranking runs on a 4x subsampled crop; only the
    chosen templates are decoded at full resolution, and order statistics are
    taken in row bands to bound memory.
    """
    key = hashlib.sha256(json.dumps([urls, size, box, rank, count]).encode() + obs.tobytes()).hexdigest()[:24]
    cached = cache / f"stats-{key}.npz"
    if cached.exists():
        z = np.load(cached)
        return z["over_black"], z["over_white"], int(z["n"])

    def load(url: str, step: int) -> np.ndarray | None:
        im = Image.open(fetch(url, cache))
        if im.size != size:
            return None
        return np.asarray(im.convert("L").crop(box), dtype=np.uint8)[::step, ::step]

    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        pairs = [(u, a) for u, a in zip(urls, pool.map(lambda u: load(u, 4), urls)) if a is not None]
    small_obs = obs[::4, ::4]
    light = small_obs > 200
    dist = np.array([np.abs(a.astype(np.float32) - small_obs)[light & (a > 200)].mean() for _, a in pairs])
    order = [i for i in np.argsort(dist) if dist[i] > 0.5][:count]
    matched = [pairs[i][0] for i in order]
    del pairs  # free the subsampled stack before decoding full-resolution crops
    if len(matched) < 4 * rank:
        raise SystemExit(f"only {len(matched)} templates available")
    n = len(matched)
    stack = np.empty((n, box[3] - box[1], box[2] - box[0]), np.uint8)
    for i, u in enumerate(matched):
        stack[i] = load(u, 1)
    over_black = np.empty(stack.shape[1:], np.float32)
    over_white = np.empty(stack.shape[1:], np.float32)
    for r in range(0, stack.shape[1], 64):
        part = np.partition(stack[:, r:r + 64], [rank, n // 2], axis=0)
        over_black[r:r + 64], over_white[r:r + 64] = part[rank], part[n // 2]
    np.savez_compressed(cached, over_black=over_black, over_white=over_white, n=n)
    return over_black, over_white, n


def unblend(target: Image.Image, crop: tuple[int, int, int, int], urls: list[str], cache: Path,
            rank: int, count: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns (ink estimate, mask of pixels under the watermark)."""
    x, y, w, h = crop
    box = (x, y, x + w, y + h)
    obs = np.asarray(target.convert("L").crop(box), dtype=np.float32)
    over_black, over_white, n = template_stats(obs, target.size, box, urls, cache, rank, count)
    span = over_white - over_black
    print(f"  watermark: {n} closest of {len(urls)} templates")
    ink = np.where(span > 40, 255 * (obs - over_black) / np.maximum(span, 1), obs)
    # Under the watermark: visible over white, or never seen as clean black
    # (which also covers spots no template had ink on).
    overlay = (over_white < 245) | (over_black > 40)
    return np.clip(ink, 0, 255), ndi.binary_dilation(overlay, iterations=2)


# ---------------------------------------------------------------- bitmap


def poly_mask(shape: tuple[int, int], poly: list[tuple[float, float]], origin: tuple[int, int]) -> np.ndarray:
    ox, oy = origin
    img = Image.new("1", (shape[1], shape[0]), 0)
    ImageDraw.Draw(img).polygon([(px - ox, py - oy) for px, py in poly], fill=1)
    return np.asarray(img, dtype=bool)


def select(gray: np.ndarray, overlay: np.ndarray | None, word: Word) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (smoothed grey, final ink mask, component labels before selection).

    Un-blending amplifies JPEG noise by 255 / (M - m), so pixels under the
    watermark get a wider median (``overlayMedian``) than the rest (3x3).
    """
    p = word.params
    origin = word.crop[:2]
    denoised = ndi.median_filter(gray, size=3)
    if overlay is not None and p.overlayMedian > 3:
        denoised = np.where(overlay, ndi.median_filter(gray, size=p.overlayMedian), denoised)
    gray = denoised
    ink = gray < p.threshold
    for bx, by, bw, bh in word.strip_vertical:
        ys, xs = slice(by - origin[1], by - origin[1] + bh), slice(bx - origin[0], bx - origin[0] + bw)
        ink[ys, xs] = ndi.binary_opening(ink[ys, xs], structure=np.ones((p.stripLength, 1), bool))
    for bx, by, bw, bh in word.close_vertical:
        ys, xs = slice(by - origin[1], by - origin[1] + bh), slice(bx - origin[0], bx - origin[0] + bw)
        ink[ys, xs] |= ndi.binary_closing(ink[ys, xs], structure=np.ones((p.stripLength, 1), bool), border_value=0)
    for poly in word.erase:
        ink &= ~poly_mask(ink.shape, poly, origin)
    labels, n = ndi.label(ink, structure=np.ones((3, 3), bool))
    idx = np.arange(1, n + 1)
    areas = ndi.sum_labels(ink, labels, idx)
    cents = ndi.center_of_mass(ink, labels, idx)
    keep_mask = poly_mask(ink.shape, word.keep, origin) if word.keep else np.ones(ink.shape, bool)
    kept = [i for i, a, (cy, cx) in zip(idx, areas, cents)
            if a >= p.minArea and keep_mask[min(round(cy), ink.shape[0] - 1), min(round(cx), ink.shape[1] - 1)]]
    sel = np.isin(labels, kept)
    holes = ndi.binary_fill_holes(sel) & ~sel
    hl, hn = ndi.label(holes)
    if hn:
        small = np.flatnonzero(ndi.sum_labels(holes, hl, np.arange(1, hn + 1)) <= p.holeMax) + 1
        sel |= np.isin(hl, small)
    # Keep the anti-aliased grey along the selected edges, white elsewhere.
    # Halo pixels that are ink of a removed shape (e.g. a mark crossing a
    # kept stroke) go white so they do not thicken the kept edge.
    grown = ndi.binary_dilation(sel, iterations=1)
    smooth = np.where(grown & ~(gray < p.threshold) | sel, gray, 255.0)
    smooth[sel & (smooth > p.threshold)] = 0.0
    return smooth, sel, labels


def to_bitmap(smooth: np.ndarray, sel: np.ndarray, p: Params) -> tuple[np.ndarray, tuple[int, int]]:
    ys, xs = np.nonzero(sel)
    m = 4
    y0, y1 = max(ys.min() - m, 0), min(ys.max() + m + 1, sel.shape[0])
    x0, x1 = max(xs.min() - m, 0), min(xs.max() + m + 1, sel.shape[1])
    sub = Image.fromarray(smooth[y0:y1, x0:x1].astype(np.uint8))
    big = sub.resize((sub.width * p.upscale, sub.height * p.upscale), Image.LANCZOS)
    if p.blur > 0:
        big = big.filter(ImageFilter.GaussianBlur(p.blur * p.upscale))
    return np.asarray(big) < p.threshold, (x0, y0)


# ------------------------------------------------------------------- svg


def trace_svg(bitmap: np.ndarray, p: Params) -> tuple[str, float, float]:
    # potracer.Bitmap inverts its input, so hand it the background.
    curves = potrace.Bitmap(~bitmap).trace(
        turdsize=round(p.turdsize * p.upscale ** 2),
        turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
        alphamax=p.alphamax, opticurve=True, opttolerance=p.opttolerance,
    )
    ys, xs = np.nonzero(bitmap)
    gx0, gy0, gx1, gy1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    pad = p.padding * max(gx1 - gx0, gy1 - gy0)
    vw, vh = gx1 - gx0 + 2 * pad, gy1 - gy0 + 2 * pad
    s = VIEWBOX_LONG_SIDE / max(vw, vh)

    def q10(pnt) -> tuple[int, int]:
        """Point in tenths of a viewBox unit."""
        return round((pnt.x - gx0 + pad) * s * 10), round((pnt.y - gy0 + pad) * s * 10)

    def num(v: int) -> str:
        t = f"{v / 10:g}"
        return t.replace("0.", ".", 1) if t.startswith(("0.", "-0.")) else t

    def nums(vals: list[int]) -> str:
        """Join numbers, omitting separators the path grammar does not need."""
        out, prev = [], ""
        for v in vals:
            t = num(v)
            if out and not (t[0] == "-" or (t[0] == "." and "." in prev)):
                out.append(" ")
            out.append(t)
            prev = t
        return "".join(out)

    # Relative commands between already-rounded points: same precision as
    # absolute coordinates, no drift, much shorter.
    parts = []
    for c in curves:
        cur = q10(c.start_point)
        seg = ["M" + nums(list(cur))]
        for g in c.segments:
            if g.is_corner:
                a, b = q10(g.c), q10(g.end_point)
                seg.append("l" + nums([a[0] - cur[0], a[1] - cur[1], b[0] - a[0], b[1] - a[1]]))
                cur = b
            else:
                a, b, e = q10(g.c1), q10(g.c2), q10(g.end_point)
                seg.append("c" + nums([a[0] - cur[0], a[1] - cur[1], b[0] - cur[0], b[1] - cur[1], e[0] - cur[0], e[1] - cur[1]]))
                cur = e
        parts.append("".join(seg) + "z")
    d = "".join(parts)
    W, H = round(vw * s, 1), round(vh * s, 1)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:g} {H:g}" width="{W:g}" height="{H:g}">'
           f'<path fill="#000" fill-rule="evenodd" d="{d}"/></svg>\n')
    return svg, W, H


# ----------------------------------------------------------------- debug


def debug_images(word: Word, gray: np.ndarray, sel: np.ndarray, labels: np.ndarray, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    ox, oy = word.crop[:2]
    Image.fromarray(gray.astype(np.uint8)).save(out / f"{word.id}-ink.png")
    rng = np.random.default_rng(7)
    cols = rng.integers(0, 190, size=(labels.max() + 1, 3)).astype(np.uint8)
    cols[0] = 255
    rgb = cols[labels]
    rgb[(labels > 0) & ~sel] = 215  # dropped: light grey
    im = Image.fromarray(rgb)
    scale = 1600 / max(im.size)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.NEAREST)
    d = ImageDraw.Draw(im)
    step = 25 if max(word.crop[2:]) < 1200 else 100
    for gx in range((ox // step + 1) * step, ox + word.crop[2], step):
        X = (gx - ox) * scale
        d.line([(X, 0), (X, im.height)], fill=(150, 150, 255) if gx % (4 * step) else (60, 60, 255))
        d.text((X + 2, 2), str(gx), fill=(0, 0, 180))
    for gy in range((oy // step + 1) * step, oy + word.crop[3], step):
        Y = (gy - oy) * scale
        d.line([(0, Y), (im.width, Y)], fill=(150, 150, 255) if gy % (4 * step) else (60, 60, 255))
        d.text((2, Y + 2), str(gy), fill=(0, 0, 180))
    for poly, colour in [(word.keep or [], (0, 160, 0))] + [(e, (220, 0, 0)) for e in word.erase]:
        if not poly:
            continue
        d.line([((x - ox) * scale, (y - oy) * scale) for x, y in poly + poly[:1]], fill=colour, width=2)
    for bx, by, bw, bh in word.strip_vertical:
        d.rectangle([(bx - ox) * scale, (by - oy) * scale, (bx - ox + bw) * scale, (by - oy + bh) * scale], outline=(255, 120, 0), width=2)
    im.save(out / f"{word.id}-cc.png")


# ------------------------------------------------------------------ build


def build(args: argparse.Namespace) -> None:
    template_urls, words = load_manifest(args.manifest)
    if args.only:
        unknown = sorted(set(args.only) - {w.id for w in words})
        if unknown:
            raise SystemExit(f"--only: unknown ids {unknown}")
        targets = [w for w in words if w.id in args.only]
    else:
        targets = words
    args.cache.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    for word in targets:
        gray_full = load_source(word, args.cache)
        x, y, w, h = word.crop
        if x < 0 or y < 0 or x + w > gray_full.shape[1] or y + h > gray_full.shape[0]:
            raise SystemExit(f"{word.id}: crop {word.crop} outside source {gray_full.shape[::-1]}")
        if word.watermark:
            target = Image.fromarray(gray_full.astype(np.uint8))
            gray, overlay = unblend(target, word.crop, template_urls[word.watermark], args.cache,
                                    word.params.templateRank, word.params.templateCount)
        else:
            gray, overlay = gray_full[y:y + h, x:x + w], None
        smooth, sel, labels = select(gray, overlay, word)
        if not sel.any():
            raise SystemExit(f"{word.id}: nothing selected")
        if args.debug_dir:
            debug_images(word, gray, sel, labels, args.debug_dir)
        bitmap, _ = to_bitmap(smooth, sel, word.params)
        svg, W, H = trace_svg(bitmap, word.params)
        (args.out / f"{word.id}.svg").write_text(svg, encoding="utf-8")
        print(f"{word.id}: {W:g}x{H:g} aspect {W / H:.3f}, {len(svg) / 1024:.1f} KiB")
    if args.only:
        print("index.json not rewritten (--only)")
        return
    write_index(words, args.out)


def write_index(words: list[Word], out: Path) -> None:
    """Write index.json (manifest order) and CREDITS.md from the built SVGs."""
    index = []
    for word in words:
        path = out / f"{word.id}.svg"
        if not path.exists():
            raise SystemExit(f"{path} missing; build it first")
        W, H = (float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', path.read_text()).groups())
        index.append({
            "id": word.id,
            "kind": word.kind,
            "arabic": word.arabic,
            **word.caption,
            "file": path.name,
            "aspect": round(W / H, 4),
            "source": {"url": word.source["page"], "title": word.source["title"], "author": word.source["author"]},
        })
    stale = sorted(p.name for p in out.glob("*.svg") if p.stem not in {w.id for w in words})
    if stale:
        raise SystemExit(f"stale files in {out}: {stale}")
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "CREDITS.md").write_text(credits(words), encoding="utf-8")
    print(f"wrote {out / 'index.json'} and CREDITS.md ({len(index)} entries)")


def credits(words: list[Word]) -> str:
    def cell(text: str) -> str:
        return text.replace("|", "\\|")

    rows = [
        f"| {w.id}.svg | {w.kind} | {cell(w.arabic)} | {cell(w.source['author'])} | "
        f"[{cell(w.source['title'])}]({w.source['page']}) | {cell(w.source['terms'])} |"
        for w in words
    ]
    return (
        "# Calligraphy credits\n\n"
        "Generated by `scripts/calligraphy/process.py` from `scripts/calligraphy/manifest.json`.\n"
        "Each file is vectorized from the artist's image (cropped to the text, cleaned,\n"
        "traced to an SVG path).\n\n"
        "| File | Kind | Text | Artist | Source | Terms |\n|---|---|---|---|---|---|\n"
        + "\n".join(rows) + "\n"
    )


# ------------------------------------------------------------------ sheet


def gold(width: int, height: int) -> Image.Image:
    t = np.linspace(0, 1, height)[:, None]
    stops = np.array([s for s, _ in GOLD_STOPS])
    rgb = np.stack([np.interp(t, stops, [c[i] for _, c in GOLD_STOPS]) for i in range(3)], -1)
    return Image.fromarray(np.repeat(rgb, width, axis=1).astype(np.uint8), "RGB")


def sheet(args: argparse.Namespace) -> None:
    index = json.loads((args.out / "index.json").read_text(encoding="utf-8"))
    if args.kind:
        index = [e for e in index if e["kind"] in args.kind]
    if not index:
        raise SystemExit("nothing to render")
    if args.height < 50:
        raise SystemExit("--height must be at least 50")
    if args.columns < 1:
        raise SystemExit("--columns must be at least 1")
    tiles = []
    size = max(14, args.height // 9)
    font = ImageFont.load_default(size=size)
    with tempfile.TemporaryDirectory() as tmp:
        for entry in index:
            png = Path(tmp) / f"{entry['id']}.png"
            run_inkscape([str(args.out / entry["file"]), "--export-type=png", f"--export-height={args.height}",
                          f"--export-filename={png}"])
            alpha = Image.open(png).getchannel("A")
            label = f"{entry['id']}  ({entry['aspect']})"
            width = max(alpha.width, round(font.getlength(label)))
            tile = Image.new("RGB", (width + 40, alpha.height + 40 + 2 * size), SHEET_BG)
            tile.paste(gold(*alpha.size), (20 + (width - alpha.width) // 2, 20), alpha)
            ImageDraw.Draw(tile).text((20, alpha.height + 30), label, fill=(170, 185, 210), font=font)
            tiles.append(tile)
    cols = min(args.columns, len(tiles))
    rows = -(-len(tiles) // cols)
    cw, ch = max(t.width for t in tiles), max(t.height for t in tiles)
    out = Image.new("RGB", (cols * cw, rows * ch), SHEET_BG)
    for i, t in enumerate(tiles):
        out.paste(t, ((i % cols) * cw + (cw - t.width) // 2, (i // cols) * ch))
    args.png.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.png)
    print(f"wrote {args.png} ({out.width}x{out.height})")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build SVGs and index.json")
    b.add_argument("--only", nargs="+", metavar="ID")
    b.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    b.add_argument("--debug-dir", type=Path, help="write per-word ink/component maps here")
    sub.add_parser("index", help="write index.json and CREDITS.md from the built SVGs")
    s = sub.add_parser("sheet", help="render a gold-on-navy contact sheet PNG")
    s.add_argument("png", type=Path)
    s.add_argument("--height", type=int, default=260, help="glyph height in px")
    s.add_argument("--columns", type=int, default=3)
    s.add_argument("--kind", nargs="+", choices=KINDS, help="only these kinds")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "build":
            build(args)
        elif args.cmd == "index":
            write_index(load_manifest(args.manifest)[1], args.out)
        else:
            sheet(args)
    except ManifestError as e:
        sys.exit(f"manifest error: {e}")


if __name__ == "__main__":
    main()
