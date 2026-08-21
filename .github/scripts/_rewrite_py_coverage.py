"""Rewrite fetch-blogs/coverage.xml filenames so Sonar can match Python sources.

coverage.py emits paths relative to fetch-blogs/ (``src/foo.py``). Sonar scans
from the repo root and only credits hits whose filenames are
``fetch-blogs/src/foo.py``. Without this rewrite every Python file looks 0%.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COVERAGE_XML = REPO_ROOT / "fetch-blogs" / "coverage.xml"
SRC_PREFIX = "fetch-blogs/src/"


def _normalize_filename(raw: str) -> str:
    path = raw.replace("\\", "/").strip().lstrip("./")
    if not path:
        return path

    lower = path.lower()
    marker = "fetch-blogs/"
    if marker in lower:
        path = path[lower.rfind(marker) :]
        rest = path[len("fetch-blogs/") :]
        if rest.startswith("src/"):
            return path
        return f"fetch-blogs/src/{rest}"

    if path.startswith("src/"):
        return f"fetch-blogs/{path}"

    # coverage.py source=["src"] emits paths relative to that package root.
    return f"fetch-blogs/src/{path}"


def _hits_in(class_el: ET.Element) -> int:
    total = 0
    for line in class_el.findall(".//line"):
        try:
            total += int(line.get("hits") or "0")
        except ValueError:
            continue
    return total


def main() -> int:
    if not COVERAGE_XML.is_file():
        print(f"ERROR: missing {COVERAGE_XML}", file=sys.stderr)
        return 1

    tree = ET.parse(COVERAGE_XML)
    root = tree.getroot()

    sources = root.find("sources")
    if sources is None:
        sources = ET.SubElement(root, "sources")
    for child in list(sources):
        sources.remove(child)
    source = ET.SubElement(sources, "source")
    source.text = str(REPO_ROOT).replace("\\", "/")

    mapped: list[str] = []
    hit_files = 0
    for class_el in root.findall(".//class"):
        original = class_el.get("filename") or ""
        rewritten = _normalize_filename(original)
        class_el.set("filename", rewritten)
        if rewritten.startswith(SRC_PREFIX):
            mapped.append(rewritten)
            if _hits_in(class_el) > 0:
                hit_files += 1

    tree.write(COVERAGE_XML, encoding="utf-8", xml_declaration=True)

    if len(mapped) < 10:
        print(
            f"ERROR: expected fetch-blogs/src coverage entries, found {len(mapped)}",
            file=sys.stderr,
        )
        return 1
    if hit_files < 10:
        print(
            f"ERROR: coverage.xml has no executable hits for Python sources ({hit_files} files)",
            file=sys.stderr,
        )
        return 1

    print(f"Rewrote {len(mapped)} Python coverage paths ({hit_files} with hits) for Sonar")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
