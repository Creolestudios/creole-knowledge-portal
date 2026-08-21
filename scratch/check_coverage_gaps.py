import os

lcov_path = "/var/www/html/creole-knowledge-portal/coverage/lcov.info"
if not os.path.exists(lcov_path):
    print("No lcov.info found")
    exit(0)

current_file = None
lines_found = 0
lines_hit = 0

low_cov = []

with open(lcov_path, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith("SF:"):
            current_file = line[3:]
            lines_found = 0
            lines_hit = 0
        elif line.startswith("LF:"):
            lines_found = int(line[3:])
        elif line.startswith("LH:"):
            lines_hit = int(line[3:])
        elif line == "end_of_record":
            if lines_found > 0:
                pct = (lines_hit / lines_found) * 100
                rel = os.path.relpath(current_file, "/var/www/html/creole-knowledge-portal")
                if not any(x in rel for x in ["scratch", "test", "node_modules"]):
                    low_cov.append((pct, lines_hit, lines_found, rel))

low_cov.sort(key=lambda x: x[0])
print("=== FILES WITH LOW COVERAGE (< 80%) ===")
for pct, hit, total, path in low_cov:
    if pct < 80:
        print(f"{pct:5.1f}% ({hit}/{total}) -> {path}")
