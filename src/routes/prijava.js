import express from 'express';
import { DataError, MAX_LENGTH, checkRegistration } from '../db/index.js';
import { html, page } from '../html.js';

const KIND_LABEL = { popravni: 'Popravni izpit', matura: 'Popravni izpit mature' };
const FIELDS = ['examDateId', 'firstName', 'lastName', 'className', 'email'];

// What to tell the student for each field and each reason checkRegistration gives.
const MESSAGES = {
  firstName: {
    missing: 'Vpiši ime.',
    tooLong: `Ime je predolgo (največ ${MAX_LENGTH.firstName} znakov).`,
    badChars: 'Ime vsebuje znake, ki niso dovoljeni. Vpiši ga znova.',
  },
  lastName: {
    missing: 'Vpiši priimek.',
    tooLong: `Priimek je predolg (največ ${MAX_LENGTH.lastName} znakov).`,
    badChars: 'Priimek vsebuje znake, ki niso dovoljeni. Vpiši ga znova.',
  },
  className: {
    missing: 'Vpiši razred, na primer 2. a.',
    tooLong: `Razred je predolg (največ ${MAX_LENGTH.className} znakov).`,
    badChars: 'Razred vsebuje znake, ki niso dovoljeni. Vpiši ga znova.',
  },
  email: {
    missing: 'Vpiši e-poštni naslov.',
    tooLong: `E-poštni naslov je predolg (največ ${MAX_LENGTH.email} znakov).`,
    badChars: 'E-poštni naslov vsebuje znake, ki niso dovoljeni. Vpiši ga znova.',
    format: 'E-poštni naslov ni pravilen. Vpiši ga v obliki ime.priimek@primer.si.',
  },
};
const FALLBACK = {
  firstName: 'Vpiši ime znova.', lastName: 'Vpiši priimek znova.',
  className: 'Vpiši razred znova.', email: 'Vpiši e-poštni naslov znova.',
};

function messageFor(err) {
  return MESSAGES[err.field]?.[err.reason] ?? FALLBACK[err.field];
}

// Today's date (YYYY-MM-DD) at the school, whatever time zone the server runs in.
export function todayInLjubljana(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Ljubljana' }).format(now);
}

const weekday = new Intl.DateTimeFormat('sl', { weekday: 'long', timeZone: 'UTC' });

// 2027-08-20 -> "petek, 20. 8. 2027"
export function slovenianDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${weekday.format(new Date(`${iso}T00:00:00Z`))}, ${Number(d)}. ${Number(m)}. ${y}`;
}

function examLabel(e) {
  const kind = e.subjectKind === 'matura' ? ' (matura)' : '';
  const description = e.description ? ` (${e.description})` : '';
  return `${e.subjectName}${kind}, ${slovenianDate(e.date)}${description}`;
}

function errorAttrs(name, errors) {
  return errors[name] ? html` aria-invalid="true" aria-describedby="${name}-napaka"` : '';
}

function fieldError(name, errors) {
  return errors[name] ? html`<p id="${name}-napaka" class="napaka-polje">${errors[name]}</p>` : '';
}

function form({ examDates, values = {}, errors = {} }) {
  const hasErrors = Object.keys(errors).length > 0;
  const groups = Object.entries(KIND_LABEL).map(([kind, label]) => {
    const options = examDates.filter((e) => e.subjectKind === kind);
    if (options.length === 0) return '';
    return html`<optgroup label="${label}">${options.map((e) => html`
      <option value="${e.id}"${String(e.id) === String(values.examDateId) ? html` selected` : ''}>${examLabel(e)}</option>`)}
    </optgroup>`;
  });

  const field = (name, label, { type = 'text', autocomplete, max }) => html`
    <p>
      <label for="${name}">${label}</label>
      ${fieldError(name, errors)}
      <input id="${name}" name="${name}" type="${type}" required maxlength="${max}"
        autocomplete="${autocomplete}" value="${values[name] ?? ''}"${errorAttrs(name, errors)}>
    </p>`;

  // The summary takes focus after a failed submit, so screen readers read it at once.
  const summary = hasErrors ? html`
<div class="napaka" id="napake" tabindex="-1" autofocus>
  <h2>Prijava ni oddana. Popravi označena polja:</h2>
  <ul>${FIELDS.filter((name) => errors[name]).map((name) => html`
    <li><a href="#${name}">${errors[name]}</a></li>`)}
  </ul>
