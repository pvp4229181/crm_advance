import { parseCsv, csvCell } from '../lib/csv';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from '../components/ui';
import { PageHeader } from '../components/Shell';

type Field =
  | 'title'
  | 'contactName'
  | 'companyName'
  | 'email'
  | 'phone'
  | 'expectedRevenue'
  | 'priority'
  | 'notes';
type ReviewRow = {
  row: number;
  data: Record<string, unknown>;
  errors: string[];
  duplicate?: { title: string };
};
type Review = {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  imported?: number;
  rows: ReviewRow[];
};
const fields: { value: Field; label: string }[] = [
  { value: 'title', label: 'Lead title (required)' },
  { value: 'contactName', label: 'Contact name' },
  { value: 'companyName', label: 'Company' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'expectedRevenue', label: 'Expected revenue' },
  { value: 'priority', label: 'Priority (0–3)' },
  { value: 'notes', label: 'Notes' },
];

function guess(header: string): Field | '' {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (/^(title|lead|leadname|subject)$/.test(h)) return 'title';
  if (/^(name|contact|contactname|customer)$/.test(h)) return 'contactName';
  if (/^(company|companyname|organization|organisation)$/.test(h))
    return 'companyName';
  if (h.includes('email')) return 'email';
  if (/(phone|mobile|telephone)/.test(h)) return 'phone';
  if (/(revenue|value|amount|dealvalue)/.test(h)) return 'expectedRevenue';
  if (h.includes('priority')) return 'priority';
  if (/(note|description|comment)/.test(h)) return 'notes';
  return '';
}
export default function LeadImport() {
  const nav = useNavigate();
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, Field | ''>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleMapped = Object.values(mapping).includes('title');
  const used = useMemo(
    () => new Set(Object.values(mapping).filter(Boolean)),
    [mapping],
  );
  async function load(file?: File) {
    if (!file) return;
    setError('');
    setReview(null);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.headers.length || !parsed.rows.length)
        throw new Error(
          'The CSV must include a header and at least one data row.',
        );
      if (parsed.rows.length > 2000)
        throw new Error('Import files are limited to 2,000 rows.');
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      const assigned = new Set<Field>();
      setMapping(
        Object.fromEntries(
          parsed.headers.map((h) => {
            const field = guess(h);
            if (!field || assigned.has(field)) return [h, ''];
            assigned.add(field);
            return [h, field];
          }),
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not read this CSV file.',
      );
    }
  }
  async function submit(confirm = false) {
    setBusy(true);
    setError('');
    try {
      setReview(
        await api<Review>('/leads/import', {
          method: 'POST',
          body: JSON.stringify({ rows, mapping, confirm }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import request failed.');
    } finally {
      setBusy(false);
    }
  }
  function downloadErrors() {
    if (!review) return;
    const failed = review.rows.filter((r) => r.errors.length || r.duplicate);
    const lines = [
      ['CSV row', 'Reason', ...headers],
      ...failed.map((r) => [
        r.row,
        [...r.errors, r.duplicate ? `Duplicate: ${r.duplicate.title}` : '']
          .filter(Boolean)
          .join('; '),
        ...headers.map((h) => rows[r.row - 2]?.[h] ?? ''),
      ]),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob(
        [lines.map((line) => line.map(csvCell).join(',')).join('\r\n')],
        { type: 'text/csv' },
      ),
    );
    a.download = 'lead-import-errors.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <>
      <PageHeader
        title="Import leads"
        subtitle="Upload, map, validate, and safely import CSV data"
      >
        <Button onClick={() => nav('/leads')}>
          <ArrowLeft size={15} />
          Back to leads
        </Button>
      </PageHeader>
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <section className="panel p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <FileSpreadsheet />
            </span>
            <div className="mr-auto">
              <h2 className="font-semibold">Choose a CSV file</h2>
              <p className="text-xs text-slate-500">
                Up to 2,000 rows. Nothing is written until you confirm the
                reviewed import.
              </p>
            </div>
            <a className="btn" href="/demo-leads.csv" download>
              <Download size={15} />
              Download demo CSV
            </a>
            <label className="btn btn-primary cursor-pointer">
              <Upload size={15} />
              {fileName ? 'Replace file' : 'Select CSV'}
              <input
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  void load(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {fileName && (
            <p className="mt-3 text-xs text-slate-500">
              Loaded <b>{fileName}</b> · {rows.length} data rows
            </p>
          )}
        </section>
        {headers.length > 0 && (
          <section className="panel overflow-hidden">
            <div className="border-b p-4">
              <h2 className="font-semibold">Map columns</h2>
              <p className="text-xs text-slate-500">
                Choose which CRM field each CSV column represents. Unmapped
                columns are ignored.
              </p>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((h) => (
                <label key={h}>
                  <span className="label truncate" title={h}>
                    {h}
                  </span>
                  <select
                    className="field"
                    disabled={busy}
                    value={mapping[h] ?? ''}
                    onChange={(e) => {
                      setReview(null);
                      setMapping((m) => ({
                        ...m,
                        [h]: e.target.value as Field | '',
                      }));
                    }}
                  >
                    <option value="">Do not import</option>
                    {fields.map((f) => (
                      <option
                        key={f.value}
                        value={f.value}
                        disabled={used.has(f.value) && mapping[h] !== f.value}
                      >
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="overflow-x-auto border-t">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {headers.map((h) => (
                      <th className="p-3" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr className="border-t" key={i}>
                      {headers.map((h) => (
                        <td className="max-w-48 truncate p-3" key={h}>
                          {r[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-3 border-t p-4">
              <span className="mr-auto text-xs text-slate-500">
                Previewing {Math.min(5, rows.length)} of {rows.length} rows
              </span>
              <Button
                className="btn-primary"
                disabled={!titleMapped || busy}
                onClick={() => submit(false)}
              >
                {busy ? 'Checking…' : 'Review import'}
              </Button>
            </div>
          </section>
        )}
        {review && (
          <section className="panel p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 text-emerald-500" size={20} />
              <div className="flex-1">
                <h2 className="font-semibold">Import review</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Metric label="Total rows" value={review.total} />
                  <Metric label="Ready" value={review.valid} />
                  <Metric
                    label="Invalid"
                    value={review.invalid}
                    warn={review.invalid > 0}
                  />
                  <Metric
                    label="Duplicates skipped"
                    value={review.duplicates}
                    warn={review.duplicates > 0}
                  />
                </div>
                {review.imported !== undefined && (
                  <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                    Imported {review.imported} leads successfully. Invalid and
                    duplicate rows were not added.
                  </p>
                )}
                {review.rows.some((r) => r.errors.length || r.duplicate) && (
                  <ul
                    className="mt-4 max-h-60 overflow-y-auto rounded-lg border p-3 text-sm"
                    aria-label="Import issues"
                  >
                    {review.rows
                      .filter((r) => r.errors.length || r.duplicate)
                      .slice(0, 50)
                      .map((r) => (
                        <li key={r.row} className="py-1">
                          Row {r.row}:{' '}
                          {[
                            ...r.errors,
                            ...(r.duplicate
                              ? [`Duplicate: ${r.duplicate.title}`]
                              : []),
                          ].join('; ')}
                        </li>
                      ))}
                    <li className="pt-2 text-xs text-slate-500">
                      Showing up to 50 issues. Download the report for all
                      affected rows.
                    </li>
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {(review.invalid > 0 || review.duplicates > 0) && (
                    <Button onClick={downloadErrors}>
                      <Download size={15} />
                      Download error report
                    </Button>
                  )}
                  {review.imported === undefined && (
                    <Button
                      className="btn-primary"
                      disabled={busy || review.valid === 0}
                      onClick={() => submit(true)}
                    >
                      {busy
                        ? 'Importing…'
                        : `Import ${review.valid} valid leads`}
                    </Button>
                  )}
                  {review.imported !== undefined && (
                    <Button
                      className="btn-primary"
                      onClick={() => nav('/leads')}
                    >
                      View leads
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}
      </main>
    </>
  );
}
function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${warn ? 'border-amber-200 bg-amber-50' : 'bg-slate-50'}`}
    >
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
