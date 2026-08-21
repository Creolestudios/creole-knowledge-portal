import urllib.request
import json
import base64

credentials = "priya.dhanani@creolestudios.com:Creole@123456"
auth_header = f"Basic {base64.b64encode(credentials.encode()).decode()}"

# Fetch project status and quality gate details
url_qg = "http://34.100.239.232:9000/api/qualitygates/project_status?projectKey=ai-studio-applet"
req_qg = urllib.request.Request(url_qg)
req_qg.add_header("Authorization", auth_header)
with urllib.request.urlopen(req_qg) as resp:
    qg_data = json.loads(resp.read().decode())

print("=== QUALITY GATE STATUS ===")
print(json.dumps(qg_data, indent=2))

# Fetch issues in new code period
url_new = "http://34.100.239.232:9000/api/issues/search?componentKeys=ai-studio-applet&inNewCodePeriod=true&resolved=false&ps=500"
req_new = urllib.request.Request(url_new)
req_new.add_header("Authorization", auth_header)
with urllib.request.urlopen(req_new) as resp:
    new_data = json.loads(resp.read().decode())

print(f"\n=== NEW CODE ISSUES (Total: {new_data.get('total', 0)}) ===")
for idx, i in enumerate(new_data.get("issues", []), 1):
    comp = i.get('component', '').replace('ai-studio-applet:', '')
    print(f"{idx}. [{i.get('type')}] [{i.get('severity')}] {comp}:{i.get('line')} -> {i.get('message')} (Rule: {i.get('rule')})")

