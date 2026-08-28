import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatMrn,
  isDuplicateKeyError,
  normalizePhone,
  parseMrnSequence,
  patientLabel,
  patientName,
  phoneMatchKey,
} from './patient-identity.ts';

describe('MRN format', () => {
  it('renders branch code plus a zero-padded sequence', () => {
    assert.equal(formatMrn('MAIN', 1), 'MAIN-000001');
    assert.equal(formatMrn('MAIN', 123), 'MAIN-000123');
    assert.equal(formatMrn('MAIN', 999999), 'MAIN-999999');
  });

  it('upper-cases the branch code', () => {
    assert.equal(formatMrn('main', 1), 'MAIN-000001');
  });

  it('sorts lexicographically in numeric order', () => {
    // This is why the padding matters: ORDER BY mrn DESC on the unique index
    // finds the highest number without scanning the table.
    const mrns = [formatMrn('MAIN', 2), formatMrn('MAIN', 10), formatMrn('MAIN', 1)];
    assert.deepEqual([...mrns].sort(), ['MAIN-000001', 'MAIN-000002', 'MAIN-000010']);
  });

  it('round-trips through parseMrnSequence', () => {
    for (const n of [1, 42, 999999]) {
      assert.equal(parseMrnSequence(formatMrn('MAIN', n)), n);
    }
  });

  it('returns 0 for something that is not an MRN', () => {
    assert.equal(parseMrnSequence('not-an-mrn'), 0);
    assert.equal(parseMrnSequence(''), 0);
  });

  it('fits comfortably inside varchar(20)', () => {
    assert.ok(formatMrn('CLIFTON', 999999).length <= 20);
  });
});

describe('normalizePhone', () => {
  it('collapses every way a Pakistani mobile gets typed into one value', () => {
    // Same person, four keyboards. Without this they become four patients.
    const expected = '+923001234567';
    for (const input of [
      '03001234567',
      '0300 123 4567',
      '0300-1234567',
      '+92 300 1234567',
      '+923001234567',
      '92 300 1234567',
      '00923001234567',
      '3001234567',
      '(0300) 1234567',
    ]) {
      assert.equal(normalizePhone(input), expected, `failed for ${JSON.stringify(input)}`);
    }
  });

  it('handles a landline in local form', () => {
    // 021 is Karachi; 11 digits starting 0 is treated as a local number.
    assert.equal(normalizePhone('02134567890'), '+922134567890');
  });

  it('keeps an overseas number rather than rejecting it', () => {
    // Refusing to register an overseas patient would be worse than a looser value.
    assert.equal(normalizePhone('+441632960961'), '+441632960961');
  });

  it('returns null for nothing', () => {
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone(undefined), null);
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone('   '), null);
    assert.equal(normalizePhone('abc'), null);
  });
});

describe('phoneMatchKey', () => {
  it('matches across formats, which is what duplicate detection relies on', () => {
    const key = phoneMatchKey('0300 123 4567');
    assert.equal(phoneMatchKey('+923001234567'), key);
    assert.equal(phoneMatchKey('3001234567'), key);
    assert.equal(key, '001234567');
  });

  it('distinguishes genuinely different numbers', () => {
    assert.notEqual(phoneMatchKey('03001234567'), phoneMatchKey('03007654321'));
  });

  it('returns null for nothing', () => {
    assert.equal(phoneMatchKey(null), null);
    assert.equal(phoneMatchKey(''), null);
  });
});

describe('patientName', () => {
  it('joins both halves', () => {
    assert.equal(patientName({ firstName: 'Ahmed', lastName: 'Khan' }), 'Ahmed Khan');
  });

  it('survives a missing surname, which the schema allows', () => {
    // lastName is nullable; naive interpolation would render "Ahmed undefined".
    assert.equal(patientName({ firstName: 'Ahmed', lastName: null }), 'Ahmed');
    assert.equal(patientName({ firstName: 'Ahmed' }), 'Ahmed');
    assert.equal(patientName({ firstName: 'Ahmed', lastName: '' }), 'Ahmed');
  });

  it('builds a label with the MRN for pickers', () => {
    assert.equal(
      patientLabel({ firstName: 'Ahmed', lastName: 'Khan', mrn: 'MAIN-000123' }),
      'Ahmed Khan (MAIN-000123)'
    );
    assert.equal(
      patientLabel({ firstName: 'Ahmed', lastName: null, mrn: 'MAIN-000123' }),
      'Ahmed (MAIN-000123)'
    );
  });
});

describe('isDuplicateKeyError', () => {
  it('recognises the MySQL duplicate-key errno, which is how an MRN race surfaces', () => {
    assert.equal(isDuplicateKeyError({ errno: 1062 }), true);
    assert.equal(isDuplicateKeyError({ errno: 1064 }), false);
    assert.equal(isDuplicateKeyError(new Error('boom')), false);
    assert.equal(isDuplicateKeyError(null), false);
    assert.equal(isDuplicateKeyError(undefined), false);
  });
});
