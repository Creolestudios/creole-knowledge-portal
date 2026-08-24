"""Fetch Sonar coverage/reliability measures. Requires SONAR_HOST_URL + SONAR_TOKEN."""

from __future__ import annotations

import base64
import json
import os
import urllib.request

HOST = os.environ["SONAR_HOST_URL"].rstrip("/")
TOKEN = os.environ["SONAR_TOKEN"]
PROJECT = os.environ.get("SONAR_PROJECT_KEY", "ai-studio-applet")
AUTH = f"Basic {base64.b64encode(f'{TOKEN}:'.encode()).decode()}"
METRICS = ",".join(
    [
        "new_coverage",
        "coverage",
        "new_software_quality_reliability_rating",
        "software_quality_reliability_rating",
        "reliability_rating",
        "new_reliability_rating",
        "new_software_quality_reliability_issues",
        "software_quality_reliability_issues",
        "new_reliability_remediation_effort",
        "new_bugs",
        "bugs",
    ]
)

url = f"{HOST}/api/measures/component?component={PROJECT}&metricKeys={METRICS}"
req = urllib.request.Request(url)
req.add_header("Authorization", AUTH)
with urllib.request.urlopen(req, timeout=30) as resp:
    print(json.dumps(json.loads(resp.read().decode()), indent=2))
