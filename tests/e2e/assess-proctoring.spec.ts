import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Real-browser proctoring checks for the candidate /assess/[token] flow.
 *
 * The assess API is stubbed so the run doesn't depend on a live invite row, but
 * the proctoring logic and the media streams are real: camera/mic come from
 * Chromium's fake capture device, so the tracks are real MediaStreamTrack
 * objects, and the focus loss in "stays live when real browser focus moves to
 * another tab" is genuine browser focus, not a stub.
 *
 * Two things can't be produced under automation and are driven directly, with
 * the exact signals Chrome emits: the visibility flip for a tab switch/minimize
 * (Playwright pins every page visible) and a track's 'ended' event.
 */

test.use({
  permissions: ['camera', 'microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  },
});

const QUESTIONS = [
  {
    id: 'q1',
    question_text: 'Tell us about a project you are proud of.',
    question_type: 'hr',
    category: 'project_experience',
    difficulty: 'medium',
    question_order: 1,
    time_limit_sec: 120,
    is_mandatory_hr: false,
  },
  {
    id: 'q2',
    question_text: 'Describe a time you worked with different working styles.',
    question_type: 'behavioral',
    category: 'teamwork',
    difficulty: 'medium',
    question_order: 2,
    time_limit_sec: 120,
    is_mandatory_hr: false,
  },
];

async function stubAssessApi(page: Page) {
  const terminateCalls: string[] = [];

  await page.route('**/api/assess/*/verify', (route) =>
    route.fulfill({
      status: 200,
      json: {
        verified: true,
        session_id: 's1',
        candidate_name: 'Test Candidate',
        questions: QUESTIONS,
      },
    }),
  );
  await page.route('**/api/assess/*/answer', (route) =>
    route.fulfill({ status: 200, json: { saved: true, answer_id: 'a1' } }),
  );
  await page.route('**/api/assess/*/complete', (route) =>
    route.fulfill({ status: 200, json: { completed: true } }),
  );
  await page.route('**/api/assess/*/terminate', (route) => {
    terminateCalls.push(route.request().postData() ?? '');
    return route.fulfill({ status: 200, json: { terminated: true, session_id: 's1' } });
  });

  return terminateCalls;
}

/**
 * getDisplayMedia can't be driven headlessly, so it's backed by a real
 * getUserMedia capture with displaySurface reported as a full monitor. Both
 * streams are stashed on `window` so tests can fire genuine track events.
 */
async function installRealMediaStreams(page: Page) {
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const realGetUserMedia = devices.getUserMedia.bind(devices);

    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await realGetUserMedia(constraints);
      (window as unknown as Record<string, unknown>).__cameraStream = stream;
      return stream;
    };

    devices.getDisplayMedia = async () => {
      const stream = await realGetUserMedia({ video: true });
      stream.getVideoTracks().forEach((track) => {
        const realGetSettings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...realGetSettings(), displaySurface: 'monitor' });
      });
      (window as unknown as Record<string, unknown>).__screenStream = stream;
      return stream;
    };
  });
}

async function joinInterview(page: Page) {
  await page.goto('/assess/e2e-proctoring-token');

  await page.fill('#assess-passcode-input', '654321');
  await page.click('#assess-verify-submit');

  await expect(page.getByRole('heading', { name: 'Before you begin' })).toBeVisible();
  await page.click('#assess-request-permissions');

  await page.click('#assess-join-interview');
  await expect(page.locator('#assess-answer-textarea')).toBeVisible({ timeout: 15_000 });
}

async function setUp(page: Page) {
  const terminateCalls = await stubAssessApi(page);
  await installRealMediaStreams(page);
  await joinInterview(page);
  return terminateCalls;
}

test('stays live while visible — no spontaneous termination after joining', async ({ page }) => {
  await setUp(page);

  // The reported bug killed the session ~3.7s after joining.
  await page.waitForTimeout(12_000);

  await expect(page.locator('#assess-answer-textarea')).toBeVisible();
  await expect(page.getByText('Interview terminated')).toBeHidden();
});

test('stays live when real browser focus moves to another tab', async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  const terminateCalls = await setUp(page);

  // Playwright normally pins every page as focused. Turning that off lets the
  // browser report focus for real, reproducing what a full-screen share does in
  // production: Chrome's "you are sharing your screen" indicator holds keyboard
  // focus while the interview page is still visible in front of the candidate.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });

  const otherTab = await context.newPage();
  await otherTab.goto('about:blank');
  await otherTab.bringToFront();

  // Genuine browser state — nothing about focus or visibility is stubbed here.
  let unfocused = false;
  for (let attempt = 0; attempt < 10 && !unfocused; attempt += 1) {
    unfocused = !(await page.evaluate(() => document.hasFocus()));
    if (!unfocused) await page.waitForTimeout(500);
  }
  test.skip(
    !unfocused,
    'Headless Chromium has no window manager, so a real focus loss cannot be produced — run this spec with --headed.',
  );

  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

  await page.waitForTimeout(8_000);

  await expect(page.locator('#assess-answer-textarea')).toBeVisible();
  await expect(page.getByText('Interview terminated')).toBeHidden();
  expect(terminateCalls).toHaveLength(0);

  await otherTab.close();
});

test('terminates when the page is hidden (tab switch / minimize)', async ({ page }) => {
  const terminateCalls = await setUp(page);

  // Playwright keeps every page visible and no window manager is available to
  // minimize for real, so the visibility transition is driven directly. This is
  // byte-for-byte what Chrome emits for both a tab switch and a minimize:
  // visibilityState 'hidden' plus a visibilitychange event.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.getByText('Interview terminated')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText('You switched tabs or minimized the window during the interview.'),
  ).toBeVisible();
  expect(terminateCalls.length).toBeGreaterThan(0);
});

test('terminates when the candidate stops the screen share', async ({ page }) => {
  await setUp(page);

  await page.evaluate(() => {
    const stream = (window as unknown as { __screenStream: MediaStream }).__screenStream;
    stream.getTracks().forEach((track) => track.dispatchEvent(new Event('ended')));
  });

  await expect(page.getByText('Screen sharing was stopped during the interview.')).toBeVisible({
    timeout: 10_000,
  });
});

test('terminates when the camera or mic is switched off', async ({ page }) => {
  await setUp(page);

  await page.evaluate(() => {
    const stream = (window as unknown as { __cameraStream: MediaStream }).__cameraStream;
    stream.getTracks().forEach((track) => track.dispatchEvent(new Event('ended')));
  });

  await expect(
    page.getByText('Your webcam or microphone was turned off during the interview.'),
  ).toBeVisible({ timeout: 10_000 });
});
