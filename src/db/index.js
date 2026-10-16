import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

export const SUBJECT_KINDS = ['popravni', 'matura'];

// SQLite extended result codes we turn into readable errors.
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

// code: 'INVALID' (bad input), 'DUPLICATE' (already exists) or 'NOT_FOUND' (unknown id).
// For bad input, field names the input and reason says what is wrong with it:
// 'missing', 'tooLong', 'badChars' or 'format', so a form can word its own message.
export class DataError extends Error {
  constructor(code, message, { field = null, reason = null } = {}) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.field = field;
    this.reason = reason;
  }
}

// Longest accepted value per field; the schema enforces the same limits.
export const MAX_LENGTH = {
  subjectName: 100, description: 500, firstName: 100, lastName: 100, className: 20, email: 254,
};

// No backtracking blow-up: dots split the domain into parts that cannot overlap.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
// Control characters and the Unicode direction overrides that can disguise text.
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const collator = new Intl.Collator('sl');

// Trimmed, NFC-normalized text without control characters and at most max characters long.
// Messages never repeat the input, so they are safe to show as they are.
function text(value, label, max, { required = true, field = null } = {}) {
  const fail = (reason, message) => new DataError('INVALID', message, { field, reason });
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw fail('format', `Neveljaven podatek: ${label}.`);
  const result = value.normalize('NFC').trim();
  if (required && !result) throw fail('missing', `Manjka ${label}.`);
  if (result.length > max) throw fail('tooLong', `Predolg podatek: ${label} (največ ${max} znakov).`);
  if (FORBIDDEN_CHARS.test(result)) throw fail('badChars', `Neveljavni znaki: ${label}.`);
  return result;
}

const REGISTRATION_FIELDS = [
  ['firstName', 'ime'],
  ['lastName', 'priimek'],
  ['className', 'razred'],
  ['email', 'e-pošta'],
];

// Checks every field of a registration without touching the database.
// Returns the cleaned values and one DataError per bad field, so a form can show all problems at once.
export function checkRegistration(input = {}) {
  const values = {};
  const errors = {};
  for (const [field, label] of REGISTRATION_FIELDS) {
    try {
      values[field] = text(input[field], label, MAX_LENGTH[field], { field });
    } catch (err) {
      errors[field] = err;
    }
  }
  if (!errors.email) {
    values.email = values.email.toLowerCase();
    if (!EMAIL_RE.test(values.email)) {
      errors.email = new DataError('INVALID', 'Neveljaven e-poštni naslov.', { field: 'email', reason: 'format' });
    }
  }
  return { values, errors };
}

function isoDate(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== result) {
    throw new DataError('INVALID', 'Neveljaven datum (pričakujem LLLL-MM-DD).');
  }
  return result;
}

// Positive whole numbers only, as a number or as a string of digits (form and URL values).
function id(value, label) {
  const ok = (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    || (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value));
  if (!ok) throw new DataError('INVALID', `Neveljaven ${label}.`);
  return Number(value);
}

// Runs a write and maps SQLite constraint errors to DataError.
function write(stmt, params, messages) {
  try {
    return stmt.run(params);
  } catch (err) {
    if (err.errcode === SQLITE_CONSTRAINT_UNIQUE && messages.duplicate) {
      throw new DataError('DUPLICATE', messages.duplicate);
    }
    if (err.errcode === SQLITE_CONSTRAINT_FOREIGNKEY && messages.notFound) {
      throw new DataError('NOT_FOUND', messages.notFound);
    }
    throw err;
  }
}

const REGISTRATION_SELECT = `
  SELECT r.id, r.exam_date_id AS examDateId, r.first_name AS firstName, r.last_name AS lastName,
         r.class_name AS className, r.email, r.created_at AS createdAt,
         e.date AS examDate, e.description AS examDescription, e.subject_id AS subjectId,
         s.name AS subjectName, s.kind AS subjectKind
  FROM registrations r
  JOIN exam_dates e ON e.id = r.exam_date_id
  JOIN subjects s ON s.id = e.subject_id`;

