import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('industry view renders clickable buildable materials with blueprint back navigation', () => {
  const view = readFileSync(resolve('web/src/components/IndustryView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(view, /openMaterialBlueprint/);
  assert.match(view, /blueprintHistory/);
  assert.match(view, /industry-back-button/);
  assert.match(view, /buildBlueprint/);
  assert.match(styles, /\.ind-row\.buildable/);
});
