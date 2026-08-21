import os

lcov_file = "coverage/lcov.info"
if not os.path.exists(lcov_file):
    print("LCOV file not found")
    exit(1)

records = []
current_file = None
lines_found = 0
lines_hit = 0
uncovered = []

with open(lcov_file) as f:
    for line in f:
        line = line.strip()
        if line.startswith("SF:"):
            current_file = line[3:]
            lines_found = 0
            lines_hit = 0
            uncovered = []
        elif line.startswith("DA:"):
            parts = line[3:].split(",")
            line_num = int(parts[0])
            hits = int(parts[1])
            lines_found += 1
            if hits > 0:
                lines_hit += 1
            else:
                uncovered.append(line_num)
        elif line == "end_of_record":
            if current_file and lines_found > 0:
                coverage = (lines_hit / lines_found) * 100
                records.append({
                    "file": current_file,
                    "found": lines_found,
                    "hit": lines_hit,
                    "coverage": coverage,
                    "uncovered_count": len(uncovered),
                    "uncovered_lines": uncovered
                })

records.sort(key=lambda x: x["uncovered_count"], reverse=True)

print(f"{'Coverage':<10} {'Hit/Found':<12} {'Uncovered':<10} File")
print("-" * 80)
for r in records[:25]:
    rel_path = os.path.relpath(r['file'], "/var/www/html/creole-knowledge-portal")
    print(f"{r['coverage']:6.1f}%     {r['hit']}/{r['found']:<6}   {r['uncovered_count']:<10} {rel_path}")
