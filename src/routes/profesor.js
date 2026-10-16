import express from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { toCsv } from '../csv.js';
import { html, page } from '../html.js';
import { slovenianDate, todayInLjubljana } from './prijava.js';

const KIND_SHORT = { popravni: 'popravni izpit', matura: 'matura' };

// Slovenian has four plural forms: 1 prijava, 2 prijavi, 3 in 4 prijave, 5 prijav (101 like 1, 102 like 2 ...).
export function countRegistrations(n) {
  const rest = n % 100;
  if (rest === 1) return `${n} prijava`;
  if (rest === 2) return `${n} prijavi`;
  if (rest === 3 || rest === 4) return `${n} prijave`;
  return `${n} prijav`;
}

const timeFmt = new Intl.DateTimeFormat('sl', {
  timeZone: 'Europe/Ljubljana', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
// In the CSV: 2026-10-16 12:03, which spreadsheets read as a date and time (a comma would make it text).
const csvTimeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

// Compares hashes so neither the length nor the content of the password leaks through timing.
function samePassword(given, expected) {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// HTTP Basic authentication with one shared password; the user name is ignored.
// Without a password configured the pages stay closed.
function requirePassword(password) {
  return (req, res, next) => {
    if (!password.trim()) {
      return res.status(503).type('text').send('Pregled prijav za profesorje še ni vklopljen. Obvestite skrbnika strani.');
    }
    // The scheme name is case-insensitive (RFC 7235).
    const match = /^Basic\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (match) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (decoded.includes(':') && samePassword(given, password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Popravni izpiti - profesorji", charset="UTF-8"');
    return res.status(401).type('text')
      .send('Za ta pregled potrebujete geslo za profesorje. Če ga nimate, se obrnite na skrbnika strani.');
  };
}

// Reads the optional subjectId and examDateId filters; anything but a positive whole number is refused.
function readFilters(query) {
  const filters = {};
  for (const name of ['subjectId', 'examDateId']) {
    const value = query[name];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value)) return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id)) return null;
    filters[name] = id;
  }
  return filters;
}

function filterQuery(filters) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) params.set(name, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

const CSV_COLUMNS = [
  { header: 'Priimek', value: (r) => r.lastName },
  { header: 'Ime', value: (r) => r.firstName },
  { header: 'Razred', value: (r) => r.className },
  { header: 'E-pošta', value: (r) => r.email },
  { header: 'Predmet', value: (r) => r.subjectName },
  { header: 'Vrsta', value: (r) => KIND_SHORT[r.subjectKind] },
  { header: 'Rok', value: (r) => r.examDate },
  { header: 'Opis roka', value: (r) => r.examDescription },
  { header: 'Čas prijave', value: (r) => csvTimeFmt.format(new Date(r.createdAt)) },
];

function listPage({ subjects, examDates, registrations, filters }) {
  const option = (value, label, selected) => html`
      <option value="${value}"${selected ? html` selected` : ''}>${label}</option>`;
  const shownDates = filters.subjectId ? examDates.filter((e) => e.subjectId === filters.subjectId) : examDates;
  const dateLabel = (e) => `${slovenianDate(e.date)} – ${e.subjectName} (${KIND_SHORT[e.subjectKind]})`
    + (e.description ? `, ${e.description}` : '');

  return page({
    title: 'Prijave na izpite',
    styles: ['/profesor.css'],
    body: html`
<h1>Prijave na izpite</h1>
<form method="get" action="/profesor" class="filtri">
  <p>
    <label for="subjectId">Predmet</label>
    <select id="subjectId" name="subjectId">
      <option value="">Vsi predmeti</option>${subjects.map((s) => option(
    s.id, `${s.name} (${KIND_SHORT[s.kind]})`, s.id === filters.subjectId,
  ))}
    </select>
  </p>
  <p>
    <label for="examDateId">Rok</label>
    <select id="examDateId" name="examDateId">
      <option value="">Vsi roki</option>${shownDates.map((e) => option(
    e.id, dateLabel(e), e.id === filters.examDateId,
  ))}
    </select>
  </p>
  <p><button type="submit">Pokaži</button></p>
</form>
<p class="povzetek">
  <span>${countRegistrations(registrations.length)}</span>
  ${registrations.length > 0
    ? html`<a class="gumb" href="/profesor/prijave.csv${filterQuery(filters)}">Prenesi seznam za Excel (CSV)</a>` : ''}
</p>
${registrations.length === 0
    ? html`<p>Za izbrani predmet in rok še ni prijav.</p>`
    : html`<div class="tabela" tabindex="0" role="region" aria-labelledby="tabela-naslov">
<table>
  <caption id="tabela-naslov" class="skrito">Prijave, urejene po priimku</caption>
  <thead><tr>
    <th scope="col">Priimek</th><th scope="col">Ime</th><th scope="col">Razred</th><th scope="col">E-pošta</th>
    <th scope="col">Predmet</th><th scope="col">Rok</th><th scope="col">Čas prijave</th>
  </tr></thead>
  <tbody>${registrations.map((r) => html`
    <tr>
      <td>${r.lastName}</td><td>${r.firstName}</td><td>${r.className}</td><td>${r.email}</td>
      <td>${r.subjectName} (${KIND_SHORT[r.subjectKind]})</td>
      <td>${slovenianDate(r.examDate)}${r.examDescription ? html`<br><small>${r.examDescription}</small>` : ''}</td>
      <td>${timeFmt.format(new Date(r.createdAt))}</td>
    </tr>`)}
  </tbody>
</table>
</div>`}`,
  });
}

// GET /profesor lists registrations (filter by subject or exam date); GET /profesor/prijave.csv exports the same list.
export function profesorRouter(store, { password, now = () => new Date() } = {}) {
  const router = express.Router();
  router.use(requirePassword(password));
  router.use((req, res, next) => {
    // Students' personal data: keep it out of caches and search engines.
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });

  const load = (req, res) => {
    const filters = readFilters(req.query);
    if (!filters) {
      res.status(400).type('text').send('Izbira filtra ni veljavna. Vrnite se na /profesor in izberite znova.');
      return null;
    }
    // A date of another subject (left over after changing the subject) would hide everything: drop it.
    if (filters.subjectId && filters.examDateId) {
      const date = store.listExamDates().find((e) => e.id === filters.examDateId);
      if (date && date.subjectId !== filters.subjectId) delete filters.examDateId;
    }
    return { filters, registrations: store.listRegistrations(filters) };
  };

  router.get('/', (req, res) => {
    const data = load(req, res);
    if (!data) return;
    res.type('html').send(listPage({
      ...data,
      subjects: store.listSubjects(),
      examDates: store.listExamDates(),
    }));
  });

  router.get('/prijave.csv', (req, res) => {
    const data = load(req, res);
    if (!data) return;
    const { subjectId, examDateId } = data.filters;
    const which = examDateId ? `-rok-${examDateId}` : subjectId ? `-predmet-${subjectId}` : '';
    res.set('Content-Disposition', `attachment; filename="prijave-${todayInLjubljana(now())}${which}.csv"`);
    res.type('text/csv; charset=utf-8').send(toCsv(data.registrations, CSV_COLUMNS));
  });

  return router;
}
