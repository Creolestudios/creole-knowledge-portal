"""Print SonarQube quality gate status. Requires SONAR_HOST_URL + SONAR_TOKEN."""

from __future__ import annotations

import json
import os

import requests

HOST = os.environ["SONAR_HOST_URL"].rstrip("/")
TOKEN = os.environ["SONAR_TOKEN"]
PROJECT = os.environ.get("SONAR_PROJECT_KEY", "ai-studio-applet")

res = requests.get(
    f"{HOST}/api/qualitygates/project_status",
    params={"projectKey": PROJECT},
    auth=(TOKEN, ""),
    timeout=30,
)
res.raise_for_status()
print("=== QUALITY GATE PROJECT STATUS ===")
print(json.dumps(res.json(), indent=2))
