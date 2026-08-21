import urllib.request
import json
import base64

credentials = "priya.dhanani@creolestudios.com:Creole@123456"
auth_header = f"Basic {base64.b64encode(credentials.encode()).decode()}"

url = "http://34.100.239.232:9000/api/measures/component?component=ai-studio-applet&metricKeys=new_coverage,coverage,new_software_quality_reliability_rating,software_quality_reliability_rating,reliability_rating,new_reliability_rating,new_software_quality_reliability_issues,software_quality_reliability_issues,new_reliability_remediation_effort,new_bugs,bugs"
req = urllib.request.Request(url)
req.add_header("Authorization", auth_header)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())

print(json.dumps(data, indent=2))
