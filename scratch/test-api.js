const http = require('http');

const req = http.request('http://localhost:3000/api/interview/some-fake-id/questions', {
  headers: {
    'Cookie': 'interview_verified_id=some-fake-id'
  }
}, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Body:', JSON.stringify(data));
  });
});
req.end();
