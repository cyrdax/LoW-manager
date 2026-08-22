import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('contracts view opens a contract detail modal with itemized market estimates', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const view = readFileSync(resolve('web/src/components/ContractsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(api, /export interface ContractDetails/);
  assert.match(api, /export async function fetchContractDetails/);
  assert.match(api, /\/api\/contracts\/\$\{contractId\}\/details\?/);
  assert.match(api, /export async function setWaypointAll/);
  assert.match(api, /export async function fetchCharacters/);

  assert.match(view, /const \[detailRow, setDetailRow\] = useState<ContractSearchResult \| null>\(null\)/);
  assert.match(view, /<ContractResultsTable rows=\{response\.results\} onOpenDetails=\{setDetailRow\} \/>/);
  assert.match(view, /<ContractDetailsModal row=\{detailRow\}/);
  assert.match(view, /fetchContractDetails\(row\.contractId, hub/);
  assert.match(view, /Contract Price Breakdown/);
  assert.match(view, /sortContractDetailItems\(details\.items, quoteByType, detailSort\.key, detailSort\.direction\)/);
  assert.match(view, /details\.quote\.items/);
  assert.match(view, /<ContractDetailSortTh label="Item" sortKey="item"/);
  assert.match(view, /<ContractDetailSortTh label="Category" sortKey="category"/);
  assert.match(view, /<ContractDetailSortTh label="Qty" sortKey="quantity"/);
  assert.match(view, /<ContractDetailSortTh label="Unit" sortKey="unit"/);
  assert.match(view, /<ContractDetailSortTh label="Total" sortKey="total"/);
  assert.match(view, /<ContractDetailSortTh label="Status" sortKey="status"/);
  assert.match(view, /fetchCharacters\(\)\.then\(pilots =>/);
  assert.match(view, /setWaypointAll\(details\.contract\.locationId, \[selectedDestinationPilotId\]\)/);
  assert.match(view, /Set destination/);
  assert.match(view, /disabled=\{destinationBusy \|\| !details\.contract\.locationId \|\| selectedDestinationPilotId == null\}/);

  assert.match(styles, /\.ct-row-clickable/);
  assert.match(styles, /\.ct-detail-modal/);
  assert.match(styles, /\.ct-detail-grid/);
  assert.match(styles, /\.ct-detail-sort-btn/);
  assert.match(styles, /\.ct-detail-total/);
  assert.match(styles, /\.ct-destination/);
});

test('contracts detail keeps public pricing while replacing destination controls with login CTA for anonymous users', () => {
  const view = readFileSync(resolve('web/src/components/ContractsView.tsx'), 'utf8');

  assert.match(view, /export function ContractsView\(\{ currentUser, onLoginRequired \}: Props\)/);
  assert.match(view, /<ContractDetailsModal row=\{detailRow\} currentUser=\{currentUser\} onLoginRequired=\{onLoginRequired\}/);
  assert.match(view, /currentUser \? \(/);
  assert.match(view, /Log in to set destination/);
  assert.match(view, /onClick=\{onLoginRequired\}/);
});
