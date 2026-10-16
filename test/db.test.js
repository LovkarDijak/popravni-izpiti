import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, DataError, checkRegistration } from '../src/db/index.js';
import { seed, SEED } from '../src/db/seed.js';

const FIXED_NOW = new Date('2027-07-01T08:30:00Z');

function freshStore() {
  return openDb(':memory:', { now: () => FIXED_NOW });
}

function withExamDate() {
  const store = freshStore();
  const subject = store.createSubject({ name: 'Matematika', kind: 'popravni' });
  const examDate = store.createExamDate({ subjectId: subject.id, date: '2027-08-20', description: 'Pisni del' });
  return { store, subject, examDate };
}

const student = {
  firstName: 'Ana', lastName: 'Testna', className: '2. a', email: 'ana.testna@example.com',
};

function assertDataError(fn, code) {
  assert.throws(fn, (err) => err instanceof DataError && err.code === code);
}

test('predmet se ustvari in prebere', () => {
  const store = freshStore();
  const created = store.createSubject({ name: '  Fizika ', kind: 'matura' });
  assert.deepEqual(created, { id: created.id, name: 'Fizika', kind: 'matura' });
  assert.deepEqual(store.getSubject(created.id), created);
  assert.deepEqual(store.listSubjects(), [created]);
});

test('predmeti so urejeni po slovenski abecedi', () => {
  const store = freshStore();
  for (const name of ['Zgodovina', 'Šport', 'Slovenščina', 'Črtanje']) {
    store.createSubject({ name, kind: 'popravni' });
  }
  assert.deepEqual(store.listSubjects().map((s) => s.name), ['Črtanje', 'Slovenščina', 'Šport', 'Zgodovina']);
});

test('predmet brez imena, z neznano vrsto ali podvojen je zavrnjen', () => {
  const store = freshStore();
  assertDataError(() => store.createSubject({ name: '  ', kind: 'popravni' }), 'INVALID');
  assertDataError(() => store.createSubject({ name: 'Fizika', kind: 'izredni' }), 'INVALID');
  store.createSubject({ name: 'Fizika', kind: 'popravni' });
  assertDataError(() => store.createSubject({ name: 'Fizika', kind: 'popravni' }), 'DUPLICATE');
  // The same subject can exist for both kinds.
  assert.equal(store.createSubject({ name: 'Fizika', kind: 'matura' }).kind, 'matura');
});

test('izpitni rok se ustvari in prebere s predmetom', () => {
  const { store, subject, examDate } = withExamDate();
  assert.deepEqual(examDate, {
    id: examDate.id,
    subjectId: subject.id,
    date: '2027-08-20',
    description: 'Pisni del',
    subjectName: 'Matematika',
    subjectKind: 'popravni',
  });
  assert.deepEqual(store.getExamDate(examDate.id), examDate);
});

test('roki so urejeni po datumu in filtrirani po predmetu', () => {
  const { store, subject } = withExamDate();
  store.createExamDate({ subjectId: subject.id, date: '2027-08-18' });
  const other = store.createSubject({ name: 'Fizika', kind: 'popravni' });
  store.createExamDate({ subjectId: other.id, date: '2027-08-19' });

  assert.deepEqual(store.listExamDates().map((e) => e.date), ['2027-08-18', '2027-08-19', '2027-08-20']);
  assert.deepEqual(store.listExamDates({ subjectId: subject.id }).map((e) => e.date), ['2027-08-18', '2027-08-20']);
});

test('rok z neveljavnim datumom, neznanim predmetom ali podvojen je zavrnjen', () => {
  const { store, subject } = withExamDate();
  for (const date of ['20. 8. 2027', '2027-02-30', '2027-8-20', '']) {
    assertDataError(() => store.createExamDate({ subjectId: subject.id, date }), 'INVALID');
  }
  assertDataError(() => store.createExamDate({ subjectId: 999, date: '2027-08-21' }), 'NOT_FOUND');
  assertDataError(() => store.createExamDate({ subjectId: subject.id, date: '2027-08-20' }), 'DUPLICATE');
});

test('prijava se ustvari in prebere z rokom in predmetom', () => {
  const { store, subject, examDate } = withExamDate();
  const created = store.createRegistration({ ...student, examDateId: examDate.id, email: ' Ana.Testna@Example.com ' });
  assert.deepEqual(created, {
    id: created.id,
    examDateId: examDate.id,
    firstName: 'Ana',
    lastName: 'Testna',
    className: '2. a',
    email: 'ana.testna@example.com',
    createdAt: '2027-07-01T08:30:00.000Z',
    examDate: '2027-08-20',
    examDescription: 'Pisni del',
    subjectId: subject.id,
    subjectName: 'Matematika',
    subjectKind: 'popravni',
  });
  assert.deepEqual(store.listRegistrations(), [created]);
});

