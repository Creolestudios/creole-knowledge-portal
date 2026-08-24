"""List all unresolved Sonar issues. Requires SONAR_HOST_URL + SONAR_TOKEN."""

from __future__ import annotations

import base64
import json
import os
import urllib.request

HOST = os.environ["SONAR_HOST_URL"].rstrip("/")
TOKEN = os.environ["SONAR_TOKEN"]
PROJECT = os.environ.get("SONAR_PROJECT_KEY", "ai-studio-applet")
AUTH = f"Basic {base64.b64encode(f'{TOKEN}:'.encode()).decode()}"

url = f"{HOST}/api/issues/search?componentKeys={PROJECT}&resolved=false&ps=500"
req = urllib.request.Request(url)
req.add_header("Authorization", AUTH)
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode())

issues = data.get("issues", [])
print(f"Total Issues: {len(issues)}")
for idx, issue in enumerate(issues[:50], 1):
    comp = issue.get("component", "").replace(f"{PROJECT}:", "")
    print(
        f"{idx}. [{issue.get('type')}] [{issue.get('severity')}] "
        f"{comp}:{issue.get('line')} -> {issue.get('message')} (Rule: {issue.get('rule')})"
    )
