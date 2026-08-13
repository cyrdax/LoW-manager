import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('contracts view can search any jump-capable ship within one cap jump', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const view = readFileSync(resolve('web/src/components/ContractsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(api, /export async function searchJumpCapableContracts/);
  assert.match(api, /\/api\/contracts\/search\/jump-capable\?\$\{qs\.toString\(\)\}/);
  assert.match(api, /originSystemId: String\(params\.originSystemId\)/);

  assert.match(view, /type ContractSearchMode = 'ship' \| 'jumpCapable'/);
  assert.match(view, /const \[searchMode, setSearchMode\] = useState<ContractSearchMode>/);
  assert.match(view, /searchMode === 'jumpCapable'/);
  assert.match(view, /searchJumpCapableContracts\(\s*\{ originSystemId: origin\.id \}/);
  assert.match(view, /Any cap jump/);
  assert.match(view, /Within 1 JDC V cap jump/);
  assert.match(view, /disabled=\{searchMode === 'jumpCapable'/);

  assert.match(styles, /\.ct-mode-toggle/);
});
