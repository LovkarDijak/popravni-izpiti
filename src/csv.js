// CSV the way Slovenian Excel opens it with a double click: UTF-8 with a BOM (for č, š, ž),
// semicolons between fields (the comma is the decimal separator here) and CRLF line ends.

const BOM = '\uFEFF';
const SEPARATOR = ';';

// A value starting with one of these is run as a formula by Excel and LibreOffice (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value) {
  let text = String(value ?? '');
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[";\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// columns: [{ header, value(row) }]
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvField(c.header)).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(c.value(row))).join(SEPARATOR));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
