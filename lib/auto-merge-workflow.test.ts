import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflowPath = join(process.cwd(), '.github/workflows/auto-merge.yml');
const workflow = readFileSync(workflowPath, 'utf8');

describe('auto-merge workflow Slack notification', () => {
  it('guards Slack notification when webhook secret is missing', () => {
    expect(workflow).toContain('SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}');
    expect(workflow).toContain('- name: Notify Slack');
    expect(workflow).toContain("if: env.SLACK_WEBHOOK_URL != ''");
  });

  it('builds a valid JSON payload for Slack', () => {
    expect(workflow).toContain('PAYLOAD=$(jq -n --arg text "$MESSAGE"');
    expect(workflow).toContain("'{text: $text}'");
    expect(workflow).toContain('--data "$PAYLOAD"');
  });

  it('fails loudly when Slack rejects the request', () => {
    expect(workflow).toContain('curl --fail-with-body');
    expect(workflow).toContain('"$SLACK_WEBHOOK_URL"');
  });
});