test('drugo prijavo istega dijaka na isti rok zavrne, tudi z drugače zapisano e-pošto', () => {
  const { store, examDate } = withExamDate();
  store.createRegistration({ ...student, examDateId: examDate.id });
  assertDataError(
    () => store.createRegistration({ ...student, examDateId: examDate.id, email: 'ANA.TESTNA@example.com' }),
    'DUPLICATE',
  );
  assert.equal(store.listRegistrations().length, 1);
});

test('isti dijak se lahko prijavi na drug rok', () => {
  const { store, subject, examDate } = withExamDate();
  const second = store.createExamDate({ subjectId: subject.id, date: '2027-08-27' });
  store.createRegistration({ ...student, examDateId: examDate.id });
  store.createRegistration({ ...student, examDateId: second.id });
  assert.equal(store.listRegistrations().length, 2);
});

test('prijava z manjkajočimi podatki, slabo e-pošto ali na neznan rok je zavrnjena', () => {
  const { store, examDate } = withExamDate();
  for (const field of ['firstName', 'lastName', 'className', 'email']) {
    assertDataError(() => store.createRegistration({ ...student, examDateId: examDate.id, [field]: ' ' }), 'INVALID');
  }
  assertDataError(() => store.createRegistration({ ...student, examDateId: examDate.id, email: 'ana@' }), 'INVALID');
  assertDataError(() => store.createRegistration({ ...student, examDateId: 'abc' }), 'INVALID');
  assertDataError(() => store.createRegistration({ ...student, examDateId: 999 }), 'NOT_FOUND');
  assert.equal(store.listRegistrations().length, 0);
});

test('prijave so urejene po priimku in filtrirane po roku ali predmetu', () => {
  const { store, subject, examDate } = withExamDate();
  const other = store.createSubject({ name: 'Fizika', kind: 'popravni' });
  const otherDate = store.createExamDate({ subjectId: other.id, date: '2027-08-23' });
  const add = (examDateId, firstName, lastName) => store.createRegistration({
    examDateId, firstName, lastName, className: '1. a', email: `${lastName}.${firstName}@example.com`.toLowerCase(),
  });
  add(examDate.id, 'Ana', 'Zupan');
  add(examDate.id, 'Bor', 'Čeh');
  add(otherDate.id, 'Eva', 'Cerar');

  assert.deepEqual(store.listRegistrations().map((r) => r.lastName), ['Cerar', 'Čeh', 'Zupan']);
  assert.deepEqual(store.listRegistrations({ examDateId: examDate.id }).map((r) => r.lastName), ['Čeh', 'Zupan']);
  assert.deepEqual(store.listRegistrations({ subjectId: other.id }).map((r) => r.lastName), ['Cerar']);
  assert.deepEqual(store.listRegistrations({ subjectId: subject.id, examDateId: otherDate.id }), []);
});

test('seme napolni prazno bazo z izmišljenimi podatki in se ne ponovi', () => {
  const store = freshStore();
  assert.equal(seed(store), true);
  assert.equal(store.listSubjects().length, SEED.subjects.length);
  assert.equal(store.listExamDates().length, SEED.examDates.length);
  assert.equal(store.listRegistrations().length, SEED.registrations.length);
  assert.equal(seed(store), false);
  assert.equal(store.listRegistrations().length, SEED.registrations.length);
});

test('seme uporablja samo naslove na rezerviranem primeru example.com', () => {
  for (const r of SEED.registrations) {
    assert.match(r.email, /@example\.com$/);
  }
});

test('predolga besedila so zavrnjena', () => {
  const { store, subject, examDate } = withExamDate();
  assertDataError(() => store.createSubject({ name: 'x'.repeat(101), kind: 'popravni' }), 'INVALID');
  assertDataError(
    () => store.createExamDate({ subjectId: subject.id, date: '2027-08-21', description: 'x'.repeat(501) }),
    'INVALID',
  );
  assertDataError(() => store.createRegistration({ ...student, examDateId: examDate.id, firstName: 'x'.repeat(101) }), 'INVALID');
  assertDataError(() => store.createRegistration({ ...student, examDateId: examDate.id, className: 'x'.repeat(21) }), 'INVALID');
  assertDataError(
    () => store.createRegistration({ ...student, examDateId: examDate.id, email: `${'a'.repeat(250)}@example.com` }),
    'INVALID',
  );
});

