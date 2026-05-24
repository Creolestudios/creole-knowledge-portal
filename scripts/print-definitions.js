const fs = require('fs');

const content = fs.readFileSync('.env.local', 'utf8');
const env = {};
content.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    env[key] = val;
  }
});

const url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/';
const apikey = env.SUPABASE_SERVICE_ROLE_KEY;

fetch(url, {
  headers: {
    'apikey': apikey,
    'Authorization': 'Bearer ' + apikey
  }
})
.then(res => res.json())
.then(schema => {
  console.log('--- daily_30_curation definition properties ---');
  console.log(schema.definitions.daily_30_curation?.properties);
  console.log('--- blogs definition properties ---');
  console.log(schema.definitions.blogs?.properties);
})
.catch(err => {
  console.error('Fetch error:', err);
});
