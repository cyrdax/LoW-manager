import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDefaultPyfaScreenshotExtractor,
  PYFA_IMAGE_IMPORT_NOT_CONFIGURED,
  renderPyfaExtractionToEft,
  validatePyfaImageInput,
  type PyfaScreenshotExtraction,
} from './pyfa-image-import.ts';

describe('pyfa screenshot import', () => {
  test('renders visible pyfa extraction as editable EFT text', () => {
    const extraction: PyfaScreenshotExtraction = {
      shipName: 'Paladin',
      fitName: 'Fabricator',
      warnings: ['Visible additions may be incomplete.'],
      sections: [
        { role: 'high', items: [
          { name: 'Mega Pulse Laser II', loadedCharge: 'Conflagration L (1, 1000 cycles)' },
          { name: 'Core Probe Launcher I', loadedCharge: 'Sisters Core Scanner Probe (8)' },
        ] },
        { role: 'mid', items: [{ name: 'Tracking Computer II', loadedCharge: 'Optimal Range Script (1)' }] },
        { role: 'extras', items: [{ name: "Agency 'Pyrolancea' DB5 Dose II", quantity: 11 }] },
      ],
    };

    const rendered = renderPyfaExtractionToEft(extraction);

    assert.equal(rendered.rawEft, [
      '[Paladin, Fabricator]',
      '',
      'Mega Pulse Laser II, Conflagration L',
      'Core Probe Launcher I, Sisters Core Scanner Probe',
      '',
      'Tracking Computer II, Optimal Range Script',
      '',
      "Agency 'Pyrolancea' DB5 Dose II x11",
    ].join('\n'));
    assert.deepEqual(rendered.warnings, ['Visible additions may be incomplete.']);
  });

  test('rejects unsupported mime types and oversized base64 images', () => {
    assert.throws(() => validatePyfaImageInput({ imageBase64: 'AAAA', mimeType: 'image/gif' }), /unsupported image type/i);
    const twoBytes = Buffer.from([1, 2]).toString('base64');
    assert.throws(() => validatePyfaImageInput({ imageBase64: twoBytes, mimeType: 'image/png' }, 1), /image is too large/i);
  });

  test('default extractor reports a clear configuration error without OPENAI_API_KEY', async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await assert.rejects(
        () => createDefaultPyfaScreenshotExtractor().extract({ imageBase64: 'AAAA', mimeType: 'image/png' }),
        error => error instanceof Error && error.message === PYFA_IMAGE_IMPORT_NOT_CONFIGURED,
      );
    } finally {
      if (oldKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    }
  });
});
