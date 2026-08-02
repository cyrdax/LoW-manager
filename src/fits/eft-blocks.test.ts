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

test('EFT block extraction accepts Discord code fences on the header line', () => {
  const blocks = extractEftBlocksFromText(`\`\`\`[Archon, Fabricator?]
Centus X-Type EM Armor Hardener
Centus X-Type EM Armor Hardener

Omnidirectional Tracking Link II
Capital Cap Battery II

Integrated Sensor Array
Fighter Support Unit II

Capital Auxiliary Nano Pump I

Equite II x12
Templar II x6
\`\`\`

This is what I'm considering`);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].shipName, 'Archon');
  assert.equal(blocks[0].fitName, 'Fabricator?');
  assert.equal(blocks[0].rawEft.startsWith('[Archon, Fabricator?]'), true);
  assert.equal(blocks[0].rawEft.includes('```'), false);
  assert.equal(blocks[0].rawEft.includes("This is what I'm considering"), false);
});
