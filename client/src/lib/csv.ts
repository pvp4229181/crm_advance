export function parseCsv(text: string) {
  text = text.replace(/^\uFEFF/, '');
  const table: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) table.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some(Boolean)) table.push(row);
  const [headers = [], ...values] = table;
  const names = headers.map((h, i) => h || `Column ${i + 1}`);
  if (new Set(names.map((h) => h.toLowerCase())).size !== names.length)
    throw new Error(
      'CSV column headings must be unique. Rename repeated headings.',
    );
  for (const [index, cells] of values.entries())
    if (cells.length !== names.length)
      throw new Error(
        `CSV row ${index + 2} has ${cells.length} columns; expected ${names.length}.`,
      );
  return {
    headers: names,
    rows: values.map((cells) =>
      Object.fromEntries(names.map((h, i) => [h, cells[i] ?? ''])),
    ),
  };
}

export function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
