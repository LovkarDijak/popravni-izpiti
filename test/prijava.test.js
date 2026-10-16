import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { todayInLjubljana } from '../src/routes/prijava.js';

// 2027-08-21 at 23:30 UTC is already 22 August in Ljubljana.
const NOW = new Date('2027-08-21T23:30:00Z');

function setup() {
  const store = openDb(':memory:', { now: () => NOW });
  const math = store.createSubject({ name: 'Matematika', kind: 'popravni' });
  const english = store.createSubject({ name: 'Angleščina', kind: 'matura' });
  const open = store.createExamDate({ subjectId: math.id, date: '2027-08-27', description: 'Pisni del' });
  const matura = store.createExamDate({ subjectId: english.id, date: '2027-08-26' });
  const today = store.createExamDate({ subjectId: math.id, date: '2027-08-22' });
  const past = store.createExamDate({ subjectId: math.id, date: '2027-08-20' });
  const app = createApp({ store, now: () => NOW });
  return { store, app, open, matura, today, past };
}

const student = {
  firstName: 'Ana', lastName: 'Testna', className: '2. a', email: 'ana.testna@example.com',
};

function post(app, fields) {
  return request(app).post('/prijava').type('form').send(fields);
}

test('današnji datum se računa po ljubljanskem času', () => {
  assert.equal(todayInLjubljana(NOW), '2027-08-22');
});

test('obrazec ponudi samo roke po današnjem dnevu, ločeno za popravne izpite in maturo', async () => {
  const { app, open, matura, today, past } = setup();
  const res = await request(app).get('/prijava');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /<html lang="sl">/);
  assert.match(res.text, new RegExp(`<option value="${open.id}">Matematika, petek, 27\\. 8\\. 2027 \\(Pisni del\\)</option>`));
  assert.match(res.text, new RegExp(`<option value="${matura.id}">Angleščina \\(matura\\), četrtek, 26\\. 8\\. 2027</option>`));
  assert.match(res.text, /Vsa polja so obvezna\./);
  assert.doesNotMatch(res.text, /aria-invalid/);
  assert.match(res.text, /<optgroup label="Popravni izpit">/);
  assert.match(res.text, /<optgroup label="Popravni izpit mature">/);
  assert.doesNotMatch(res.text, new RegExp(`value="${today.id}"`));
  assert.doesNotMatch(res.text, new RegExp(`value="${past.id}"`));
  for (const name of ['firstName', 'lastName', 'className', 'email']) {
    assert.match(res.text, new RegExp(`<label for="${name}">`));
  }
});

test('brez razpisanih rokov obrazec to pove', async () => {
  const store = openDb(':memory:');
  const res = await request(createApp({ store, now: () => NOW })).get('/prijava');
  assert.match(res.text, /Trenutno ni razpisanih izpitnih rokov/);
  assert.doesNotMatch(res.text, /<form/);
});

test('korenska stran preusmeri na prijavo', async () => {
  const { app } = setup();
  const res = await request(app).get('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/prijava');
});

test('uspešna prijava se shrani in pokaže potrditev', async () => {
  const { app, store, open } = setup();
  const res = await post(app, { ...student, examDateId: String(open.id) });
  assert.equal(res.status, 200);
  assert.match(res.text, /Prijava je oddana/);
  assert.match(res.text, /Tvoja prijava je zabeležena/);
  assert.match(res.text, /Popravni izpit: Matematika/);
  assert.match(res.text, /petek, 27\. 8\. 2027/);
  assert.match(res.text, /<dt>Opis<\/dt><dd>Pisni del<\/dd>/);
  const saved = store.listRegistrations();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, 'ana.testna@example.com');
  assert.equal(saved[0].examDateId, open.id);
});

test('prazen obrazec pokaže vse napake hkrati, vsako pri svojem polju', async () => {
  const { app, store } = setup();
  const res = await post(app, {});
  assert.equal(res.status, 400);
  assert.match(res.text, /<title>Napaka: Prijava na popravni izpit/);
  assert.match(res.text, /id="napake" tabindex="-1" autofocus/);
  const expected = {
    examDateId: 'Izberi predmet in rok.',
    firstName: 'Vpiši ime.',
    lastName: 'Vpiši priimek.',
    className: 'Vpiši razred, na primer 2. a.',
    email: 'Vpiši e-poštni naslov.',
  };
  for (const [name, message] of Object.entries(expected)) {
    assert.ok(res.text.includes(`<li><a href="#${name}">${message}</a></li>`), name);
    assert.ok(res.text.includes(`<p id="${name}-napaka" class="napaka-polje">${message}</p>`), name);
    assert.match(res.text, new RegExp(`id="${name}"[^>]*aria-invalid="true" aria-describedby="${name}-napaka"`), name);
  }
  assert.equal(store.listRegistrations().length, 0);
});

