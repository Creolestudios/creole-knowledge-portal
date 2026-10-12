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

test('admin dashboard AI Interview tab: analyze -> select questions -> link+passcode+questions', async ({
  page,
  context,
}) => {
  const sessionForStorage = { ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const cookieValue = 'base64-' + toBase64Url(JSON.stringify(sessionForStorage));
  const chunks = chunkCookie(`sb-${PROJECT_REF}-auth-token`, cookieValue);
  await context.addCookies(chunks.map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })));

  const apiLog: { url: string; status: number }[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/')) apiLog.push({ url: res.url(), status: res.status() });
  });

  await page.goto('http://localhost:3000/admin/dashboard');
  console.log('=== landed on ===', page.url());

  // Find the AI Interview tab/section on the admin dashboard.
  const aiTab = page.getByText('AI Interview', { exact: false }).first();
  if (await aiTab.isVisible().catch(() => false)) {
    await aiTab.click();
  }

  await page.waitForSelector('text=AI Interview — Create Session', { timeout: 15000 });

  await page.click('#jd-mode-text');
  const resumeInput = page.locator('#resume-upload');
  await resumeInput.setInputFiles({
    name: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Jane Doe. 5 years React and Node.js experience. Built scalable APIs.'),
  });
  await page.fill('#jd-text', 'We need a Senior React Developer with Node.js and AWS experience.');

  await page.click('#create-interview-submit');

  await page.waitForSelector('text=Select Interview Questions', { timeout: 20000 });
  console.log('=== Reached Select Interview Questions on admin dashboard ===');

  await page.fill('#question-bank-selector-question-count', '2');
  await page.click('#question-bank-category-hr');
  const checkboxes = page.locator('label input[type="checkbox"]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  const generateBtn = page.locator('#question-bank-selector-generate-link');
  console.log('=== generate disabled? ===', await generateBtn.isDisabled());
  await generateBtn.click();

  await page.waitForSelector('text=Interview Link & Passcode', { timeout: 20000 }).catch(() => {
    console.log('!! Interview Link & Passcode never appeared');
  });

  console.log('=== FINAL PAGE TEXT ===');
  console.log(await page.locator('body').innerText());

  console.log('=== API LOG ===');
  for (const e of apiLog) console.log(e.status, e.url);

  await page.screenshot({
    path: '/tmp/claude-1000/-var-www-html-creole-knowledge-portal/c35f2fcb-2d77-4aea-a9b5-02a30640fbda/scratchpad/admin-final.png',
    fullPage: true,
  });
});
