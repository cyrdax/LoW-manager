import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFitDraft } from './assignment.ts';
import { buildEsiFittingPayload } from './esi.ts';
import type { AssignedFitItem, FitDraft } from './types.ts';

const fit = `[Naglfar, ESI Test]
Republic Fleet Gyrostabilizer

Pithum C-Type Multispectrum Shield Hardener

Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x10
Definitely Not A Real Module`;

describe('ESI fitting payloads', () => {
  it('builds slot and cargo flags while excluding unmatched rows', () => {
    const draft = buildFitDraft(fit);
    const payload = buildEsiFittingPayload(draft);
    assert.equal(payload.ship_type_id, 19722);
    assert.equal(payload.name, 'ESI Test');
    assert.equal(payload.items.some(item => item.flag === 'LoSlot0'), true);
    assert.equal(payload.items.some(item => item.flag === 'MedSlot0'), true);
    assert.equal(payload.items.some(item => item.flag === 'HiSlot0'), true);
    assert.equal(payload.items.some(item => item.flag === 'RigSlot0'), true);
    assert.equal(payload.items.some(item => item.flag === 'Cargo' && item.quantity === 10), true);
    assert.equal(payload.items.some(item => item.type_id == null), false);
    assert.equal(payload.items.length, 5);
  });

  it('truncates names to the ESI fitting limit', () => {
    const draft = buildFitDraft(fit);
    const payload = buildEsiFittingPayload({ ...draft, fitName: 'x'.repeat(80) });
    assert.equal(payload.name.length, 50);
  });

  it('rejects payloads with more than 512 exportable items', () => {
    const draft = buildFitDraft(fit);
    const source = draft.items.find(item => item.slotFlag === 'Cargo')!;
    const items: AssignedFitItem[] = Array.from({ length: 513 }, (_, index) => ({
      ...source,
      id: `cargo-${index}`,
      quantity: 1,
    }));
    const overloaded: FitDraft = { ...draft, items };
    assert.throws(() => buildEsiFittingPayload(overloaded), /512/);
  });
});
