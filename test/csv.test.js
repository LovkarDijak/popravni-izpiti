import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, toCsv } from '../src/csv.js';

test('navadne vrednosti in šumniki ostanejo, kot so', () => {
  assert.equal(csvField('Čeh Žiga'), 'Čeh Žiga');
  assert.equal(csvField(3), '3');
  assert.equal(csvField(null), '');
});

test('podpičja, narekovaji in prelomi vrstic so v narekovajih', () => {
  assert.equal(csvField('a;b'), '"a;b"');
  assert.equal(csvField('rekel je "da"'), '"rekel je ""da"""');
  assert.equal(csvField('vrstica\nnova'), '"vrstica\nnova"');
});

test('vrednosti, ki bi jih Excel pognal kot formulo, dobijo predpono', () => {
  assert.equal(csvField('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvField('+386'), "'+386");
  assert.equal(csvField('-1'), "'-1");
  assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvField('\tx'), "'\tx");
  assert.equal(csvField('\rx'), `"'\rx"`);
  assert.equal(csvField('2. a'), '2. a');
});

test('toCsv začne z BOM, loči s podpičjem in konča vrstice s CRLF', () => {
  const out = toCsv([{ a: 'Ana', b: 'Čeh' }], [
    { header: 'Ime', value: (r) => r.a },
    { header: 'Priimek', value: (r) => r.b },
  ]);
  assert.equal(out, '\uFEFFIme;Priimek\r\nAna;Čeh\r\n');
  assert.equal(toCsv([], [{ header: 'Ime', value: () => '' }]), '\uFEFFIme\r\n');
});
