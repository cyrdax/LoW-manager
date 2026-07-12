import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('fit import preview remains clickable and gives feedback while previewing', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(fitsView, /const \[importBusy, setImportBusy\] = useState\(false\)/);
  assert.match(fitsView, /if \(importBusy\) return/);
  assert.match(fitsView, /setImportBusy\(true\)/);
  assert.match(fitsView, /setImportBusy\(false\)/);
  assert.match(fitsView, /catch \(err\)/);
  assert.match(fitsView, /setImportError\(err instanceof Error \? err\.message : 'Failed to preview fit\.'\)/);
  assert.match(fitsView, /<button type="button" onClick=\{\(\) => setImportOpen\(false\)\} disabled=\{importBusy\}>Cancel<\/button>/);
  assert.match(fitsView, /<button type="button" className="primary" onClick=\{importFit\} disabled=\{importBusy\}>/);
  assert.match(fitsView, /importBusy \? 'Previewing\.\.\.' : 'Preview'/);

  assert.match(styles, /\.fits-modal \{[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.fits-import-text \{[\s\S]*?flex: 1 1 auto;/);
  assert.match(styles, /\.fits-import-text \{[\s\S]*?min-height: 220px;/);
  assert.match(styles, /\.fits-modal-actions \{[\s\S]*?flex: 0 0 auto;/);
});
