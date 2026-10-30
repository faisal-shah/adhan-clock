# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build the bundled audio assets in public/audio/ from scripts/audio/manifest.json.

For every manifest entry this script:

1. obtains the original: downloads ``source.url`` into a cache directory and
   checks its SHA-256, or synthesizes it with ffmpeg (``synth: "chime"``);
2. decodes it to mono at the output sample rate and applies the manual
   ``trim`` window, if any;
3. trims leading/trailing silence, keeping ``keepSilenceSec`` of it;
4. applies fade-in/out and two-pass EBU R128 ``loudnorm``;
5. encodes a CBR MP3 and re-measures the result.

It then writes ``index.json`` (consumed by the app) and ``CREDITS.md``.
Every derived value (durations, the "modified" note) comes from this run, so
the manifest is the single source of truth.

Usage (from the repo root)::

    uv run scripts/audio/process.py            # build everything
    uv run scripts/audio/process.py --only chime

Requires ``ffmpeg`` and ``ffprobe`` (with libmp3lame) on PATH.
"""
from __future__ import annotations

import argparse
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

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "scripts" / "audio" / "manifest.json"
DEFAULT_OUT = REPO / "public" / "audio"
DEFAULT_CACHE = Path(tempfile.gettempdir()) / "adhan-clock-audio-src"
USER_AGENT = "adhan-clock-audio-build/1.0 (https://github.com/faisal-shah/adhan-clock; faisal.shah@gmail.com)"

KINDS = ("athan", "fajr", "chime")
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FILE_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.mp3$")
CREDIT_KEYS = ("title", "author", "sourceUrl", "license", "licenseUrl")
SETTING_KEYS = (
    "targetLufs", "truePeakDb", "lraTarget", "bitrateKbps", "sampleRate",
    "keepSilenceSec", "silenceThresholdDb", "fadeInSec", "fadeOutSec",
)


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    targetLufs: float
    truePeakDb: float
    lraTarget: float
    bitrateKbps: int
    sampleRate: int
    keepSilenceSec: float
    silenceThresholdDb: float
    fadeInSec: float
    fadeOutSec: float


# ---------------------------------------------------------------- manifest

def load_manifest(path: Path) -> tuple[Settings, list[dict]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"manifest not found: {path}") from None
    except json.JSONDecodeError as e:
        raise ManifestError(f"{path}: invalid JSON: {e}") from None
    defaults = data.get("defaults")
    entries = data.get("entries")
    if not isinstance(defaults, dict) or not isinstance(entries, list) or not entries:
        raise ManifestError("manifest needs a 'defaults' object and a non-empty 'entries' array")
    missing = [k for k in SETTING_KEYS if k not in defaults]
    if missing:
        raise ManifestError(f"defaults missing: {', '.join(missing)}")
    seen_ids: set[str] = set()
    seen_files: set[str] = set()
    for i, e in enumerate(entries):
        where = f"entries[{i}] ({e.get('id', '?')})"
        for key in ("id", "kind", "file", "label", "credit"):
            if key not in e:
                raise ManifestError(f"{where}: missing '{key}'")
        if not ID_RE.match(e["id"]):
            raise ManifestError(f"{where}: id must be lowercase kebab-case")
        if not FILE_RE.match(e["file"]):
            raise ManifestError(f"{where}: file must be a lowercase kebab-case .mp3 name")
        if e["kind"] not in KINDS:
            raise ManifestError(f"{where}: kind must be one of {KINDS}")
        if e["id"] in seen_ids or e["file"] in seen_files:
            raise ManifestError(f"{where}: duplicate id or file")
        seen_ids.add(e["id"])
        seen_files.add(e["file"])
        has_url = isinstance(e.get("source"), dict) and "url" in e["source"]
        if has_url == ("synth" in e):
            raise ManifestError(f"{where}: needs exactly one of 'source.url' or 'synth'")
        if has_url and not re.fullmatch(r"[0-9a-f]{64}", e["source"].get("sha256", "")):
            raise ManifestError(f"{where}: source.sha256 must be a lowercase hex SHA-256")
        if "synth" in e and e["synth"] not in SYNTHS:
            raise ManifestError(f"{where}: unknown synth '{e['synth']}' (known: {', '.join(SYNTHS)})")
        credit = e["credit"]
        missing = [k for k in CREDIT_KEYS if k != "licenseUrl" and not (isinstance(credit.get(k), str) and credit[k])]
        if missing:
            raise ManifestError(f"{where}: credit missing {', '.join(missing)}")
        lic_url = credit.get("licenseUrl", "absent")
        if not (lic_url is None or (isinstance(lic_url, str) and lic_url.startswith("https://"))):
            raise ManifestError(f"{where}: credit.licenseUrl must be an https URL or null (license unknown)")
        if not credit["sourceUrl"].startswith("https://"):
            raise ManifestError(f"{where}: credit.sourceUrl must be an https URL")
        trim = e.get("trim", {})
        start, end = trim.get("startSec", 0.0), trim.get("endSec")
        if start < 0 or (end is not None and end <= start):
            raise ManifestError(f"{where}: trim needs 0 <= startSec < endSec")
        unknown = set(e.get("overrides", {})) - set(SETTING_KEYS)
        if unknown:
            raise ManifestError(f"{where}: unknown overrides {sorted(unknown)}")
    return Settings(**{k: defaults[k] for k in SETTING_KEYS}), entries


def settings_for(base: Settings, entry: dict) -> Settings:
    return Settings(**{**base.__dict__, **entry.get("overrides", {})})


# ---------------------------------------------------------------- ffmpeg helpers

def run(cmd: list[str]) -> str:
    """Run a command, return stderr (ffmpeg reports on stderr); raise on failure."""
    p = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr[-2000:]}")
    return p.stderr


def ffmpeg(*args: str) -> str:
    return run(["ffmpeg", "-hide_banner", "-nostdin", "-y", *args])


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return float(out.strip())


def probe_stream(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_name,sample_rate,channels,bit_rate", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)["streams"][0]


def ebur128(path: Path) -> tuple[float, float]:
    """Integrated loudness (LUFS) and true peak (dBFS) of a file."""
    r = ffmpeg("-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-")
    summary = r[r.rindex("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    return i, tp


def last_json_block(text: str) -> dict:
    start = text.rindex("{")
    return json.loads(text[start: text.index("}", start) + 1])


# ---------------------------------------------------------------- sources

def fetch(url: str, sha256: str, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".bin"
    dest = cache / f"{sha256}{suffix}"
    if dest.exists() and file_sha256(dest) == sha256:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
        shutil.copyfileobj(resp, f)
    got = file_sha256(tmp)
    if got != sha256:
        tmp.unlink()
        raise RuntimeError(f"SHA-256 mismatch for {url}: expected {sha256}, got {got}")
    tmp.replace(dest)
    return dest


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def synth_chime(dest: Path, sample_rate: int) -> None:
    """Soft three-note arpeggio (C5-G5-C6), singing-bowl-like partials, short room echo.

    Each note is a sum of sine partials with exponential decay and a 4 ms
    attack ramp (click-free). A 1.2 Hz-detuned twin of the fundamental gives a
    slow shimmer; a slightly inharmonic 2.76x partial adds bowl-like sparkle.
    """
    notes = [(0.00, 523.25, 1.00), (0.16, 783.99, 0.80), (0.32, 1046.50, 0.60)]  # onset s, Hz, gain
    partials = [(1.0, 1.00, 1.10), (1.0023, 0.50, 1.10), (2.0, 0.18, 0.55), (2.76, 0.10, 0.35), (5.40, 0.03, 0.15)]
    attack, duration = 0.004, 3.6
    terms = []
    for onset, f0, gain in notes:
        t = f"(t-{onset})"
        for ratio, amp, tau in partials:
            terms.append(
                f"gt(t,{onset})*{gain * amp:.4f}*(1-exp(-{t}/{attack}))*exp(-{t}/{tau})*sin(2*PI*{f0 * ratio:.3f}*{t})"
            )
    expr = "0.12*(" + "+".join(terms) + ")"
    ffmpeg(
        "-f", "lavfi", "-i", f"aevalsrc=exprs='{expr}':s={sample_rate}:d={duration}",
        "-af", "aecho=0.8:0.6:47|83|131:0.22|0.15|0.10,afade=t=out:st=2.9:d=0.7",
        "-c:a", "pcm_f32le", str(dest),
    )


SYNTHS = {"chime": synth_chime}


# ---------------------------------------------------------------- processing

def silence_bounds(wav: Path, threshold_rel_db: float) -> tuple[float, float, float]:
    """Return (first_sound, last_sound, duration) using a threshold relative to the peak."""
    dur = probe_duration(wav)
    vd = ffmpeg("-i", str(wav), "-af", "volumedetect", "-f", "null", "-")
    peak = float(re.search(r"max_volume: (-?[\d.]+) dB", vd).group(1))
    noise = peak + threshold_rel_db
    sd = ffmpeg("-i", str(wav), "-af", f"silencedetect=noise={noise:.1f}dB:d=0.05", "-f", "null", "-")
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", sd)]
    ends = [float(x) for x in re.findall(r"silence_end: (-?[\d.]+)", sd)]
    first, last = 0.0, dur
    if starts and starts[0] <= 0.01 and ends:
        first = ends[0]
    if starts and (len(ends) < len(starts) or ends[-1] >= dur - 0.01):
        last = starts[-1]
    return first, last, dur


def process_entry(entry: dict, base: Settings, out_dir: Path, cache: Path, work: Path) -> dict:
    s = settings_for(base, entry)
    eid = entry["id"]
    if "synth" in entry:
        original = work / f"{eid}-synth.wav"
        SYNTHS[entry["synth"]](original, s.sampleRate)
    else:
        original = fetch(entry["source"]["url"], entry["source"]["sha256"], cache)

    # 1) decode to mono float WAV, applying the manual trim window
    trim = entry.get("trim", {})
    t0, t1 = trim.get("startSec", 0.0), trim.get("endSec")
    if t0 >= probe_duration(original):
        raise ManifestError(f"{eid}: trim startSec {t0} is past the end of the source")
    atrim = f"atrim=start={t0}" + (f":end={t1}" if t1 is not None else "")
    mono = work / f"{eid}-mono.wav"
    ffmpeg("-i", str(original), "-map", "0:a:0", "-af", f"{atrim},asetpts=PTS-STARTPTS",
           "-ac", "1", "-ar", str(s.sampleRate), "-c:a", "pcm_f32le", str(mono))
    if t1 is not None and probe_duration(mono) < (t1 - t0) - 0.05:
        raise ManifestError(f"{eid}: trim endSec {t1} is past the end of the source")

    # 2) leading/trailing silence
    first, last, dur = silence_bounds(mono, s.silenceThresholdDb)
    a = max(0.0, first - s.keepSilenceSec)
    b = min(dur, last + s.keepSilenceSec)
    length = b - a
    if length < 1.0:
        raise RuntimeError(f"{eid}: only {length:.2f}s left after silence trim")
    fades = (f"afade=t=in:st=0:d={s.fadeInSec},"
             f"afade=t=out:st={length - s.fadeOutSec:.3f}:d={s.fadeOutSec}")
    pre = f"atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,{fades}"
    ln = f"loudnorm=I={s.targetLufs}:TP={s.truePeakDb}:LRA={s.lraTarget}"

    # 3) loudnorm pass 1 (measure), pass 2 (apply, linear when possible)
    m = last_json_block(ffmpeg("-i", str(mono), "-af", f"{pre},{ln}:print_format=json", "-f", "null", "-"))
    measured = (f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    out = out_dir / entry["file"]
    credit = entry["credit"]

    # 4) encode, then verify with ebur128. loudnorm's integrated estimate drifts on
    #    short clips (the chime lands ~1 LU hot), so apply a small corrective gain
    #    until the encoded file measures within 0.3 LU of target, never pushing the
    #    true peak above the ceiling.
    trim_gain = 0.0
    for _ in range(3):
        p2 = ffmpeg(
            "-i", str(mono),
            "-af", f"{pre},{ln}:{measured}:print_format=json,volume={trim_gain:.2f}dB,aresample={s.sampleRate}",
            "-map_metadata", "-1",
            "-metadata", f"title={entry['label']}",
            "-metadata", f"artist={credit['author']}",
            "-metadata", f"comment=Source: {credit['sourceUrl']} | License: {credit['license']}",
            "-c:a", "libmp3lame", "-b:a", f"{s.bitrateKbps}k", "-ac", "1", "-ar", str(s.sampleRate),
            str(out),
        )
        norm_type = last_json_block(p2)["normalization_type"]
        out_i, out_tp = ebur128(out)
        step = min(s.targetLufs - out_i, s.truePeakDb - out_tp)
        if abs(s.targetLufs - out_i) <= 0.3 or abs(step) < 0.1:
            break
        trim_gain += step

    st = probe_stream(out)
    if st["codec_name"] != "mp3" or int(st["sample_rate"]) != s.sampleRate or int(st["channels"]) != 1:
        raise RuntimeError(f"{eid}: unexpected output stream {st}")
    if out_tp > s.truePeakDb + 0.2:
        raise RuntimeError(f"{eid}: true peak {out_tp} dBFS exceeds ceiling {s.truePeakDb}")
    out_dur = probe_duration(out)

    origin = (
        f"Trimmed to {t0 + a:.2f}–{t0 + b:.2f} s of the original, downmixed to mono"
        if "source" in entry
        else "Synthesized with ffmpeg"
    )
    modified = (
        f"{origin}; {s.fadeInSec:g} s fade-in / {s.fadeOutSec:g} s fade-out; "
        f"loudness-normalized to {s.targetLufs:g} LUFS; encoded as {s.bitrateKbps} kbps mono MP3."
    )
    return {
        "id": eid,
        "kind": entry["kind"],
        "file": entry["file"],
        "label": entry["label"],
        "durationSec": round(out_dur, 2),
        "credit": {**{k: credit[k] for k in CREDIT_KEYS}, "modified": modified},
        "_report": {"I": out_i, "TP": out_tp, "norm": norm_type, "trimGain": trim_gain, "srcDur": t0 + dur},
    }


# ---------------------------------------------------------------- outputs

def write_credits(path: Path, items: list[dict], entries: dict[str, dict]) -> None:
    lines = [
        "# Audio credits",
        "",
        "Generated by `scripts/audio/process.py` from `scripts/audio/manifest.json`. Do not edit by hand.",
        "",
    ]
    for it in items:
        c = it["credit"]
        e = entries[it["id"]]
        lic = f"[{c['license']}]({c['licenseUrl']})" if c["licenseUrl"] else c["license"]
        lines += [
            f"## `{it['file']}` — {it['label']}",
            "",
            f"- Title: {c['title']}",
            f"- Author / reciter: {c['author']}",
            f"- Source: <{c['sourceUrl']}>",
            f"- License: {lic}",
        ]
        if e.get("licenseNote"):
            lines.append(f"- License note: {e['licenseNote']}")
        if e.get("verification"):
            lines.append(f"- Content check: {e['verification']}")
        lines += [f"- Changes: {c['modified']}", f"- Duration: {it['durationSec']:.1f} s", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE,
                    help=f"where downloaded originals are kept (default: {DEFAULT_CACHE})")
    ap.add_argument("--only", nargs="+", metavar="ID", help="rebuild only these ids (index/credits still list all)")
    args = ap.parse_args(argv)

    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            ap.error(f"{tool} not found on PATH")
    try:
        base, entries = load_manifest(args.manifest)
    except ManifestError as e:
        ap.error(str(e))
    by_id = {e["id"]: e for e in entries}
    if args.only:
        unknown = [i for i in args.only if i not in by_id]
        if unknown:
            ap.error(f"unknown id(s): {', '.join(unknown)} (known: {', '.join(by_id)})")
    if not args.out_dir.is_dir():
        ap.error(f"output directory does not exist: {args.out_dir}")

    index_path = args.out_dir / "index.json"
    previous = {}
    if args.only and index_path.exists():
        previous = {it["id"]: it for it in json.loads(index_path.read_text(encoding="utf-8"))}

    items = []
    with tempfile.TemporaryDirectory(prefix="adhan-audio-") as tmp:
        for e in entries:
            if args.only and e["id"] not in args.only:
                if e["id"] not in previous:
                    ap.error(f"{e['id']} is not in the existing index.json; build it too")
                items.append(previous[e["id"]])
                continue
            it = process_entry(e, base, args.out_dir, args.cache_dir, Path(tmp))
            r = it.pop("_report")
            print(f"{it['id']:8s} {it['file']:22s} {it['durationSec']:7.2f}s (src {r['srcDur']:.1f}s)  "
                  f"I={r['I']:6.1f} LUFS  TP={r['TP']:5.1f} dBFS  loudnorm={r['norm']}  trim={r['trimGain']:+.1f} dB")
            items.append(it)

    index_path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_credits(args.out_dir / "CREDITS.md", items, by_id)
    print(f"wrote {index_path} and {args.out_dir / 'CREDITS.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
