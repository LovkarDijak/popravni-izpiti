// Small helpers for server-rendered pages. Every value from users or the database goes through
// escapeHtml (html`` does it for each ${value}); raw() marks markup that is already safe.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new SafeHtml(value);
}

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === false || value === null || value === undefined) return '';
  return escapeHtml(value);
}

// Tagged template: html`<p>${name}</p>` escapes name; nested html`` and arrays of them stay as markup.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return raw(out);
}

export function page({ title, body }) {
  return html`<!doctype html>
<html lang="sl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Popravni izpiti</title>
<link rel="stylesheet" href="/prijava.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>`.value;
}
