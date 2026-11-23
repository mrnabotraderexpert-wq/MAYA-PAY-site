import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayment, encodePayment, decodePayment, buildLink, parseHash, normalizeNumber } from '../js/link.js';
import { buildTransferCode, toTelUri, displayCode } from '../js/ussd.js';

test('numéro : indicatif et séparateurs retirés', () => {
  assert.equal(normalizeNumber('+223 76 12 34 56'), '76123456');
  assert.equal(normalizeNumber('00223 76123456'), '76123456');
  assert.equal(normalizeNumber('76 12 34 56'), '76123456');
});

test('validation : champs invalides', () => {
  const r = validatePayment({ n: '', p: '123', a: '0', d: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['a', 'n', 'p']);
});

test('lien : aller-retour avec accents et rejet des liens altérés', () => {
  const v = validatePayment({ n: 'Boutique Téou', p: '76123456', a: '15 000', d: 'Sac de riz – 50 kg' }).value;
  assert.equal(v.a, 15000);
  const link = buildLink(v, 'https://x.github.io/om-direct/');
  const { path, params } = parseHash(new URL(link).hash);
  assert.equal(path, '/pay');
  assert.deepEqual(decodePayment(params.get('d')), v);
  assert.equal(decodePayment(params.get('d').slice(0, -6) + 'AAAAAA'), null);
  assert.equal(decodePayment('***'), null);
  assert.equal(decodePayment(encodePayment({ n: 'x', p: '1', a: 5, d: '' })), null);
});

test('USSD : code construit, # encodé, valeurs non numériques refusées', () => {
  const code = buildTransferCode({ number: '76123456', amount: 15000, cauu: '123456' });
  assert.equal(code, '#144#11*76123456*15000*1*123456*76123456#');
  assert.equal(toTelUri(code), 'tel:%23144%2311*76123456*15000*1*123456*76123456%23');
  assert.equal(displayCode({ number: '76123456', amount: 15000, cauu: '123456' }), '#144#11*76\u2022\u2022\u2022\u202256*15000*1*\u2022\u2022\u2022\u2022\u2022\u2022*76\u2022\u2022\u2022\u202256#');
  assert.throws(() => buildTransferCode({ number: '7612*3456', amount: 1, cauu: '123456' }));
  assert.throws(() => buildTransferCode({ number: '76123456', amount: 1, cauu: '12' }));
});

test('durée de validité : option invalide refusée, lien expiré rejeté', () => {
  assert.equal(validatePayment({ n: 'A', p: '76123456', a: '100', d: '', h: '5' }).errors.h !== undefined, true);
  const ok = validatePayment({ n: 'A', p: '76123456', a: '100', d: '', h: '24' });
  assert.equal(ok.ok, true);
  assert.notEqual(decodePayment(new URL(buildLink(ok.value, 'https://x.org/')).hash.split('d=')[1]), null);
  const expired = encodePayment({ ...ok.value, e: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(decodePayment(expired), null);
});
