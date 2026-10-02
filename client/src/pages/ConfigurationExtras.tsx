import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, date } from '../lib/api';
import { Button, Empty, Loading, QueryError } from '../components/ui';

type Resource = 'customFields' | 'scoringRules' | 'auditLogs';
export function ConfigurationExtras({ resource }: { resource: Resource }) {
  const qc = useQueryClient();
  const records = useQuery({
    queryKey: [resource],
    queryFn: () => api<any[]>(`/${resource}`),
  });
  const [form, setForm] = useState({
    name: '',
    key: '',
    entity: 'Lead',
    fieldType: 'text',
    options: '',
    required: false,
    field: 'expectedRevenue',
    operator: 'greater_than',
    value: '',
    points: 10,
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/${resource}`, {
        method: 'POST',
        body: JSON.stringify(
          resource === 'customFields'
            ? {
                name: form.name,
                key: form.key,
                entity: form.entity,
                fieldType: form.fieldType,
                options: form.options
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
                required: form.required,
                active: true,
              }
            : {
                name: form.name,
                field: form.field,
                operator: form.operator,
                value: form.value,
                points: form.points,
                active: true,
              },
        ),
      }),
    onSuccess: () => {
      setError('');
      setForm({ ...form, name: '', key: '' });
      qc.invalidateQueries({ queryKey: [resource] });
      qc.invalidateQueries({ queryKey: ['metadata'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (cause) => setError(cause.message),
  });
  const toggle = useMutation({
    mutationFn: (record: any) =>
      api(`/${resource}/${record._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !record.active }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [resource] });
      qc.invalidateQueries({ queryKey: ['metadata'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (cause) => setError(cause.message),
  });
  if (records.isLoading) return <Loading />;
  if (records.isError)
    return <QueryError error={records.error} retry={() => records.refetch()} />;
  if (resource === 'auditLogs')
    return (
      <section className="panel max-w-5xl overflow-auto">
        <h2 className="border-b p-4 font-semibold">Audit history</h2>
        {!records.data?.length ? (
          <Empty
            title="No changes recorded yet"
            detail="Record and configuration changes will appear here."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-3">When</th>
                <th>Person</th>
                <th>Action</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {records.data.map((record) => (
                <tr className="border-t" key={record._id}>
                  <td className="p-3">{date(record.createdAt)}</td>
                  <td>{record.actor?.name ?? 'Unknown user'}</td>
                  <td>{record.action}</td>
                  <td>
                    {record.entityType}
                    <span className="ml-2 text-xs text-slate-500">
                      {record.entityId}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  return (
    <section className="panel max-w-4xl">
      <h2 className="border-b p-4 font-semibold">
        {resource === 'customFields' ? 'Custom fields' : 'Lead scoring rules'}
      </h2>
      <form
        className="grid gap-4 border-b p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          <span className="label">Name</span>
          <input
            className="field"
            required
            minLength={2}
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        {resource === 'customFields' ? (
          <>
            <label>
              <span className="label">Field key</span>
              <input
                className="field"
                required
                pattern="[a-z][a-z0-9_]{0,63}"
                placeholder="e.g. industry"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
              />
            </label>
            <label>
              <span className="label">Record type</span>
              <select
                className="field"
                value={form.entity}
                onChange={(e) => setForm({ ...form, entity: e.target.value })}
              >
                {['Lead', 'Opportunity', 'Contact', 'Company'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Value type</span>
              <select
                className="field"
                value={form.fieldType}
                onChange={(e) =>
                  setForm({ ...form, fieldType: e.target.value })
                }
              >
                {[
                  'text',
                  'number',
                  'currency',
                  'date',
                  'dropdown',
                  'multi-select',
                  'checkbox',
                  'url',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            {['dropdown', 'multi-select'].includes(form.fieldType) && (
              <label>
                <span className="label">Choices, separated by commas</span>
                <input
                  required
                  className="field"
                  value={form.options}
                  onChange={(e) =>
                    setForm({ ...form, options: e.target.value })
                  }
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) =>
                  setForm({ ...form, required: e.target.checked })
                }
              />
              Required
            </label>
          </>
        ) : (
          <>
            <label>
              <span className="label">Lead field</span>
              <select
                className="field"
                value={form.field}
                onChange={(e) => setForm({ ...form, field: e.target.value })}
              >
                {[
                  'expectedRevenue',
                  'priority',
                  'status',
                  'companyName',
                  'contactName',
                  'email',
                  'phone',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Condition</span>
              <select
                className="field"
                value={form.operator}
                onChange={(e) => setForm({ ...form, operator: e.target.value })}
              >
                {[
                  'equals',
                  'contains',
                  'greater_than',
                  'less_than',
                  'exists',
                ].map((x) => (
                  <option key={x} value={x}>
                    {x.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            {form.operator !== 'exists' && (
              <label>
                <span className="label">Comparison value</span>
                <input
                  className="field"
                  required
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </label>
            )}
            <label>
              <span className="label">Points</span>
              <input
                className="field"
                type="number"
                required
                min={-100}
                max={100}
                step={1}
                value={form.points}
                onChange={(e) =>
                  setForm({ ...form, points: Number(e.target.value) })
                }
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Add'}
          </Button>
        </div>
      </form>
      {records.data?.map((record) => (
        <div
          className="flex flex-wrap items-center gap-3 border-b p-4 text-sm"
          key={record._id}
        >
          <b>{record.name}</b>
          <span className="text-slate-500">
            {resource === 'customFields'
              ? `${record.entity} · ${record.fieldType} · ${record.key}`
              : `${record.field} ${record.operator.replaceAll('_', ' ')} ${record.value ?? ''} · ${record.points} points`}
          </span>
          <Button
            className="ml-auto"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(record)}
          >
            {record.active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ))}
    </section>
  );
}
