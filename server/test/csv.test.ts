import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, csvCell } from '../../client/src/lib/csv.js';

test('CSV preserves quoted data and rejects ambiguous datasets', () => {
  const parsed = parseCsv(
    '\uFEFFTitle,Notes\r\n"Acme, Inc","First line\nSecond ""quoted"" line"',
  );
  assert.deepEqual(parsed.rows, [
    { Title: 'Acme, Inc', Notes: 'First line\nSecond "quoted" line' },
  ]);
  assert.throws(() => parseCsv('Name,name\nA,B'), /unique/);
  assert.throws(() => parseCsv('Title,Notes\nA,B,C'), /expected 2/);
  assert.throws(() => parseCsv('Title\n"Unfinished'), /unclosed/);
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('plain "text"'), '"plain ""text"""');
});

test('the downloadable demo dataset has complete rows and realistic edge cases', () => {
  const demo = parseCsv(
    readFileSync(
      new URL('../../client/public/demo-leads.csv', import.meta.url),
      'utf8',
    ),
  );
  assert.ok(demo.rows.length >= 3);
  assert.ok(demo.rows.some((row) => row.Notes?.includes('\n')));
  assert.ok(demo.rows.some((row) => row['Lead Title']?.includes(',')));
  assert.ok(
    demo.rows.every(
      (row) => row['Lead Title'] && Number(row['Expected Revenue']) >= 0,
    ),
  );
});
