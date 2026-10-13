import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('settings window includes the complete third-party tool safety notice', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(html, /unofficial player-made tool/i);
  assert.match(html, /third-party tools are used at your own risk/i);
  assert.match(html, /never automates gameplay/i);
  assert.match(html, /CCP.*Third Party Policies/i);
});
