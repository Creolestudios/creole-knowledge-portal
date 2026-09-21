import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const session = JSON.parse(
  fs.readFileSync(
    '/tmp/claude-1000/-var-www-html-creole-knowledge-portal/c35f2fcb-2d77-4aea-a9b5-02a30640fbda/scratchpad/session.json',
    'utf-8',
  ),
);

const PROJECT_REF = 'pcovgcyjzprkboxbjkey';

function toBase64Url(str: string) {
  return Buffer.from(str, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mirrors @supabase/ssr's own chunker (MAX_CHUNK_SIZE=3180 on the
// encodeURIComponent'd value) so a session too large for one cookie is split
// into name.0, name.1, ... exactly as the real client would read it back.
const MAX_CHUNK_SIZE = 3180;
function chunkCookie(name: string, value: string) {
  const encoded = encodeURIComponent(value);
  if (encoded.length <= MAX_CHUNK_SIZE) return [{ name, value }];

  const chunks: string[] = [];
  let remaining = encoded;
  while (remaining.length > 0) {
    let head = remaining.slice(0, MAX_CHUNK_SIZE);
    const lastEscape = head.lastIndexOf('%');
    if (lastEscape > MAX_CHUNK_SIZE - 3) head = head.slice(0, lastEscape);
    let decoded = '';
    while (head.length > 0) {
      try {
        decoded = decodeURIComponent(head);
        break;
      } catch {
        head = head.slice(0, head.length - 3);
      }
    }
    chunks.push(decoded);
    remaining = remaining.slice(head.length);
  }
  return chunks.map((value, i) => ({ name: `${name}.${i}`, value }));
}

test('extractor flow: analyze then select questions then generate', async ({ page, context }) => {
  // @supabase/ssr stores the raw gotrue session JSON, base64url-encoded with a
  // "base64-" prefix, under sb-<project-ref>-auth-token (chunked if large).
  const sessionForStorage = {
    ...session,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  const cookieValue = 'base64-' + toBase64Url(JSON.stringify(sessionForStorage));
  const chunks = chunkCookie(`sb-${PROJECT_REF}-auth-token`, cookieValue);
  console.log('=== auth cookie chunks:', chunks.length);

  await context.addCookies(
    chunks.map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })),
  );

  const apiLog: { url: string; status: number; body: string }[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/')) {
      let body = '';
      try {
        body = (await res.text()).slice(0, 3000);
      } catch {
        body = '<unreadable>';
      }
      apiLog.push({ url: res.url(), status: res.status(), body });
    }
  });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  await page.goto('http://localhost:3000/dashboard/ai-interview/extractor');
  console.log('=== landed on ===', page.url());

  const pasteButtons = page.getByText('Paste Text');
  await pasteButtons.nth(0).click();
  await page.fill(
    'textarea[placeholder*="resume"]',
    'Jane Doe. 5 years React and Node.js experience. Built scalable APIs and led a team of 4 engineers.',
  );
  await pasteButtons.nth(1).click();
  await page.fill(
    'textarea[placeholder*="Job Description"]',
    'We need a Senior React Developer with Node.js and AWS experience to lead our platform team.',
  );

  await page.click('#resume-jd-uploader-extract');

  await page.waitForSelector('text=Select Interview Questions', { timeout: 20000 });
  console.log('=== Selection screen reached ===');

  await page.waitForSelector('#question-bank-selector-question-count', { timeout: 10000 });
  await page.fill('#question-bank-selector-question-count', '2');

  // Pick the 'hr' category chip and its first two questions.
  await page.click('#question-bank-category-hr');
  const checkboxes = page.locator('label input[type="checkbox"]');
  const count = await checkboxes.count();
  console.log('=== question checkboxes available after selecting hr category:', count);

  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  console.log('=== selection state text ===');
  console.log(await page.locator('body').innerText());

  const generateBtn = page.locator('#question-bank-selector-generate-link');
  console.log('=== generate button disabled? ===', await generateBtn.isDisabled());

  await generateBtn.click();

  await page.waitForSelector('text=Interview Link & Passcode', { timeout: 20000 }).catch(() => {
    console.log('!! Interview Link & Passcode heading never appeared');
  });

  console.log('=== FINAL PAGE TEXT ===');
  console.log(await page.locator('body').innerText());

  console.log('=== API LOG ===');
  for (const entry of apiLog) {
    console.log('---', entry.status, entry.url);
    console.log(entry.body);
  }

  await page.screenshot({
    path: '/tmp/claude-1000/-var-www-html-creole-knowledge-portal/c35f2fcb-2d77-4aea-a9b5-02a30640fbda/scratchpad/final-result.png',
    fullPage: true,
  });
});
