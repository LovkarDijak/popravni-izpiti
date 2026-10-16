// Tables for subjects, exam dates and registrations. Dates are ISO strings (YYYY-MM-DD),
// timestamps ISO strings in UTC, e-mail addresses stored trimmed and in lower case.
// Length limits match MAX_LENGTH in index.js.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS subjects (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('popravni', 'matura')),
  UNIQUE (name, kind)
);

CREATE TABLE IF NOT EXISTS exam_dates (
  id          INTEGER PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES subjects (id),
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  UNIQUE (subject_id, date)
);

CREATE TABLE IF NOT EXISTS registrations (
  id           INTEGER PRIMARY KEY,
  exam_date_id INTEGER NOT NULL REFERENCES exam_dates (id),
  first_name   TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
  last_name    TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 100),
  class_name   TEXT NOT NULL CHECK (length(class_name) BETWEEN 1 AND 20),
  email        TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  created_at   TEXT NOT NULL,
  UNIQUE (exam_date_id, email)
);
`;
