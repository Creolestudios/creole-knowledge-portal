import requests, json

url = "http://34.100.239.232:9000/api/measures/component_tree"
params = {
    "component": "ai-studio-applet",
    "metricKeys": "coverage,new_coverage",
    "ps": 100
}
auth = ("squ_76811d68e795b642385b1de37dc97fb41a13c252", "")

res = requests.get(url, params=params, auth=auth)
data = res.json()
print("Keys in data:", data.keys())
print("Paging:", data.get("paging"))
components = data.get("components", [])
print(f"Num components: {len(components)}")
for c in components[:10]:
    print(c.get("key"), c.get("qualifier"), c.get("measures"))
