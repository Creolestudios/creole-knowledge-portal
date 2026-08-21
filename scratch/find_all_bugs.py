import urllib.request
import json
import base64

credentials = "priya.dhanani@creolestudios.com:Creole@123456"
auth_header = f"Basic {base64.b64encode(credentials.encode()).decode()}"

url_all = "http://34.100.239.232:9000/api/issues/search?componentKeys=ai-studio-applet&resolved=false&ps=500"
req_all = urllib.request.Request(url_all)
req_all.add_header("Authorization", auth_header)
with urllib.request.urlopen(req_all) as resp:
    data = json.loads(resp.read().decode())

issues = data.get("issues", [])

print("=== BUGS IN ENTIRE REPO ===")
bugs = [i for i in issues if i.get("type") == "BUG"]
print(f"Total Bugs: {len(bugs)}")
for idx, i in enumerate(bugs, 1):
    comp = i.get('component', '').replace('ai-studio-applet:', '')
    print(f"{idx}. [{i.get('severity')}] {comp}:{i.get('line')} -> {i.get('message')} (Rule: {i.get('rule')})")

print("\n=== ISSUES WITH RELIABILITY IMPACT IN NEW CODE ===")
rel_new = [i for i in issues if i.get("inNewCodePeriod") and any(imp.get("softwareQuality") == "RELIABILITY" for imp.get in i.get("impacts", []))]
print(f"Total Reliability Impact Issues in New Code: {len(rel_new)}")
for idx, i in enumerate(rel_new, 1):
    comp = i.get('component', '').replace('ai-studio-applet:', '')
    print(f"{idx}. [{i.get('type')}] [{i.get('severity')}] {comp}:{i.get('line')} -> {i.get('message')} (Rule: {i.get('rule')})")
