import urllib.request
import json
import base64

credentials = "priya.dhanani@creolestudios.com:Creole@123456"
auth_header = f"Basic {base64.b64encode(credentials.encode()).decode()}"

url_new = "http://34.100.239.232:9000/api/issues/search?componentKeys=ai-studio-applet&inNewCodePeriod=true&resolved=false&ps=500"
req_new = urllib.request.Request(url_new)
req_new.add_header("Authorization", auth_header)
with urllib.request.urlopen(req_new) as resp:
    new_data = json.loads(resp.read().decode())

issues = new_data.get("issues", [])
print(f"Total New Code Issues: {len(issues)}")

for idx, i in enumerate(issues[:25], 1):
    comp = i.get('component', '').replace('ai-studio-applet:', '')
    print(f"{idx}. [{i.get('type')}] [{i.get('severity')}] {comp}:{i.get('line')} -> {i.get('message')} (Rule: {i.get('rule')})")
