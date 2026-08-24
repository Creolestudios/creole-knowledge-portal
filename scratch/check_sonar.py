"""Query SonarQube quality gate + new-code issues (local helper).

Requires env:
  SONAR_HOST_URL  e.g. https://sonar.example.com
  SONAR_TOKEN     Sonar user token
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request

HOST = os.environ["SONAR_HOST_URL"].rstrip("/")
TOKEN = os.environ["SONAR_TOKEN"]
PROJECT = os.environ.get("SONAR_PROJECT_KEY", "ai-studio-applet")
AUTH = f"Basic {base64.b64encode(f'{TOKEN}:'.encode()).decode()}"


def _get(path: str) -> dict:
    req = urllib.request.Request(f"{HOST}{path}")
    req.add_header("Authorization", AUTH)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


qg = _get(f"/api/qualitygates/project_status?projectKey={PROJECT}")
print("=== QUALITY GATE STATUS ===")
print(json.dumps(qg, indent=2))

new = _get(
    f"/api/issues/search?componentKeys={PROJECT}&inNewCodePeriod=true&resolved=false&ps=500"
)
print(f"\n=== NEW CODE ISSUES (Total: {new.get('total', 0)}) ===")
for idx, issue in enumerate(new.get("issues", []), 1):
    comp = issue.get("component", "").replace(f"{PROJECT}:", "")
    print(
        f"{idx}. [{issue.get('type')}] [{issue.get('severity')}] "
        f"{comp}:{issue.get('line')} -> {issue.get('message')} (Rule: {issue.get('rule')})"
    )
