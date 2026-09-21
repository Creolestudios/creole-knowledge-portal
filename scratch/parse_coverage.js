const fs = require('fs');
const execSync = require('child_process').execSync;

const lcov = fs.readFileSync('coverage/lcov.info', 'utf8');
const files = lcov.split('end_of_record\n');

const modifiedFilesStr = execSync('git diff --name-only HEAD').toString();
const modifiedFilesStaged = execSync('git diff --name-only --cached').toString();
const allModified = (modifiedFilesStr + '\n' + modifiedFilesStaged).split('\n').filter(Boolean).map(f => f.trim());

const results = [];

for (const fileChunk of files) {
  if (!fileChunk.trim()) continue;
  
  const match = fileChunk.match(/^SF:(.+)$/m);
  if (!match) continue;
  
  const filePath = match[1];
  
  // Is this a modified file?
  const isModified = allModified.some(mf => filePath.endsWith(mf) || mf.endsWith(filePath));
  
  if (!isModified) continue;
  
  const linesFoundMatch = fileChunk.match(/^LF:(\d+)$/m);
  const linesHitMatch = fileChunk.match(/^LH:(\d+)$/m);
  
  const linesFound = linesFoundMatch ? parseInt(linesFoundMatch[1]) : 0;
  const linesHit = linesHitMatch ? parseInt(linesHitMatch[1]) : 0;
  
  if (linesFound > 0) {
    const coverage = (linesHit / linesFound) * 100;
    if (coverage < 80) {
      results.push({ filePath, coverage, linesFound, linesHit });
    }
  }
}

console.log(JSON.stringify(results, null, 2));