</div>` : '';

  return page({
    title: hasErrors ? 'Napaka: Prijava na popravni izpit' : 'Prijava na popravni izpit',
    body: html`
<h1>Prijava na popravni izpit</h1>
${summary}
${examDates.length === 0
    ? html`<p>Trenutno ni razpisanih izpitnih rokov. Poskusi znova pozneje.</p>`
    : html`<p>Vsa polja so obvezna.</p>
<form method="post" action="/prijava" novalidate>
  <p>
    <label for="examDateId">Izpit in rok</label>
    ${fieldError('examDateId', errors)}
    <select id="examDateId" name="examDateId" aria-required="true"${errorAttrs('examDateId', errors)}>
      <option value="">Izberi predmet in rok</option>
      ${groups}
    </select>
  </p>
  ${field('firstName', 'Ime', { autocomplete: 'given-name', max: MAX_LENGTH.firstName })}
  ${field('lastName', 'Priimek', { autocomplete: 'family-name', max: MAX_LENGTH.lastName })}
  ${field('className', 'Razred (npr. 2. a)', { autocomplete: 'on', max: MAX_LENGTH.className })}
  ${field('email', 'E-pošta', { type: 'email', autocomplete: 'email', max: MAX_LENGTH.email })}
  <p><button type="submit">Prijavi me</button></p>
</form>`}`,
  });
}

function confirmation(registration) {
  return page({
    title: 'Prijava je oddana',
    body: html`
<h1>Prijava je oddana</h1>
<p>Hvala, ${registration.firstName}. Tvoja prijava je zabeležena:</p>
<dl>
  <dt>Izpit</dt><dd>${KIND_LABEL[registration.subjectKind]}: ${registration.subjectName}</dd>
  <dt>Rok</dt><dd>${slovenianDate(registration.examDate)}</dd>
  ${registration.examDescription ? html`<dt>Opis</dt><dd>${registration.examDescription}</dd>` : ''}
  <dt>Ime in priimek</dt><dd>${registration.firstName} ${registration.lastName}</dd>
  <dt>Razred</dt><dd>${registration.className}</dd>
  <dt>E-pošta</dt><dd>${registration.email}</dd>
</dl>
<p>Potrdila po e-pošti ne pošiljamo, zato si to stran shrani ali natisni.</p>
<p><a href="/prijava">Nova prijava</a></p>`,
  });
}

// GET /prijava shows the form with exam dates still open (after today); POST /prijava stores a registration.
export function prijavaRouter(store, { now = () => new Date() } = {}) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '10kb' }));

  const openExamDates = () => {
    const today = todayInLjubljana(now());
    return store.listExamDates().filter((e) => e.date > today);
  };

  router.get('/', (req, res) => {
    res.type('html').send(form({ examDates: openExamDates() }));
  });

  router.post('/', (req, res) => {
    // The answer shows the student's name and e-mail; school computers are shared.
    res.set('Cache-Control', 'no-store');
    const values = {};
    for (const name of FIELDS) {
      const value = req.body?.[name];
      values[name] = typeof value === 'string' ? value : '';
    }
    const examDates = openExamDates();
    const fail = (status, errors) => res.status(status).type('html').send(form({ examDates, values, errors }));

    const errors = {};
    if (!values.examDateId) {
      errors.examDateId = 'Izberi predmet in rok.';
    } else if (!examDates.some((e) => String(e.id) === values.examDateId)) {
      // An unknown, past or malformed exam date all look the same to the student.
      errors.examDateId = 'Izbrani rok ni več na voljo. Izberi drug rok.';
    }
    for (const [name, err] of Object.entries(checkRegistration(values).errors)) {
      errors[name] = messageFor(err);
    }
    if (Object.keys(errors).length > 0) return fail(400, errors);

    try {
      return res.type('html').send(confirmation(store.createRegistration(values)));
    } catch (err) {
      if (!(err instanceof DataError)) throw err;
      if (err.code === 'DUPLICATE') {
        return fail(409, { examDateId: 'Prijava na ta rok že obstaja. Ponovna prijava ni potrebna.' });
      }
      return fail(400, { examDateId: 'Prijave ni bilo mogoče shraniti. Preveri podatke in poskusi znova.' });
    }
  });

  return router;
}
