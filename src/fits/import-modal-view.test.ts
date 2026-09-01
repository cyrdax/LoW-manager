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
  assert.match(fitsView, /const \[importText, setImportText\] = useState\(''\)/);
  assert.match(fitsView, /if \(!importOpen\) return;\s+setImportText\(''\)/);
  assert.match(fitsView, /className="fits-import-modal" bodyClassName="fits-import-modal-body"/);
  assert.match(fitsView, /<button type="button" onClick=\{\(\) => setImportOpen\(false\)\} disabled=\{importBusy \|\| pyfaBusy \|\| discordScanning \|\| discordApplying\}>Cancel<\/button>/);
  assert.match(fitsView, /<button type="button" className="primary" onClick=\{importFit\} disabled=\{importBusy\}>/);
  assert.match(fitsView, /importBusy \? 'Previewing\.\.\.' : 'Preview'/);

  assert.match(styles, /\.fits-modal \{[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.fits-import-modal \{[\s\S]*?height: min\(820px, calc\(100vh - 40px\)\);/);
  assert.match(styles, /\.fits-import-modal-body \{[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.fits-import-pane \{[\s\S]*?flex: 1 1 auto;/);
  assert.match(styles, /\.fits-import-text \{[\s\S]*?flex: 1 1 auto;/);
  assert.match(styles, /\.fits-import-text \{[\s\S]*?min-height: 0;/);
  assert.match(styles, /\.fits-import-drop \{[\s\S]*?flex: 1 1 auto;/);
  assert.match(styles, /\.fits-discord-import \{[\s\S]*?flex: 1 1 auto;/);
  assert.match(styles, /\.fits-modal-actions \{[\s\S]*?flex: 0 0 auto;/);
});

test('fit import modal supports Pyfa and in-game screenshot extraction into existing preview flow', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');

  assert.match(api, /export interface PyfaImageImportRequest/);
  assert.match(api, /export async function importPyfaImage/);
  assert.match(fitsView, /importPyfaImage/);
  assert.match(fitsView, /type ImportMode = 'eft' \| 'pyfa-image' \| 'discord'/);
  assert.match(fitsView, /const \[importMode, setImportMode\] = useState<ImportMode>\('eft'\)/);
  assert.match(fitsView, />Paste EFT</);
  assert.match(fitsView, />Fit Screenshot</);
  assert.match(fitsView, /Drop a Pyfa or in-game fitting screenshot/);
  assert.match(fitsView, /Failed to extract fit screenshot\./);
  assert.match(fitsView, /setImportText\(res\.rawEft\)/);
  assert.match(fitsView, /setImportMode\('eft'\)/);
  assert.match(fitsView, /pyfaWarnings\.map/);
  assert.match(fitsView, /previewFit\(importText\)/);
});

test('fit import modal supports discord channel scan review and import', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(api, /export interface DiscordImportChannel/);
  assert.match(api, /export interface DiscordImportScanResult/);
  assert.match(api, /export async function fetchDiscordImportChannels/);
  assert.match(api, /export async function scanDiscordImport/);
  assert.match(api, /export async function applyDiscordImport/);

  assert.match(fitsView, /'eft' \| 'pyfa-image' \| 'discord'/);
  assert.match(fitsView, />Discord</);
  assert.match(fitsView, /fetchDiscordImportChannels/);
  assert.match(fitsView, /discordChannelsLoaded/);
  assert.match(fitsView, /Retry channels/);
  assert.doesNotMatch(fitsView, /\[importOpen, importMode, discordLoadingChannels, discordChannelsLoaded\]/);
  assert.match(fitsView, /scanDiscordImport/);
  assert.match(fitsView, /applyDiscordImport/);
  assert.match(fitsView, /discordChannels\.map/);
  assert.match(fitsView, /Scan screenshots/);
  assert.match(fitsView, /includeImages: discordIncludeImages/);
  assert.match(fitsView, /discordScanResult\.summary\.imagesSkipped/);
  assert.match(fitsView, /discordScanResult\.warnings\.map/);
  assert.match(fitsView, /handleDiscordPrimary/);
  assert.match(fitsView, /Scan selected/);
  assert.match(fitsView, /No fits found/);
  assert.match(fitsView, /Import selected/);
  assert.match(fitsView, /discordActionKey/);
  assert.match(fitsView, /Discord source/);

  assert.match(styles, /\.fits-discord-import/);
  assert.match(styles, /\.fits-discord-checkbox/);
  assert.match(styles, /\.fits-discord-summary/);
  assert.match(styles, /\.fits-discord-group/);
  assert.match(styles, /\.fits-discord-fit/);
  assert.match(styles, /\.fits-modal-actions button:disabled/);
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
