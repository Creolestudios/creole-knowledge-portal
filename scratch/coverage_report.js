const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '../coverage/coverage-final.json');
if (!fs.existsSync(file)) {
  console.error('coverage-final.json not found:', file);
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const results = [];
for (const [filePath, info] of Object.entries(data)) {
  const total = Object.keys(info.statementMap || {}).length;
  const s = info.s || {};
  let executed = 0;
  for (const k of Object.keys(info.statementMap || {})) {
    if ((s[k] || 0) > 0) executed++;
  }
  const pct = total === 0 ? 100 : (executed / total) * 100;
  results.push({ file: filePath, total, executed, pct });
}
results.sort((a,b)=>a.pct - b.pct);
console.log('Files with coverage < 80% (statement coverage):');
results.filter(r=>r.pct<80).slice(0,200).forEach(r=>{
  console.log(`${r.pct.toFixed(1)}% - ${r.executed}/${r.total} - ${r.file}`);
});
console.log('\nSummary:');
const avg = results.reduce((a,b)=>a+b.pct,0)/results.length;
console.log('Average statement coverage:', avg.toFixed(1)+'%');
process.exit(0);
