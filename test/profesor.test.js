import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { countRegistrations } from '../src/routes/profesor.js';

const NOW = new Date('2027-07-01T08:00:00Z');
const PASSWORD = 'testno-geslo-ni-pravo';

function setup({ teacherPassword = PASSWORD } = {}) {
  const store = openDb(':memory:', { now: () => NOW });
  const math = store.createSubject({ name: 'Matematika', kind: 'popravni' });
  const english = store.createSubject({ name: 'Angleščina', kind: 'matura' });
  const mathDate = store.createExamDate({ subjectId: math.id, date: '2027-08-20' });
  const englishDate = store.createExamDate({ subjectId: english.id, date: '2027-08-26' });
  const add = (examDateId, firstName, lastName, extra = {}) => store.createRegistration({
    examDateId, firstName, lastName, className: '2. a',
    email: `${firstName}.${lastName}@example.com`.toLowerCase().replace(/[čšž]/g, 'x'), ...extra,
  });
  add(mathDate.id, 'Ana', 'Zupan');
  add(mathDate.id, 'Bor', 'Čeh');
  add(englishDate.id, 'Eva', 'Cerar');
  const app = createApp({ store, now: () => NOW, teacherPassword });
  return { app, store, add, math, english, mathDate, englishDate };
}

const auth = (r) => r.auth('profesor', PASSWORD);

test('brez gesla ali z napačnim geslom ni dostopa', async () => {
  const { app } = setup();
  for (const path of ['/profesor', '/profesor/prijave.csv']) {
    const none = await request(app).get(path);
    assert.equal(none.status, 401, path);
    assert.match(none.headers['www-authenticate'], /^Basic realm=/);
    assert.doesNotMatch(none.text, /Zupan/);
    const wrong = await request(app).get(path).auth('profesor', 'napacno');
    assert.equal(wrong.status, 401, path);
    const garbage = await request(app).get(path).set('Authorization', 'Basic ###');
    assert.equal(garbage.status, 401, path);
  }
});

test('brez nastavljenega gesla ali z geslom iz samih presledkov je pregled zaprt za vse', async () => {
  for (const teacherPassword of ['', '   ']) {
    const { app } = setup({ teacherPassword });
    for (const path of ['/profesor', '/profesor/prijave.csv']) {
      const res = await request(app).get(path).auth('profesor', teacherPassword);
      assert.equal(res.status, 503, path);
      assert.doesNotMatch(res.text, /Zupan|TEACHER_PASSWORD/);
    }
  }
});

test('uporabniško ime je poljubno, geslo z dvopičjem deluje, shema ni občutljiva na velike črke', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/profesor').auth('', PASSWORD)).status, 200);
  assert.equal((await request(app).get('/profesor').auth('kdorkoli', PASSWORD)).status, 200);
  const lower = Buffer.from(`x:${PASSWORD}`).toString('base64');
  assert.equal((await request(app).get('/profesor').set('Authorization', `basic ${lower}`)).status, 200);
  const withColon = setup({ teacherPassword: 'a:b:c' });
  assert.equal((await request(withColon.app).get('/profesor').auth('x', 'a:b:c')).status, 200);
});

test('seznam pokaže vse prijave, urejene po priimku po slovenski abecedi', async () => {
  const { app } = setup();
  const res = await auth(request(app).get('/profesor'));
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.text, /3 prijave/);
  const order = ['Cerar', 'Čeh', 'Zupan'].map((name) => res.text.indexOf(`<td>${name}</td>`));
  assert.ok(order.every((i) => i > 0), 'vsi priimki so v tabeli');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('filtra po predmetu in roku omejita seznam', async () => {
  const { app, math, englishDate } = setup();
  const bySubject = await auth(request(app).get(`/profesor?subjectId=${math.id}`));
  assert.match(bySubject.text, /2 prijavi/);
  assert.doesNotMatch(bySubject.text, /<td>Cerar<\/td>/);
  assert.match(bySubject.text, new RegExp(`<option value="${math.id}" selected>`));
  const byDate = await auth(request(app).get(`/profesor?examDateId=${englishDate.id}`));
  assert.match(byDate.text, /1 prijava/);
  assert.match(byDate.text, /<td>Cerar<\/td>/);
  assert.match(byDate.text, new RegExp(`href="/profesor/prijave.csv\\?examDateId=${englishDate.id}"`));
  const none = await auth(request(app).get(`/profesor?subjectId=${math.id}&examDateId=${englishDate.id}`));
  assert.match(none.text, /Za izbrani filter ni prijav\./);
});

test('neveljaven filter vrne 400', async () => {
  const { app } = setup();
  for (const query of ['subjectId=abc', 'examDateId=0', 'subjectId=1&subjectId=2', 'examDateId=1%20OR%201',
    'subjectId=9999999999999999', 'examDateId=9007199254740993']) {
    const res = await auth(request(app).get(`/profesor?${query}`));
    assert.equal(res.status, 400, query);
  }
});

test('CSV ima BOM, glavo, podpičja, šumnike in isti filter kot seznam', async () => {
  const { app, math } = setup();
  const res = await auth(request(app).get(`/profesor/prijave.csv?subjectId=${math.id}`).buffer(true)
    .parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => { d += c; }); r.on('end', () => cb(null, d)); }));
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
  assert.match(res.headers['content-disposition'], /attachment; filename="prijave-2027-07-01\.csv"/);
  const lines = res.body.split('\r\n');
  assert.equal(lines[0], '\uFEFFPriimek;Ime;Razred;E-pošta;Predmet;Vrsta;Rok;Čas prijave');
  assert.equal(lines[1], 'Čeh;Bor;2. a;bor.xeh@example.com;Matematika;popravni izpit;2027-08-20;1. 7. 2027, 10:00');
  assert.match(lines[2], /^Zupan;Ana;/);
  assert.equal(lines[3], '');
  assert.equal(lines.length, 4);
});

test('CSV ubeži podpičja in prepreči formule iz vnosa dijakov', async () => {
  const { app, add, mathDate } = setup();
  add(mathDate.id, '=HYPERLINK("x")', 'Napadalec;ka', { email: 'napad@example.com' });
  const res = await auth(request(app).get(`/profesor/prijave.csv?examDateId=${mathDate.id}`).buffer(true)
    .parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => { d += c; }); r.on('end', () => cb(null, d)); }));
  const line = res.body.split('\r\n').find((l) => l.includes('Napadalec'));
  assert.ok(line.startsWith(`"Napadalec;ka";"'=HYPERLINK(""x"")";`), line);
});

test('vnos dijakov je na strani profesorja ubežan', async () => {
  const { app, add, mathDate } = setup();
  add(mathDate.id, '<script>alert(1)</script>', 'Testna', { email: 'xss@example.com' });
  const res = await auth(request(app).get('/profesor'));
  assert.doesNotMatch(res.text, /<script>alert/);
  assert.match(res.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('število prijav je v pravilni slovenski obliki', () => {
  const forms = [0, 1, 2, 3, 4, 5, 11, 101, 102, 103, 111].map(countRegistrations);
  assert.deepEqual(forms, [
    '0 prijav', '1 prijava', '2 prijavi', '3 prijave', '4 prijave', '5 prijav',
    '11 prijav', '101 prijava', '102 prijavi', '103 prijave', '111 prijav',
  ]);
});
