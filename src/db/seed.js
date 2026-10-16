import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './index.js';

// Made-up data for development and tests. Never put real students here: the repo is public.
// E-mail addresses use example.com, a domain reserved for examples.
export const SEED = {
  subjects: [
    { name: 'Matematika', kind: 'popravni' },
    { name: 'Slovenščina', kind: 'popravni' },
    { name: 'Fizika', kind: 'popravni' },
    { name: 'Matematika', kind: 'matura' },
    { name: 'Angleščina', kind: 'matura' },
  ],
  examDates: [
    { subject: ['Matematika', 'popravni'], date: '2027-08-20', description: 'Pisni del, učilnica 12' },
    { subject: ['Matematika', 'popravni'], date: '2027-08-27', description: 'Ustni del' },
    { subject: ['Slovenščina', 'popravni'], date: '2027-08-21', description: 'Pisni in ustni del' },
    { subject: ['Fizika', 'popravni'], date: '2027-08-23', description: '' },
    { subject: ['Matematika', 'matura'], date: '2027-08-25', description: 'Jesenski rok mature' },
    { subject: ['Angleščina', 'matura'], date: '2027-08-26', description: 'Jesenski rok mature' },
  ],
  registrations: [
    { exam: ['Matematika', 'popravni', '2027-08-20'], firstName: 'Ana', lastName: 'Testna', className: '2. a', email: 'ana.testna@example.com' },
    { exam: ['Matematika', 'popravni', '2027-08-20'], firstName: 'Žan', lastName: 'Izmišljeni', className: '3. b', email: 'zan.izmisljeni@example.com' },
    { exam: ['Slovenščina', 'popravni', '2027-08-21'], firstName: 'Čarli', lastName: 'Primerek', className: '1. c', email: 'carli.primerek@example.com' },
    { exam: ['Matematika', 'matura', '2027-08-25'], firstName: 'Špela', lastName: 'Vzorčna', className: '4. a', email: 'spela.vzorcna@example.com' },
  ],
};

// Fills an empty database with SEED; a database that already has subjects is left as it is.
// Returns true when it seeded.
export function seed(store) {
  if (store.listSubjects().length > 0) return false;
  // All or nothing: a seed that fails halfway must not leave a database that looks seeded.
  store.db.exec('BEGIN');
  try {
    const subjectIds = new Map();
    for (const s of SEED.subjects) {
      subjectIds.set(`${s.name}|${s.kind}`, store.createSubject(s).id);
    }
    const examIds = new Map();
    for (const e of SEED.examDates) {
      const subjectId = subjectIds.get(e.subject.join('|'));
      examIds.set(`${e.subject.join('|')}|${e.date}`, store.createExamDate({ ...e, subjectId }).id);
    }
    for (const { exam, ...student } of SEED.registrations) {
      store.createRegistration({ ...student, examDateId: examIds.get(exam.join('|')) });
    }
    store.db.exec('COMMIT');
  } catch (err) {
    store.db.exec('ROLLBACK');
    throw err;
  }
  return true;
}

// npm run seed: fills the database at DB_PATH (default data/popravni-izpiti.sqlite, relative to the current folder).
// realpathSync: Node resolves symlinks in import.meta.url but not in argv[1].
function runAsScript() {
  try {
    return realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (runAsScript()) {
  try {
    process.loadEnvFile();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const path = process.env.DB_PATH || 'data/popravni-izpiti.sqlite';
  if (path === ':memory:') {
    console.error('DB_PATH mora biti datoteka, ne :memory:.');
    process.exit(1);
  }
  mkdirSync(dirname(path), { recursive: true });
  const store = openDb(path);
  const seeded = seed(store);
  store.close();
  console.log(seeded ? `Izmišljeni podatki so v ${path}.` : `${path} že vsebuje podatke, nič nisem spremenil.`);
}
