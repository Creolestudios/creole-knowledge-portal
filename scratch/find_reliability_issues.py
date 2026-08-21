import urllib.request
import json
import base64

credentials = "priya.dhanani@creolestudios.com:Creole@123456"
auth_header = f"Basic {base64.b64encode(credentials.encode()).decode()}"

url = "http://34.100.239.232:9000/api/issues/search?componentKeys=ai-studio-applet&resolved=false&ps=500"
req = urllib.request.Request(url)
req.add_header("Authorization", auth_header)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())

issues = data.get("issues", [])

print("Searching for issues with RELIABILITY impact...")
for idx, i in enumerate(issues, 1):
    impacts = i.get("impacts", [])
    rel_impact = [imp for imp in impacts if imp.get("softwareQuality") == "RELIABILITY"]
    if rel_impact:
        comp = i.get('component', '').replace('ai-studio-applet:', '')
        print(f"[{i.get('key')}] {comp}:{i.get('line')} -> {i.get('message')}")
        print(f"   Rule: {i.get('rule')}, Severity: {i.get('severity')}, Type: {i.get('type')}")
        print(f"   Impacts: {impacts}")
        print("-" * 80)
