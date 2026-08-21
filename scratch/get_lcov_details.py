import os

lcov_path = "/var/www/html/creole-knowledge-portal/coverage/lcov.info"
if not os.path.exists(lcov_path):
    print("No lcov.info found")
    exit(0)

records = []
current = None

with open(lcov_path, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith("SF:"):
            rel = os.path.relpath(line[3:], "/var/www/html/creole-knowledge-portal")
            current = {"path": rel, "lines": {}, "lf": 0, "lh": 0}
        elif line.startswith("DA:"):
            parts = line[3:].split(",")
            lno = int(parts[0])
            hits = int(parts[1])
            if current:
                current["lines"][lno] = hits
        elif line.startswith("LF:"):
            if current: current["lf"] = int(line[3:])
        elif line.startswith("LH:"):
            if current: current["lh"] = int(line[3:])
        elif line == "end_of_record":
            if current and current["lf"] > 0:
                pct = (current["lh"] / current["lf"]) * 100
                uncovered = [lno for lno, hits in current["lines"].items() if hits == 0]
                records.append((pct, current["lh"], current["lf"], current["path"], uncovered))
            current = None

records.sort(key=lambda x: x[0])

print("=== LOCAL LCOV COVERAGE BREAKDOWN ===")
for pct, lh, lf, path, uncovered in records:
    if pct < 90 and not any(x in path for x in ["scratch", "test", "node_modules"]):
        print(f"{pct:5.1f}% ({lh}/{lf}) -> {path}")
        print(f"       Uncovered lines: {uncovered[:20]}{'...' if len(uncovered) > 20 else ''}")