test('manjkajoče polje ohrani ostali vnos in označi samo napačno polje', async () => {
  const { app, store, open } = setup();
  const res = await post(app, { ...student, examDateId: String(open.id), email: '' });
  assert.equal(res.status, 400);
  assert.match(res.text, /value="Testna"/);
  assert.match(res.text, new RegExp(`<option value="${open.id}" selected>`));
  assert.match(res.text, /id="email"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(res.text, /id="lastName"[^>]*aria-invalid/);
  assert.equal(store.listRegistrations().length, 0);
});

test('neveljavna, predolga ali s kontrolnimi znaki pokvarjena polja so zavrnjena', async () => {
  const { app, store, open } = setup();
  const cases = [
    [{ email: 'ana@' }, 'E-poštni naslov ni pravilen. Vpiši ga v obliki ime.priimek@primer.si.'],
    [{ firstName: 'x'.repeat(101) }, 'Ime je predolgo (največ 100 znakov).'],
    [{ lastName: 'Te\u0000stna' }, 'Priimek vsebuje znake, ki niso dovoljeni. Vpiši ga znova.'],
  ];
  for (const [change, message] of cases) {
    const res = await post(app, { ...student, examDateId: String(open.id), ...change });
    assert.equal(res.status, 400, message);
    assert.ok(res.text.includes(message), message);
  }
  assert.equal(store.listRegistrations().length, 0);
});

test('neobstoječ, današnji, pretekel ali nesmiseln rok je zavrnjen', async () => {
  const { app, store, today, past } = setup();
  for (const examDateId of ['999', String(today.id), String(past.id), 'abc', '1 OR 1=1']) {
    const res = await post(app, { ...student, examDateId });
    assert.equal(res.status, 400, examDateId);
    assert.match(res.text, /Izbrani rok ni več na voljo\. Izberi drug rok\./);
  }
  assert.equal(store.listRegistrations().length, 0);
});

test('druga prijava na isti rok je zavrnjena s prijaznim sporočilom', async () => {
  const { app, store, open } = setup();
  await post(app, { ...student, examDateId: String(open.id) });
  const res = await post(app, { ...student, examDateId: String(open.id), email: 'ANA.TESTNA@example.com' });
  assert.equal(res.status, 409);
  assert.match(res.text, /Prijava na ta rok že obstaja\. Ponovna prijava ni potrebna\./);
  assert.equal(store.listRegistrations().length, 1);
});

test('vnos se na strani vedno ubeži', async () => {
  const { app, open } = setup();
  const evil = '<script>alert(1)</script>';
  const failed = await post(app, { ...student, examDateId: String(open.id), lastName: evil, email: '' });
  assert.doesNotMatch(failed.text, /<script>/);
  assert.match(failed.text, /&lt;script&gt;/);
  const saved = await post(app, { ...student, examDateId: String(open.id), lastName: evil });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(saved.text, /<script>/);
});

test('ponovljena polja ali preobsežen obrazec ne podreta strežnika', async () => {
  const { app, store, open } = setup();
  const repeated = await request(app).post('/prijava').type('form')
    .send(`examDateId=${open.id}&firstName=Ana&firstName=Bor&lastName=Testna&className=2.a&email=ana@example.com`);
  assert.equal(repeated.status, 400);
  const huge = await post(app, { ...student, examDateId: String(open.id), firstName: 'x'.repeat(20000) });
  assert.equal(huge.status, 413);
  assert.equal(store.listRegistrations().length, 0);
});

test('nepričakovana napaka ne izda podrobnosti', async () => {
  const store = openDb(':memory:');
  const app = createApp({ store, now: () => NOW });
  store.close();
  const res = await request(app).get('/prijava');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /<html lang="sl">/);
  assert.match(res.text, /Prišlo je do napake na strežniku\. Poskusi znova pozneje\./);
  assert.doesNotMatch(res.text, /database|Error|at /);
});

test('slog obrazca se naloži', async () => {
  const { app } = setup();
  const res = await request(app).get('/prijava.css');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/css/);
});

test('neberljiv obrazec vrne napako odjemalca in ne zapiše podatkov v dnevnik', async (t) => {
  const { app, store, open } = setup();
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  const fields = Array.from({ length: 1001 }, (_, i) => `f${i}=x`).join('&');
  const tooMany = await request(app).post('/prijava').type('form')
    .send(`${fields}&examDateId=${open.id}&email=skrivna.ana@example.com`);
  assert.equal(tooMany.status, 413);
  const badCharset = await request(app).post('/prijava')
    .set('Content-Type', 'application/x-www-form-urlencoded; charset=koi8-r')
    .send('firstName=Ana');
  assert.equal(badCharset.status, 415);
  assert.match(badCharset.text, /Poslanih podatkov ni bilo mogoče prebrati\./);
  assert.equal(logged.length, 0);
  assert.equal(store.listRegistrations().length, 0);
});

test('strani pošljejo varnostne glave, odgovor na prijavo se ne shrani v predpomnilnik', async () => {
  const { app, open } = setup();
  const page = await request(app).get('/prijava');
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  const done = await post(app, { ...student, examDateId: String(open.id) });
  assert.equal(done.headers['cache-control'], 'no-store');
});

test('narekovaji v vnosu ne prebijejo atributa', async () => {
  const { app, open } = setup();
  const res = await post(app, {
    ...student, examDateId: String(open.id), firstName: '"><b>x</b>', lastName: "' onfocus='alert(1)", email: '',
  });
  assert.match(res.text, /value="&quot;&gt;&lt;b&gt;x&lt;\/b&gt;"/);
  assert.match(res.text, /value="&#39; onfocus=&#39;alert\(1\)"/);
});

test('imena predmetov in opisi rokov iz baze se ubežijo', async () => {
  const store = openDb(':memory:');
  const subject = store.createSubject({ name: '<i>Kemija</i>', kind: 'popravni' });
  const exam = store.createExamDate({ subjectId: subject.id, date: '2027-08-30', description: '<b>soba 3</b>' });
  const app = createApp({ store, now: () => NOW });
  const form = await request(app).get('/prijava');
  assert.doesNotMatch(form.text, /<i>Kemija|<b>soba/);
  assert.match(form.text, /&lt;i&gt;Kemija&lt;\/i&gt;/);
  const done = await post(app, { ...student, examDateId: String(exam.id) });
  assert.doesNotMatch(done.text, /<i>Kemija|<b>soba/);
});
