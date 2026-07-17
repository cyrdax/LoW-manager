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
  assert.match(fitsView, /<button type="button" onClick=\{\(\) => setImportOpen\(false\)\} disabled=\{importBusy \|\| pyfaBusy\}>Cancel<\/button>/);
  assert.match(fitsView, /<button type="button" className="primary" onClick=\{importFit\} disabled=\{importBusy\}>/);
  assert.match(fitsView, /importBusy \? 'Previewing\.\.\.' : 'Preview'/);

  assert.match(styles, /\.fits-modal \{[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.fits-import-text \{[\s\S]*?flex: 1 1 auto;/);
  assert.match(styles, /\.fits-import-text \{[\s\S]*?min-height: 220px;/);
  assert.match(styles, /\.fits-modal-actions \{[\s\S]*?flex: 0 0 auto;/);
});

test('fit import modal supports pyfa screenshot extraction into existing preview flow', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');

  assert.match(api, /export interface PyfaImageImportRequest/);
  assert.match(api, /export async function importPyfaImage/);
  assert.match(fitsView, /importPyfaImage/);
  assert.match(fitsView, /const \[importMode, setImportMode\] = useState<'eft' \| 'pyfa-image'>\('eft'\)/);
  assert.match(fitsView, />Paste EFT</);
  assert.match(fitsView, />pyfa Screenshot</);
  assert.match(fitsView, /setImportText\(res\.rawEft\)/);
  assert.match(fitsView, /setImportMode\('eft'\)/);
  assert.match(fitsView, /pyfaWarnings\.map/);
  assert.match(fitsView, /previewFit\(importText\)/);
});

test('fit import modal accepts pyfa screenshots from paste and clipboard button', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');

  assert.match(fitsView, /handlePyfaPaste/);
  assert.match(fitsView, /onPaste=\{handlePyfaPaste\}/);
  assert.match(fitsView, /tabIndex=\{0\}/);
  assert.match(fitsView, /pastePyfaImageFromClipboard/);
  assert.match(fitsView, /navigator\.clipboard\.read/);
  assert.match(fitsView, />Paste from Clipboard</);
  assert.match(fitsView, /setImportError\('Clipboard does not contain an image\.'\)/);
});
