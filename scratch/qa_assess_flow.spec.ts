import { test, expect } from '@playwright/test';

// Real-browser QA of the candidate /assess/[token] flow with mocked API
// responses (DB schema not yet applied to the real Supabase project —
// see the note in the chat). Grants fake camera/mic/screen permissions.

test.use({
  permissions: ['camera', 'microphone'],
});

test('candidate flow: wrong passcode is rejected', async ({ page }) => {
  await page.route('**/api/assess/*/verify', async (route) => {
    await route.fulfill({ status: 401, json: { error: 'Incorrect passcode' } });
  });

  await page.goto('/assess/faketoken123');
  await expect(page.locator('#assess-passcode-input')).toBeVisible();
  await page.fill('#assess-passcode-input', '000000');
  await page.click('#assess-verify-submit');

  await expect(page.getByText('Incorrect passcode')).toBeVisible();
});

test('candidate flow: full happy path through to completion', async ({ page, context }) => {
  await page.route('**/api/assess/*/verify', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        verified: true,
        session_id: 's1',
        candidate_name: 'Test Candidate',
        questions: [
          { id: 'q1', question_text: 'Tell me about yourself', question_type: 'hr', category: 'hr', difficulty: 'easy', question_order: 1, time_limit_sec: 120, is_mandatory_hr: true },
          { id: 'q2', question_text: 'Explain your experience with React', question_type: 'technical', category: 'technical', difficulty: 'medium', question_order: 2, time_limit_sec: 180, is_mandatory_hr: false },
        ],
      },
    });
  });
  await page.route('**/api/assess/*/answer', async (route) => {
    await route.fulfill({ status: 200, json: { saved: true, answer_id: 'a1' } });
  });
  await page.route('**/api/assess/*/complete', async (route) => {
    await route.fulfill({ status: 200, json: { completed: true } });
  });

  // Mock getUserMedia/getDisplayMedia before navigation so the real
  // permission-gating logic (including the "entire screen" check) runs.
  await page.addInitScript(() => {
    const fakeTrack = () => ({
      stop: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
    });
    // @ts-expect-error test shim
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [fakeTrack()],
      getVideoTracks: () => [fakeTrack()],
    });
    // @ts-expect-error test shim
    navigator.mediaDevices.getDisplayMedia = async () => ({
      getTracks: () => [fakeTrack()],
      getVideoTracks: () => [fakeTrack()],
    });
  });

  await page.goto('/assess/faketoken123');

  // Stage 1: passcode
  await page.fill('#assess-passcode-input', '654321');
  await expect(page.locator('#assess-verify-submit')).toBeEnabled();
  await page.click('#assess-verify-submit');

  // Stage 2: instructions/permissions
  await expect(page.getByRole('heading', { name: 'Before you begin' })).toBeVisible();
  await page.click('#assess-request-permissions');

  // Stage 3: interview — question 1
  await expect(page.getByText('Question 1 of 2')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Tell me about yourself')).toBeVisible();
  await page.fill('#assess-answer-textarea', 'I am a software engineer with 5 years of experience.');
  await page.click('#assess-submit-answer');

  // Question 2
  await expect(page.getByText('Question 2 of 2')).toBeVisible();
  await expect(page.getByText('Explain your experience with React')).toBeVisible();
  await page.fill('#assess-answer-textarea', 'I have built several production React apps.');
  await page.click('#assess-submit-answer');

  // Completion
  await expect(page.getByText('Interview complete')).toBeVisible();
  await expect(page.getByText(/Test Candidate/)).toBeVisible();
});

test('candidate flow: tab switch during interview terminates the session', async ({ page }) => {
  await page.route('**/api/assess/*/verify', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        verified: true,
        session_id: 's1',
        candidate_name: 'Test Candidate',
        questions: [{ id: 'q1', question_text: 'Tell me about yourself', question_type: 'hr', category: 'hr', difficulty: 'easy', question_order: 1, time_limit_sec: 120, is_mandatory_hr: true }],
      },
    });
  });
  let terminateCalled = false;
  await page.route('**/api/assess/*/terminate', async (route) => {
    terminateCalled = true;
    await route.fulfill({ status: 200, json: { terminated: true } });
  });

  await page.addInitScript(() => {
    const fakeTrack = () => ({
      stop: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
    });
    // @ts-expect-error test shim
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [fakeTrack()], getVideoTracks: () => [fakeTrack()] });
    // @ts-expect-error test shim
    navigator.mediaDevices.getDisplayMedia = async () => ({ getTracks: () => [fakeTrack()], getVideoTracks: () => [fakeTrack()] });
  });

  await page.goto('/assess/faketoken123');
  await page.fill('#assess-passcode-input', '654321');
  await page.click('#assess-verify-submit');
  await page.click('#assess-request-permissions');
  await expect(page.getByText('Question 1 of 1')).toBeVisible({ timeout: 10_000 });

  // Simulate a tab switch via visibilitychange (Playwright can't truly
  // switch OS focus, but the page listens to document.visibilityState).
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.getByText('Interview terminated')).toBeVisible({ timeout: 5_000 });
  expect(terminateCalled).toBe(true);
});

test('candidate flow: partial screen share is rejected, asks for entire screen', async ({ page }) => {
  await page.route('**/api/assess/*/verify', async (route) => {
    await route.fulfill({
      status: 200,
      json: { verified: true, session_id: 's1', candidate_name: 'Test', questions: [] },
    });
  });

  await page.addInitScript(() => {
    const fakeCamTrack = () => ({ stop: () => {}, addEventListener: () => {}, removeEventListener: () => {}, readyState: 'live' });
    const fakeScreenTrack = () => ({ stop: () => {}, addEventListener: () => {}, removeEventListener: () => {}, readyState: 'live', getSettings: () => ({ displaySurface: 'window' }) });
    // @ts-expect-error test shim
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [fakeCamTrack()], getVideoTracks: () => [fakeCamTrack()] });
    // @ts-expect-error test shim
    navigator.mediaDevices.getDisplayMedia = async () => ({ getTracks: () => [fakeScreenTrack()], getVideoTracks: () => [fakeScreenTrack()] });
  });

  await page.goto('/assess/faketoken123');
  await page.fill('#assess-passcode-input', '654321');
  await page.click('#assess-verify-submit');
  await expect(page.getByRole('heading', { name: 'Before you begin' })).toBeVisible();
  await page.click('#assess-request-permissions');

  await expect(page.getByText('Please share your entire screen, not a window or tab, to continue.')).toBeVisible();
});
