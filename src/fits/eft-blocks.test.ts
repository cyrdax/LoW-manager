import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEftBlocksFromText } from './eft-blocks.ts';

const naglfar = `[Naglfar, Dread DPS]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Siege Module II

Hail XL x20`;

const archon = `[Archon, Carrier Support]
Drone Damage Amplifier II

Capital Cap Battery II

Equite II x12`;

test('EFT block extraction reads fit blocks from mixed prose', () => {
  const blocks = extractEftBlocksFromText(`Intro text

${naglfar}

Some notes between fits.

${archon}`);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].shipName, 'Naglfar');
  assert.equal(blocks[0].fitName, 'Dread DPS');
  assert.equal(blocks[0].rawEft.includes('Hail XL x20'), true);
  assert.equal(blocks[1].shipName, 'Archon');
  assert.equal(blocks[1].fitName, 'Carrier Support');
});

test('EFT block extraction stops a fit before trailing prose after a blank separator', () => {
  const blocks = extractEftBlocksFromText(`${naglfar}

How this fit works:
Use it with links and cap chain notes.

${archon}`);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].fitName, 'Dread DPS');
  assert.equal(blocks[0].rawEft.includes('Hail XL x20'), true);
  assert.equal(blocks[0].rawEft.includes('How this fit works'), false);
  assert.equal(blocks[0].rawEft.includes('Use it with links'), false);
  assert.equal(blocks[1].fitName, 'Carrier Support');
});
