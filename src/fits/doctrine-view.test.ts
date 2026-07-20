import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('frontend exposes doctrine api helpers and doctrine view controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');
  const switchView = readFileSync(resolve('web/src/components/FitModeSwitch.tsx'), 'utf8');

  assert.match(api, /export interface DoctrineSummary/);
  assert.match(api, /export interface DoctrineDetail/);
  assert.match(api, /export async function fetchDoctrines/);
  assert.match(api, /export async function addDoctrineFit/);
  assert.match(api, /export async function removeDoctrineFit/);

  assert.match(fitsView, /DoctrinesView/);
  assert.match(switchView, /Fits/);
  assert.match(switchView, /Doctrines/);
  assert.match(doctrinesView, /Search doctrines/);
  assert.match(doctrinesView, /Create doctrine/);
  assert.match(doctrinesView, /const \[editing, setEditing\] = useState\(false\)/);
  assert.match(doctrinesView, /canStartEditing/);
  assert.match(doctrinesView, />Edit<\/button>/);
  assert.match(doctrinesView, /doctrine-head \$\{isEditing \? 'editing' : 'viewing'\}/);
  assert.match(doctrinesView, /doctrine-description-view/);
  assert.match(doctrinesView, /Google Doc URL/);
  assert.match(doctrinesView, /google-doc-frame/);
  assert.match(doctrinesView, /googleDocPreviewUrl/);
  assert.match(doctrinesView, /Add fit/);
  assert.match(doctrinesView, /Remove/);
});

test('doctrine view description spans the full detail container', () => {
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(styles, /\.doctrine-head\.viewing \.doctrine-fields \{\n  display: contents;\n\}/);
  assert.match(styles, /\.doctrine-head\.viewing \.doctrine-view-summary \{\n  grid-column: 1 \/ -1;\n\}/);
  assert.match(styles, /\.google-doc-frame \{[\s\S]*?width: 100%;/);
});

test('frontend exposes public and private fit library controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');

  assert.match(api, /export type LibraryVisibility/);
  assert.match(api, /ownerUserId: string \| null/);
  assert.match(api, /visibility: LibraryVisibility/);
  assert.match(api, /sourcePublicFitId: number \| null/);
  assert.match(api, /sourcePublicDoctrineId: number \| null/);
  assert.match(api, /googleDocUrl: string;/);
  assert.match(api, /export async function fetchFits\(visibility: LibraryVisibility = 'private'\)/);
  assert.match(api, /export async function publishFit/);
  assert.match(api, /export async function copyFitToPrivate/);
  assert.match(api, /export async function fetchDoctrines\(q = '', visibility: LibraryVisibility = 'private', fitId\?: number\)/);
  assert.match(api, /if \(fitId != null\) qs\.set\('fitId', String\(fitId\)\)/);
  assert.match(api, /export async function publishDoctrine/);
  assert.match(api, /export async function copyDoctrineToPrivate/);

  assert.match(fitsView, /FITS_VISIBILITY_KEY/);
  assert.match(fitsView, /LibraryScopeSwitch/);
  assert.match(fitsView, /<main className="rows-wrap fits-page">/);
  assert.match(fitsView, /<div className="fits-topbar">/);
  assert.match(fitsView, /<LibraryScopeSwitch value=\{visibility\} onChange=\{setVisibility\} \/>/);
  assert.match(fitsView, /<SavedFitsView[^>]+visibility=\{visibility\}[^>]+setVisibility=\{setVisibility\}/s);
  assert.match(fitsView, /<DoctrinesView[^>]+visibility=\{visibility\}[^>]+setVisibility=\{setVisibility\}/s);
  assert.doesNotMatch(fitsView, /<main className="rows-wrap fits-view">/);
  assert.match(fitsView, /fetchFits\((scope|visibility)\)/);
  assert.match(fitsView, /publishCurrent/);
  assert.match(fitsView, /copyCurrentToPrivate/);
  assert.match(fitsView, /Publish/);
  assert.match(fitsView, /Copy private/);

  assert.doesNotMatch(doctrinesView, /DOCTRINE_VISIBILITY_KEY/);
  assert.doesNotMatch(doctrinesView, /LibraryScopeSwitch/);
  assert.doesNotMatch(doctrinesView, /<main className="rows-wrap fits-view">/);
  assert.match(doctrinesView, /fetchDoctrines\(q, (scope|visibility)\)/);
  assert.match(doctrinesView, /publishCurrentDoctrine/);
  assert.match(doctrinesView, /copyDoctrineToPrivate/);
  assert.match(doctrinesView, /Publish/);
  assert.match(doctrinesView, /Copy private/);
});

