"""List new-code coverage by file. Requires SONAR_HOST_URL + SONAR_TOKEN."""

from __future__ import annotations

import json
import os

import requests

HOST = os.environ["SONAR_HOST_URL"].rstrip("/")
TOKEN = os.environ["SONAR_TOKEN"]
PROJECT = os.environ.get("SONAR_PROJECT_KEY", "ai-studio-applet")

res = requests.get(
    f"{HOST}/api/measures/component_tree",
    params={
        "component": PROJECT,
        "metricKeys": "new_coverage,uncovered_lines,uncovered_conditions",
        "strategy": "leaves",
        "ps": 500,
        "s": "metric",
        "metricSort": "new_coverage",
        "asc": "true",
    },
    auth=(TOKEN, ""),
    timeout=30,
)
res.raise_for_status()
print(json.dumps(res.json(), indent=2))
