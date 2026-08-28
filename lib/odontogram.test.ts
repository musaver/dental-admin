import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allTeeth,
  chartByTooth,
  defaultDentition,
  dentitionOf,
  describeSurfaces,
  isValidToothNumber,
  packSurfaces,
  packTeeth,
  parseSurfaces,
  parseTeeth,
  PERMANENT_QUADRANTS,
  PRIMARY_QUADRANTS,
  toothCount,
  toothName,
} from './odontogram.ts';

describe('FDI numbering', () => {
  it('has 32 permanent teeth in four quadrants of eight', () => {
    assert.equal(allTeeth('permanent').length, 32);
    for (const q of PERMANENT_QUADRANTS) assert.equal(q.teeth.length, 8);
  });

  it('has 20 primary teeth in four quadrants of five', () => {
    assert.equal(allTeeth('primary').length, 20);
    for (const q of PRIMARY_QUADRANTS) assert.equal(q.teeth.length, 5);
  });

  it('numbers the permanent quadrants 1-4 clockwise from upper right', () => {
    assert.deepEqual(PERMANENT_QUADRANTS.map((q) => q.code), [1, 2, 4, 3]);
    assert.equal(PERMANENT_QUADRANTS[0]!.teeth[0], '11'); // upper right central incisor
    assert.equal(PERMANENT_QUADRANTS[0]!.teeth[7], '18'); // upper right third molar
    assert.equal(PERMANENT_QUADRANTS[1]!.teeth[0], '21'); // upper left central incisor
  });

  it('numbers the primary quadrants 5-8', () => {
    assert.equal(PRIMARY_QUADRANTS[0]!.teeth[0], '51');
    assert.equal(PRIMARY_QUADRANTS[0]!.teeth[4], '55');
    assert.equal(PRIMARY_QUADRANTS[2]!.teeth[0], '81');
  });

  it('accepts every real tooth number and rejects the rest', () => {
    for (const tooth of [...allTeeth('permanent'), ...allTeeth('primary')]) {
      assert.equal(isValidToothNumber(tooth), true, `${tooth} should be valid`);
    }
    // Position 9 does not exist in any quadrant, nor does position 0.
    for (const bad of ['19', '29', '39', '49', '10', '20', '50', '99', '', 'AB']) {
      assert.equal(isValidToothNumber(bad), false, `${bad} should be invalid`);
    }
  });

  it('does not confuse FDI with the US Universal system', () => {
    // The two notations overlap numerically, which is a real source of error.
    // '32' is a valid FDI tooth (quadrant 3, lower-left lateral incisor) but
    // means the lower-right third molar in Universal - a different tooth in a
    // different quadrant. Single digits are Universal-only and invalid here.
    assert.equal(isValidToothNumber('32'), true);
    assert.equal(toothName('32'), 'Lower left lateral incisor (32)');
    for (const universalOnly of ['1', '9', '30', 'A', 'T']) {
      assert.equal(isValidToothNumber(universalOnly), false);
    }
  });

  it('identifies which dentition a tooth belongs to', () => {
    assert.equal(dentitionOf('11'), 'permanent');
    assert.equal(dentitionOf('48'), 'permanent');
    assert.equal(dentitionOf('51'), 'primary');
    assert.equal(dentitionOf('85'), 'primary');
    assert.equal(dentitionOf('99'), null);
  });

  it('names teeth anatomically', () => {
    assert.equal(toothName('11'), 'Upper right central incisor (11)');
    assert.equal(toothName('26'), 'Upper left first molar (26)');
    assert.equal(toothName('48'), 'Lower right third molar (48)');
    assert.equal(toothName('51'), 'Upper right central incisor (51)');
  });

  it('fits the varchar(2) column', () => {
    for (const tooth of [...allTeeth('permanent'), ...allTeeth('primary')]) {
      assert.equal(tooth.length, 2);
    }
  });
});

