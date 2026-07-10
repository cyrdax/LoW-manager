import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('fit item tooltips render instantly instead of using native title delay', () => {
  const view = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const css = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(view, /data-tooltip=\{item\.resolvedName \?\? item\.inputName\}/);
  assert.doesNotMatch(view, /title=\{item\.resolvedName \?\? item\.inputName\}/);
  assert.match(css, /\.fits-tooltip:hover::after/);
  assert.match(css, /\.fits-tooltip:focus-visible::after/);
});
