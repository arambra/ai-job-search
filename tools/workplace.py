#!/usr/bin/env python3
"""Workplace-type verdict (remote / hybrid / onsite) for one job posting.

Why this exists: `/scrape` trusted the portal's workplace *filter* (LinkedIn's
`--remote remote` -> f_WT=2) as proof a job was remote. It is not. A real run
presented "Senior Azure Integration Developer" (linkedin 4427563735) as a remote
High match; the signed-in posting page labels it **On-site**. LinkedIn's
logged-out endpoints the CLI uses carry no workplace field at all, so the only
evidence is (a) the posting's own text and (b) the workplace label a signed-in
browser shows under the title.

This tool turns that evidence into a verdict. It only counts *work-arrangement*
phrasing, so "hybrid integration solutions", "hybrid identity" or "remote
debugging" never count, while "Position Type: Hybrid", "Work Mode: Remote",
"three days per week onsite" and "#LI-Remote" do.

Verdicts:
  remote   - only remote signals found
  hybrid   - a hybrid / N-days-in-office signal found (beats remote mentions)
  onsite   - an on-site signal found and no remote/hybrid signal
  mixed    - remote AND on-site signals both found; a human must read it
  unknown  - no work-arrangement signal at all. This is NOT remote.

A `--label` (the signed-in page's workplace chip, e.g. "On-site") is the
portal's own structured field and overrides the text scan.

Usage:
  bun run .agents/skills/linkedin-search/cli/src/cli.ts detail 4427563735 \
      | python3 tools/workplace.py
  python3 tools/workplace.py --text "Location: Remote (Canada)"
  python3 tools/workplace.py --text "<description>" --label "On-site"

Reads a detail/search JSON object from stdin when --text is absent (title,
location and description fields are scanned). Prints one JSON object:
  {"workplace": "...", "source": "label|text|none", "evidence": ["..."]}
Exit 0 always on valid input; exit 2 on unreadable input.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

# Each pattern must describe the *work arrangement*, not a technology.
_REMOTE = [
    r"\b(fully|100\s*%|completely|permanently)\s+remote(ly)?\b",
    r"\bwork(s|ed|ing)?\s+(fully\s+|entirely\s+|100\s*%\s+)?remotely\b",
    r"\bremote[\s-]*(first|only|role|position|job|opportunity|work(ing)?|employee|eligible|option|friendly|based)\b",
    r"\b(work|working)\s+(from|at)\s+home\b",
    r"\bwfh\b",
    r"\btelecommut\w*",
    r"\bwork\s*(mode|place|location|arrangement|model|type|setting)\s*[:\-]\s*remote\b",
    r"\b(location|position\s+type|job\s+type|workplace)\s*[:\-]\s*(\w+\s*,?\s*)?remote\b",
    r"#li-remote\b",
    r"\(\s*remote\s*\)",
    r"[-|–—]\s*remote\b",
    r"^\s*remote\s*($|[:(\-|,/])",
    r"\bremote\s+(in|within|across|from\s+anywhere\s+in)\s+(the\s+)?(us|usa|u\.s\.|canada|united\s+states|north\s+america)\b",
    r"\bseeking\s+a\s+remote\b",
    r"\bthis\s+is\s+a\s+remote\b",
]
_HYBRID = [
    r"\bhybrid[\s-]*(work|working|role|position|schedule|model|arrangement|environment|setup|policy|office|basis|option)\b",
    r"\b(work\s*(mode|place|location|arrangement|model|type|setting)|position\s+type|location|workplace|job\s+type)\s*[:\-]\s*hybrid\b",
    r"^\s*hybrid\s*[:\-]",
    r"#li-hybrid\b",
    r"\(\s*hybrid\s*\)",
    r"[-|–—]\s*hybrid\b",
    r"\b(\d|one|two|three|four|five)\s*(\+\s*)?days?\s*(a|per|each|/)\s*week\s*(in|at|on|from)?\s*(the\s+)?(office|on[\s-]?site|in[\s-]person)\b",
    r"\b(\d|one|two|three|four|five)\s*(\+\s*)?days?\s*(in|at)\s*(the\s+)?office\b",
    r"\bin[\s-]office\s+(presence|requirement|days?)\b",
    r"\b(in|at)\s+(the\s+|our\s+)?office\s+(\d|one|two|three|four)\s*(\+\s*)?days?\s*(a|per|each|/)\s*week\b",
    r"\b(\d|one|two|three|four)\s*(\+\s*)?(office|in[\s-]office|on[\s-]?site)\s+days?\b",
]
_ONSITE = [
    r"\bon[\s-]?site\s+(role|position|job|work|only|presence|requirement|\d|five|5)\b",
    r"\b(work\s*(mode|place|location|arrangement|model|type|setting)|position\s+type|location|workplace|job\s+type)\s*[:\-]\s*on[\s-]?site\b",
    r"\b(100\s*%|fully)\s+(on[\s-]?site|in[\s-]office)\b",
    r"#li-onsite\b",
    r"\(\s*on[\s-]?site\s*\)",
    r"[-|–—]\s*on[\s-]?site\b",
    r"^\s*on[\s-]?site\s*($|[:(\-|,/])",
    r"\b(must|required\s+to|expected\s+to)\s+(be\s+)?(work|report|commute)\w*\s+(from\s+|in\s+|into\s+|to\s+)?(our|the)\s+(office|site)\b",
    r"\bno\s+remote\b",
    r"\bnot\s+(a\s+)?remote\b",
    r"\brelocat(e|ion)\s+(is\s+)?required\b",
]

_LABELS = {
    "remote": "remote",
    "hybrid": "hybrid",
    "on-site": "onsite",
    "onsite": "onsite",
    "on site": "onsite",
}


_NEGATION = re.compile(r"\b(no|not|non|never|without)[\s-]+(a\s+|an\s+|fully\s+)?$", re.IGNORECASE)


def _scan(patterns: list[str], text: str, skip_negated: bool = False) -> list[str]:
    hits: list[str] = []
    for line in text.splitlines():
        for pat in patterns:
            m = re.search(pat, line, re.IGNORECASE)
            # "No remote work" / "not a remote role" are on-site signals, not remote ones.
            if m and skip_negated and _NEGATION.search(line[: m.start()]):
                continue
            if m:
                s = line.strip()
                hits.append(s if len(s) <= 160 else s[max(0, m.start() - 60): m.end() + 60].strip())
                break
    return hits


def classify(text: str, label: str | None = None) -> dict:
    """Return {"workplace", "source", "evidence"} for a posting's text."""
    if label:
        norm = _LABELS.get(label.strip().lower())
        if norm:
            return {"workplace": norm, "source": "label", "evidence": [f"label: {label.strip()}"]}
    remote = _scan(_REMOTE, text, skip_negated=True)
    hybrid = _scan(_HYBRID, text)
    onsite = _scan(_ONSITE, text)
    if hybrid:
        verdict, ev = "hybrid", hybrid
    elif remote and onsite:
        verdict, ev = "mixed", remote + onsite
    elif onsite:
        verdict, ev = "onsite", onsite
    elif remote:
        verdict, ev = "remote", remote
    else:
        return {"workplace": "unknown", "source": "none", "evidence": []}
    return {"workplace": verdict, "source": "text", "evidence": ev[:4]}


def text_of(obj: dict) -> str:
    parts = [str(obj.get(k) or "") for k in ("title", "location", "workplace", "description")]
    return "\n".join(p for p in parts if p)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Workplace verdict for one posting.")
    ap.add_argument("--text", help="posting text; when absent, a detail/search JSON object is read from stdin")
    ap.add_argument("--label", help="workplace label read from the posting page (e.g. On-site); overrides the text")
    args = ap.parse_args(argv)
    if args.text is not None:
        text = args.text
    else:
        try:
            obj = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            print(json.dumps({"error": f"stdin is not a JSON object: {exc}"}), file=sys.stderr)
            return 2
        if not isinstance(obj, dict):
            print(json.dumps({"error": "stdin JSON must be an object"}), file=sys.stderr)
            return 2
        text = text_of(obj)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(classify(text, args.label), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