test('zelo dolg in zlonamerno sestavljen e-poštni naslov je zavrnjen takoj', () => {
  const { store, examDate } = withExamDate();
  const started = performance.now();
  assertDataError(
    () => store.createRegistration({ ...student, examDateId: examDate.id, email: `a@${'.'.repeat(100000)}@` }),
    'INVALID',
  );
  assert.ok(performance.now() - started < 100);
});

test('kontrolni znaki in znaki za obračanje smeri besedila so zavrnjeni', () => {
  const { store, examDate } = withExamDate();
  for (const bad of ['a\u0000one@example.com', 'ana\n@example.com']) {
    assertDataError(() => store.createRegistration({ ...student, examDateId: examDate.id, email: bad }), 'INVALID');
  }
  assertDataError(() => store.createRegistration({ ...student, examDateId: examDate.id, firstName: 'An‮a' }), 'INVALID');
  assertDataError(() => store.createSubject({ name: '\u0000x', kind: 'popravni' }), 'INVALID');
  assert.equal(store.listRegistrations().length, 0);
});

test('napačne vrste podatkov dajo berljivo napako, ne notranje', () => {
  const store = freshStore();
  assertDataError(() => store.createSubject({ name: 'Fizika', kind: { toString: 'x' } }), 'INVALID');
  assertDataError(() => store.createSubject({ name: ['Fizika'], kind: 'popravni' }), 'INVALID');
  const subject = store.createSubject({ name: 'Fizika', kind: 'popravni' });
  assertDataError(() => store.createExamDate({ subjectId: subject.id, date: { toString: 'x' } }), 'INVALID');
  for (const bad of [true, [1], '0x10', ' 7 ', 1.5, 0, -3]) {
    assertDataError(() => store.getSubject(bad), 'INVALID');
  }
  assert.equal(store.getSubject(String(subject.id)).id, subject.id);
});

test('sporočila o napakah ne ponovijo vnosa', () => {
  const { store, examDate } = withExamDate();
  const evil = '<img src=x onerror=alert(1)>';
  assert.throws(() => store.createExamDate({ subjectId: examDate.subjectId, date: evil }), (err) => !err.message.includes(evil));
  assert.throws(
    () => store.createRegistration({ ...student, examDateId: examDate.id, email: evil }),
    (err) => !err.message.includes(evil),
  );
});

test('neznan id vrne null', () => {
  const store = freshStore();
  assert.equal(store.getSubject(999), null);
  assert.equal(store.getExamDate(999), null);
});

test('isti predmet z drugače zapisanimi velikimi črkami je dvojnik', () => {
  const store = freshStore();
  store.createSubject({ name: 'Šport', kind: 'popravni' });
  assertDataError(() => store.createSubject({ name: 'šport', kind: 'popravni' }), 'DUPLICATE');
});

test('roki na isti dan so urejeni po slovenski abecedi predmetov', () => {
  const store = freshStore();
  for (const name of ['Zgodovina', 'Šport', 'Slovenščina']) {
    const subject = store.createSubject({ name, kind: 'popravni' });
    store.createExamDate({ subjectId: subject.id, date: '2027-08-20' });
  }
  assert.deepEqual(store.listExamDates().map((e) => e.subjectName), ['Slovenščina', 'Šport', 'Zgodovina']);
});

test('seme, ki se ustavi na pol, ne pusti ničesar v bazi', () => {
  const store = freshStore();
  const original = SEED.registrations[0].email;
  SEED.registrations[0].email = 'ni-naslov';
  try {
    assert.throws(() => seed(store), DataError);
  } finally {
    SEED.registrations[0].email = original;
  }
  assert.equal(store.listSubjects().length, 0);
  assert.equal(seed(store), true);
});

test('checkRegistration vrne vse napake hkrati, vsako z imenom polja in razlogom', () => {
  const { values, errors } = checkRegistration({
    firstName: ' Ana ', lastName: '', className: 'x'.repeat(21), email: 'ana@',
  });
  assert.equal(values.firstName, 'Ana');
  assert.deepEqual(
    Object.fromEntries(Object.entries(errors).map(([f, e]) => [f, [e.field, e.reason]])),
    { lastName: ['lastName', 'missing'], className: ['className', 'tooLong'], email: ['email', 'format'] },
  );
  assert.equal(checkRegistration({ ...student, firstName: 'A\u0000' }).errors.firstName.reason, 'badChars');
  assert.deepEqual(checkRegistration(student).errors, {});
});