// Opens (and if needed creates) the database. filename ':memory:' gives a throwaway database for tests.
// now() is the clock used for registration timestamps.
export function openDb(filename = ':memory:', { now = () => new Date() } = {}) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const q = {
    insertSubject: db.prepare('INSERT INTO subjects (name, kind) VALUES (:name, :kind)'),
    getSubject: db.prepare('SELECT id, name, kind FROM subjects WHERE id = ?'),
    listSubjects: db.prepare('SELECT id, name, kind FROM subjects'),
    insertExamDate: db.prepare(
      'INSERT INTO exam_dates (subject_id, date, description) VALUES (:subjectId, :date, :description)',
    ),
    getExamDate: db.prepare(`
      SELECT e.id, e.subject_id AS subjectId, e.date, e.description, s.name AS subjectName, s.kind AS subjectKind
      FROM exam_dates e JOIN subjects s ON s.id = e.subject_id WHERE e.id = ?`),
    listExamDates: db.prepare(`
      SELECT e.id, e.subject_id AS subjectId, e.date, e.description, s.name AS subjectName, s.kind AS subjectKind
      FROM exam_dates e JOIN subjects s ON s.id = e.subject_id
      WHERE (:subjectId IS NULL OR e.subject_id = :subjectId)`),
    insertRegistration: db.prepare(`
      INSERT INTO registrations (exam_date_id, first_name, last_name, class_name, email, created_at)
      VALUES (:examDateId, :firstName, :lastName, :className, :email, :createdAt)`),
    getRegistration: db.prepare(`${REGISTRATION_SELECT} WHERE r.id = ?`),
    listRegistrations: db.prepare(`${REGISTRATION_SELECT}
      WHERE (:examDateId IS NULL OR r.exam_date_id = :examDateId)
        AND (:subjectId IS NULL OR e.subject_id = :subjectId)`),
  };

  const plain = (row) => (row ? { ...row } : null);

  return {
    db,

    close() {
      db.close();
    },

    createSubject({ name, kind }) {
      if (!SUBJECT_KINDS.includes(kind)) {
        throw new DataError('INVALID', 'Neveljavna vrsta izpita (popravni ali matura).');
      }
      const params = { name: text(name, 'ime predmeta', MAX_LENGTH.subjectName), kind };
      // UNIQUE in SQLite only folds ASCII case, so compare names here (Šport and šport are the same subject).
      const key = params.name.toLocaleLowerCase('sl');
      if (q.listSubjects.all().some((s) => s.kind === kind && s.name.toLocaleLowerCase('sl') === key)) {
        throw new DataError('DUPLICATE', `Predmet ${params.name} (${kind}) že obstaja.`);
      }
      const { lastInsertRowid } = write(q.insertSubject, params, {
        duplicate: `Predmet ${params.name} (${kind}) že obstaja.`,
      });
      return plain(q.getSubject.get(lastInsertRowid));
    },

    getSubject(subjectId) {
      return plain(q.getSubject.get(id(subjectId, 'predmet')));
    },

    listSubjects() {
      return q.listSubjects.all().map(plain)
        .sort((a, b) => collator.compare(a.name, b.name) || a.kind.localeCompare(b.kind));
    },

    createExamDate({ subjectId, date, description = '' }) {
      const params = {
        subjectId: id(subjectId, 'predmet'),
        date: isoDate(date),
        description: text(description, 'opis', MAX_LENGTH.description, { required: false }),
      };
      const { lastInsertRowid } = write(q.insertExamDate, params, {
        duplicate: `Rok ${params.date} za ta predmet že obstaja.`,
        notFound: 'Predmet ne obstaja.',
      });
      return plain(q.getExamDate.get(lastInsertRowid));
    },

    getExamDate(examDateId) {
      return plain(q.getExamDate.get(id(examDateId, 'rok')));
    },

    listExamDates({ subjectId = null } = {}) {
      return q.listExamDates.all({ subjectId: subjectId === null ? null : id(subjectId, 'predmet') }).map(plain)
        .sort((a, b) => a.date.localeCompare(b.date) || collator.compare(a.subjectName, b.subjectName));
    },

    createRegistration({ examDateId, ...fields }) {
      const { values, errors } = checkRegistration(fields);
      const firstError = Object.values(errors)[0];
      if (firstError) throw firstError;
      const params = { ...values, examDateId: id(examDateId, 'rok'), createdAt: now().toISOString() };
      const { lastInsertRowid } = write(q.insertRegistration, params, {
        duplicate: 'Prijava na ta rok že obstaja.',
        notFound: 'Izpitni rok ne obstaja.',
      });
      return plain(q.getRegistration.get(lastInsertRowid));
    },

    // Registrations sorted by surname and name (Slovenian alphabet), optionally for one exam date or subject.
    listRegistrations({ examDateId = null, subjectId = null } = {}) {
      return q.listRegistrations.all({
        examDateId: examDateId === null ? null : id(examDateId, 'rok'),
        subjectId: subjectId === null ? null : id(subjectId, 'predmet'),
      }).map(plain).sort((a, b) => collator.compare(a.lastName, b.lastName)
        || collator.compare(a.firstName, b.firstName)
        || a.examDate.localeCompare(b.examDate));
    },
  };
}
