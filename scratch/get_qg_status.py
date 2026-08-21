import requests, json

url = "http://34.100.239.232:9000/api/qualitygates/project_status?projectKey=ai-studio-applet"
auth = ("squ_76811d68e795b642385b1de37dc97fb41a13c252", "")

res = requests.get(url, auth=auth)
data = res.json()

print("=== QUALITY GATE PROJECT STATUS ===")
print(json.dumps(data, indent=2))