describe('surface packing', () => {
  it('parses the packed string the column actually stores', () => {
    assert.deepEqual(parseSurfaces('MOD'), ['M', 'O', 'D']);
    assert.deepEqual(parseSurfaces('B'), ['B']);
    assert.deepEqual(parseSurfaces(''), []);
    assert.deepEqual(parseSurfaces(null), []);
  });

  it('normalises case and ignores letters that are not surfaces', () => {
    assert.deepEqual(parseSurfaces('mod'), ['M', 'O', 'D']);
    assert.deepEqual(parseSurfaces('MXZO'), ['M', 'O']);
  });

  it('de-duplicates', () => {
    assert.deepEqual(parseSurfaces('MMOO'), ['M', 'O']);
  });

  it('packs in a stable clinical order regardless of input order', () => {
    // Mesial-occlusal-distal is always written MOD, never DOM.
    assert.equal(packSurfaces(['D', 'M', 'O']), 'MOD');
    assert.equal(packSurfaces(['O', 'D', 'M']), 'MOD');
  });

  it('round-trips', () => {
    for (const packed of ['MOD', 'B', 'MODBL', 'OI']) {
      assert.equal(packSurfaces(parseSurfaces(packed)), packed.length ? packSurfaces(parseSurfaces(packed)) : null);
      assert.deepEqual(parseSurfaces(packSurfaces(parseSurfaces(packed))), parseSurfaces(packed));
    }
  });

  it('returns null for nothing, so the column stays NULL not empty string', () => {
    assert.equal(packSurfaces([]), null);
    assert.equal(packSurfaces(['X']), null);
  });

  it('fits varchar(10)', () => {
    assert.ok((packSurfaces(['M', 'O', 'D', 'B', 'L', 'I', 'F', 'P']) ?? '').length <= 10);
  });

  it('describes surfaces in words for a printed plan', () => {
    assert.equal(describeSurfaces('MOD'), 'Mesial, Occlusal, Distal');
    assert.equal(describeSurfaces(null), '');
  });
});

describe('teeth CSV', () => {
  it('parses the comma-separated column', () => {
    assert.deepEqual(parseTeeth('11,12,13'), ['11', '12', '13']);
    assert.deepEqual(parseTeeth('11, 12 , 13'), ['11', '12', '13']);
  });

  it('drops values that are not teeth rather than trusting them', () => {
    assert.deepEqual(parseTeeth('11,99,12'), ['11', '12']);
    assert.deepEqual(parseTeeth(''), []);
    assert.deepEqual(parseTeeth(null), []);
  });

  it('packs sorted and de-duplicated', () => {
    assert.equal(packTeeth(['13', '11', '12', '11']), '11,12,13');
    assert.equal(packTeeth([]), null);
  });

  it('counts teeth for per-tooth pricing', () => {
    // An RCT across three teeth is three units, not one.
    assert.equal(toothCount('11,12,13'), 3);
    assert.equal(toothCount('16'), 1);
  });

  it('counts at least one even with no teeth listed', () => {
    // A whole-mouth procedure still bills as a single unit.
    assert.equal(toothCount(null), 1);
    assert.equal(toothCount(''), 1);
  });

  it('fits varchar(100)', () => {
    // A realistic worst case: a full-arch plan item.
    const fullArch = packTeeth(allTeeth('permanent').slice(0, 16))!;
    assert.ok(fullArch.length <= 100, `${fullArch.length} chars`);
  });
});

describe('chartByTooth', () => {
  it('groups conditions by tooth', () => {
    const grouped = chartByTooth([
      { id: 'a', toothNumber: '16', surfaces: 'MOD', conditionType: 'caries', status: 'active' },
      { id: 'b', toothNumber: '11', surfaces: null, conditionType: 'crown', status: 'active' },
    ]);
    assert.equal(grouped.size, 2);
    assert.equal(grouped.get('16')?.[0]?.id, 'a');
  });

  it('keeps several conditions on one tooth', () => {
    // A tooth can carry a crown and an apical lesion at the same time.
    const grouped = chartByTooth([
      { id: 'a', toothNumber: '16', surfaces: null, conditionType: 'crown', status: 'active' },
      { id: 'b', toothNumber: '16', surfaces: null, conditionType: 'rct', status: 'active' },
    ]);
    assert.equal(grouped.get('16')?.length, 2);
  });

  it('is empty for no conditions', () => {
    assert.equal(chartByTooth([]).size, 0);
  });
});

describe('defaultDentition', () => {
  it('shows primary teeth for a young child', () => {
    assert.equal(defaultDentition(3), 'primary');
    assert.equal(defaultDentition(5), 'primary');
  });

  it('shows permanent teeth once they are erupting', () => {
    assert.equal(defaultDentition(6), 'permanent');
    assert.equal(defaultDentition(30), 'permanent');
  });

  it('falls back to permanent when the date of birth is unknown', () => {
    // dateOfBirth is nullable in the schema.
    assert.equal(defaultDentition(null), 'permanent');
  });
});
