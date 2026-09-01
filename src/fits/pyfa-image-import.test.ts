import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildFitDraft } from './assignment.ts';
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
      '[Empty Low slot]',
      '',
      'Tracking Computer II, Optimal Range Script',
      '',
      'Mega Pulse Laser II, Conflagration L',
      'Core Probe Launcher I, Sisters Core Scanner Probe',
      '',
      '[Empty Rig slot]',
      '',
      "Agency 'Pyrolancea' DB5 Dose II x11",
    ].join('\n'));
    assert.deepEqual(rendered.warnings, ['Visible additions may be incomplete.']);
  });

  test('maps visible in-game inventory sections to one EFT extras block and preserves quantities', () => {
    const extraction: PyfaScreenshotExtraction = {
      shipName: 'Naglfar',
      fitName: 'Armor Naglfar',
      warnings: [],
      sections: [
        { role: 'high', items: [{ name: 'Hexa 2500mm Repeating Cannon II', quantity: 3 }] },
        { role: 'charges', items: [{ name: 'Hail XL', quantity: 3888 }] },
        { role: 'implantsBoosters', items: [{ name: 'Synth Mindflood Booster', quantity: 7 }] },
        { role: 'cargoModules', items: [{ name: 'Capacitor Flux Coil II', quantity: 4 }] },
        { role: 'otherItems', items: [{ name: "'Wetu' Mobile Depot", quantity: 1 }] },
      ],
    };

    const rendered = renderPyfaExtractionToEft(extraction);

    assert.equal(rendered.rawEft, [
      '[Naglfar, Armor Naglfar]',
      '',
      '[Empty Low slot]',
      '',
      '[Empty Med slot]',
      '',
      'Hexa 2500mm Repeating Cannon II',
      'Hexa 2500mm Repeating Cannon II',
      'Hexa 2500mm Repeating Cannon II',
      '',
      '[Empty Rig slot]',
      '',
      'Hail XL x3888',
      'Synth Mindflood Booster x7',
      'Capacitor Flux Coil II x4',
      "'Wetu' Mobile Depot",
    ].join('\n'));
  });

  test('round trips in-game fitted and inventory rows into their intended fit roles', () => {
    const rendered = renderPyfaExtractionToEft({
      shipName: 'Naglfar',
      fitName: 'Armor Naglfar',
      warnings: [],
      sections: [
        { role: 'high', items: [{ name: 'Hexa 2500mm Repeating Cannon II', quantity: 3 }] },
        { role: 'charges', items: [{ name: 'Hail XL', quantity: 3888 }] },
        { role: 'cargoModules', items: [{ name: 'Capacitor Flux Coil II', quantity: 4 }] },
      ],
    });

    const draft = buildFitDraft(rendered.rawEft);

    const guns = draft.items.filter(item => item.inputName === 'Hexa 2500mm Repeating Cannon II');
    assert.equal(guns.length, 3);
    assert.deepEqual(guns.map(item => item.role), ['high', 'high', 'high']);
    assert.deepEqual(guns.map(item => item.slotFlag), ['HiSlot0', 'HiSlot1', 'HiSlot2']);
    assert.equal(draft.items.find(item => item.inputName === 'Hail XL')?.role, 'extras');
    assert.equal(draft.items.find(item => item.inputName === 'Capacitor Flux Coil II')?.role, 'extras');
    assert.equal(draft.items.some(item => item.inputName.startsWith('[Empty ')), false);
    assert.equal(draft.warnings.some(warning => warning.code === 'unmatched-item'), false);
  });

  test('uses a reviewable fallback name when an in-game screenshot fit name is unreadable', () => {
    const rendered = renderPyfaExtractionToEft({
      shipName: 'Naglfar',
      fitName: null,
      warnings: [],
      sections: [{ role: 'rig', items: [{ name: 'Capital Semiconductor Memory Cell I', quantity: 2 }] }],
    });

    assert.match(rendered.rawEft, /^\[Naglfar, Naglfar screenshot import\]/);
    assert.deepEqual(rendered.warnings, ['Fit name was not readable; using "Naglfar screenshot import".']);
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

  test('default extractor posts image input to OpenAI Responses API and parses structured JSON', async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    const oldModel = process.env.PYFA_IMAGE_IMPORT_MODEL;
    const oldFetch = globalThis.fetch;
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.PYFA_IMAGE_IMPORT_MODEL = 'test-vision-model';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(input);
      seenInit = init;
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          shipName: 'Paladin',
          fitName: 'Fabricator',
          warnings: ['Visible additions may be incomplete.'],
          sections: [{ role: 'high', items: [{ name: 'Mega Pulse Laser II', loadedCharge: 'Conflagration L' }] }],
        }),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const extraction = await createDefaultPyfaScreenshotExtractor().extract({ imageBase64: 'AAAA', mimeType: 'image/png' });

      assert.equal(seenUrl, 'https://api.openai.com/v1/responses');
      const headers = seenInit?.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer test-openai-key');
      const body = JSON.parse(String(seenInit?.body));
      assert.equal(body.model, 'test-vision-model');
      assert.equal(body.store, false);
      assert.equal(body.input[0].content[1].type, 'input_image');
      assert.equal(body.input[0].content[1].image_url, 'data:image/png;base64,AAAA');
      assert.match(body.input[0].content[0].text, /Ship Fitting: <ship>/);
      assert.match(body.input[0].content[0].text, /Charges, Implants & Boosters, Modules, and Other Items/);
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.required.includes('shipName'), true);
      assert.equal(body.text.format.schema.properties.sections.items.properties.role.enum.includes('charges'), true);
      assert.equal(extraction.shipName, 'Paladin');
      assert.equal(extraction.sections[0].items[0].loadedCharge, 'Conflagration L');
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
      if (oldModel == null) delete process.env.PYFA_IMAGE_IMPORT_MODEL;
      else process.env.PYFA_IMAGE_IMPORT_MODEL = oldModel;
    }
  });
});