test('new doctrine starts as an unnamed draft instead of saved placeholder text', () => {
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');

  assert.match(doctrinesView, /const \[draftMode, setDraftMode\] = useState\(false\)/);
  assert.match(doctrinesView, /setDraftMode\(true\)/);
  assert.doesNotMatch(doctrinesView, /createDoctrine\(\{ name: 'New Doctrine'/);
  assert.match(doctrinesView, /placeholder="New doctrine"/);
  assert.match(doctrinesView, /if \(!trimmedName\)/);
  assert.match(doctrinesView, /await createDoctrine\(\{ name: trimmedName, description, googleDocUrl, visibility \}\)/);
});

test('clicking a doctrine member opens that saved fit in the fit view', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');

  assert.match(fitsView, /type FitOpenTarget = \{ id: number; visibility: LibraryVisibility \} \| null/);
  assert.match(fitsView, /const \[openFitTarget, setOpenFitTarget\] = useState<FitOpenTarget>\(null\)/);
  assert.match(fitsView, /function openDoctrineFit\(fit: SavedFitSummary\)/);
  assert.match(fitsView, /setOpenFitTarget\(\{ id: fit\.id, visibility: fit\.visibility \}\)/);
  assert.match(fitsView, /setVisibility\(fit\.visibility\)/);
  assert.match(fitsView, /setMode\('fits'\)/);
  assert.match(fitsView, /<DoctrinesView[^>]+onOpenFit=\{openDoctrineFit\}/s);
  assert.match(fitsView, /<SavedFitsView[^>]+openFitTarget=\{openFitTarget\}/s);
  assert.match(fitsView, /if \(!openFitTarget\) return/);
  assert.match(fitsView, /setSelectedId\(openFitTarget\.id\)/);

  assert.match(doctrinesView, /onOpenFit: \(fit: SavedFitSummary\) => void/);
  assert.match(doctrinesView, /className="doctrine-member-open"/);
  assert.match(doctrinesView, /onClick=\{\(\) => onOpenFit\(fit\)\}/);
});

test('saved fit view lists containing doctrines and opens them in doctrine view', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');

  assert.match(fitsView, /type DoctrineOpenTarget = \{ id: number; visibility: LibraryVisibility \} \| null/);
  assert.match(fitsView, /const \[openDoctrineTarget, setOpenDoctrineTarget\] = useState<DoctrineOpenTarget>\(null\)/);
  assert.match(fitsView, /function openFitDoctrine\(doctrine: DoctrineSummary\)/);
  assert.match(fitsView, /setOpenDoctrineTarget\(\{ id: doctrine\.id, visibility: doctrine\.visibility \}\)/);
  assert.match(fitsView, /setVisibility\(doctrine\.visibility\)/);
  assert.match(fitsView, /setMode\('doctrines'\)/);
  assert.match(fitsView, /<DoctrinesView[^>]+openDoctrineTarget=\{openDoctrineTarget\}/s);
  assert.match(fitsView, /<SavedFitsView[^>]+onOpenDoctrine=\{openFitDoctrine\}/s);
  assert.match(fitsView, /const \[fitDoctrines, setFitDoctrines\] = useState<DoctrineSummary\[\]>\(\[\]\)/);
  assert.match(fitsView, /fetchDoctrines\('', activeVisibility, activeSavedId\)/);
  assert.match(fitsView, /<FitDoctrinesPanel doctrines=\{fitDoctrines\} loading=\{fitDoctrinesLoading\} onOpen=\{onOpenDoctrine\} \/>/);
  assert.match(fitsView, /function FitDoctrinesPanel\(\{ doctrines, loading, onOpen \}/);
  assert.match(fitsView, /onClick=\{\(\) => onOpen\(doctrine\)\}/);
});

test('fit view renders fitted slots vertically in zkill-style order', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(fitsView, /const SLOT_ROLES: FitSectionRole\[\] = \['high', 'mid', 'low', 'rig', 'subsystem', 'service'\]/);
  assert.match(fitsView, /<SlotItemRow key=\{item\.id\} item=\{item\} over=\{i >= section\.slotCount\} tooltip=\{tooltip\} \/>/);
  assert.match(fitsView, /<div key=\{i\} className="fits-item-row fits-slot-empty">/);
  assert.doesNotMatch(fitsView, /<ItemCell key=\{item\.id\} item=\{item\}/);
  assert.match(fitsView, /function SlotItemRow\(\{ item, over, tooltip \}/);
  assert.match(styles, /\.fits-slot-list/);
  assert.match(styles, /\.fits-slot-empty/);
  assert.doesNotMatch(styles, /\.fits-slot-grid \{\n  display: grid;\n  grid-template-columns: repeat\(auto-fill, 44px\);/);
});

test('fit header places cost refresh and send controls below the ship identity row', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');
  const mainIndex = fitsView.indexOf('<div className="fits-head-main">');
  const imageIndex = fitsView.indexOf('<img className="fits-ship-icon"');
  const titleIndex = fitsView.indexOf('<div className="fits-title-block">');
  const actionsIndex = fitsView.indexOf('<div className="fits-actions">');
  const controlsIndex = fitsView.indexOf('<div className="fits-ship-controls">');

  assert.ok(mainIndex >= 0);
  assert.ok(imageIndex > mainIndex);
  assert.ok(titleIndex > imageIndex);
  assert.ok(actionsIndex > titleIndex);
  assert.ok(controlsIndex > actionsIndex);
  assert.match(fitsView, /<div className="fits-ship-summary">/);
  assert.match(fitsView, /<div className="fits-ship-controls">/);
  assert.match(fitsView, /<div className="fits-cost-row">/);
  assert.match(fitsView, /<strong className="fits-fit-cost">/);
  assert.match(fitsView, /<button onClick=\{props\.onRefresh\} disabled=\{props\.quoteLoading\}>Refresh Price<\/button>/);
  assert.match(fitsView, /props\.sendStatus\.kind === 'sending' \? 'Sending\.\.\.' : 'Send Fit'/);
  assert.doesNotMatch(fitsView, /<div className="fits-actions">\s*<strong>\{props\.quote/s);
  assert.match(styles, /\.fits-ship-summary/);
  assert.match(styles, /\.fits-cost-row/);
  assert.match(styles, /\.fits-fit-cost/);
  assert.match(styles, /\.fits-cost-row \{[\s\S]*?grid-template-columns: minmax\(240px, 1fr\) auto;/);
  assert.match(styles, /grid-template-columns: minmax\(240px, 1fr\) 92px;/);
});

test('fit header keeps cost and send controls on their own lower row without shrinking the selector row', () => {
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(styles, /\.fits-fit-head \{\n  display: flex;\n  flex-direction: column;/);
  assert.match(
    styles,
    /\.fits-head-main \{\n  display: grid;\n  grid-template-columns: 72px minmax\(0, 1fr\) minmax\(220px, 320px\);/,
  );
  assert.doesNotMatch(styles, /\.fits-ship-summary \{[^}]*grid-template-columns:/);
  assert.match(styles, /\.fits-ship-controls \{[\s\S]*?width: 340px;/);
  assert.match(styles, /@media \(max-width: 1240px\) \{[\s\S]*?\.fits-head-main \{ grid-template-columns: 60px minmax\(0, 1fr\); \}/);
  assert.match(styles, /@media \(max-width: 820px\) \{[\s\S]*?\.fits-head-main,/);
  assert.match(styles, /@media \(max-width: 820px\) \{[\s\S]*?\.fits-ship-controls \{ width: min\(340px, 100%\); \}/);
});

test('fit header does not expose a manual hull override text field', () => {
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.doesNotMatch(fitsView, /ShipPicker/);
  assert.doesNotMatch(fitsView, /Override hull/);
  assert.doesNotMatch(fitsView, /onShip/);
  assert.doesNotMatch(fitsView, /applyShipOverride/);
  assert.doesNotMatch(styles, /\.fits-ship-picker/);
  assert.doesNotMatch(styles, /\.fits-ship-menu/);
});
