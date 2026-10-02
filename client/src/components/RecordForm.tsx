import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Metadata } from '../lib/types';
import { useAuth } from '../context/Auth';
import { Button } from './ui';
export type FormValues = {
  customValues?: Record<string, any>;
  title: string;
  contactName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  expectedRevenue: number;
  priority: number;
  salesperson?: string;
  salesTeam?: string;
  stage?: string;
  source?: string;
  campaign?: string;
  internalNotes?: string;
};
export function RecordForm({
  kind,
  metadata,
  initial,
  onSubmit,
  onCancel,
}: {
  kind: 'lead' | 'opportunity';
  metadata: Metadata;
  initial?: Partial<FormValues>;
  onSubmit: (x: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const canAssign = user?.role.permissions.some(
    (p) => p === '*' || p === 'team:write',
  );
  const people = canAssign
    ? metadata.users
    : metadata.users.filter((person) => person._id === user?._id);
  const fields =
    metadata.customFields?.filter(
      (field) => field.entity === (kind === 'lead' ? 'Lead' : 'Opportunity'),
    ) ?? [];
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      expectedRevenue: 0,
      priority: 1,
      salesperson: user?._id,
      stage: metadata.stages[0]?._id,
      ...initial,
    },
  });
  const [error, setError] = useState('');
  const submit = async (values: FormValues) => {
    setError('');
    try {
      await onSubmit(values);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save. Please try again.');
    }
  };
  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className="grid max-h-[70vh] grid-cols-1 gap-4 overflow-auto p-5 sm:grid-cols-2">
        <Field label={kind === 'lead' ? 'Lead' : 'Opportunity'}>
          <input
            required
            minLength={2}
            className="field"
            {...register('title')}
          />
        </Field>
        {kind === 'lead' && (
          <>
            <Field label="Contact">
              <input className="field" {...register('contactName')} />
            </Field>
            <Field label="Company">
              <input className="field" {...register('companyName')} />
            </Field>
          </>
        )}
        <Field label="Email">
          <input type="email" className="field" {...register('email')} />
        </Field>
        <Field label="Phone">
          <input className="field" {...register('phone')} />
        </Field>
        <Field label="Expected revenue">
          <input
            className="field"
            type="number"
            min="0"
            {...register('expectedRevenue', { valueAsNumber: true })}
          />
        </Field>
        <Select
          label="Priority"
          register={register('priority', { valueAsNumber: true })}
          items={[
            { _id: '0', name: 'Normal' },
            { _id: '1', name: 'Medium' },
            { _id: '2', name: 'High' },
            { _id: '3', name: 'Very high' },
          ]}
        />
        <Select
          label="Salesperson"
          register={register('salesperson')}
          items={people}
        />
        <Select
          label="Sales team"
          register={register('salesTeam')}
          items={metadata.teams}
        />
        {kind === 'opportunity' && (
          <Select
            label="Stage"
            register={register('stage')}
            items={metadata.stages}
          />
        )}
        <Select
          label="Source"
          register={register('source')}
          items={metadata.sources}
        />
        <Select
          label="Campaign"
          register={register('campaign')}
          items={metadata.campaigns}
        />
        {fields.map((field) => (
          <Field key={field.key} label={field.name}>
            {field.fieldType === 'dropdown' ||
            field.fieldType === 'multi-select' ? (
              <select
                className="field"
                required={field.required}
                multiple={field.fieldType === 'multi-select'}
                {...register(`customValues.${field.key}`)}
              >
                {field.fieldType === 'dropdown' && (
                  <option value="">Select?</option>
                )}
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : field.fieldType === 'checkbox' ? (
              <input
                type="checkbox"
                {...register(`customValues.${field.key}`)}
              />
            ) : (
              <input
                className="field"
                required={field.required}
                type={
                  field.fieldType === 'date'
                    ? 'date'
                    : field.fieldType === 'url'
                      ? 'url'
                      : ['number', 'currency'].includes(field.fieldType)
                        ? 'number'
                        : 'text'
                }
                step="any"
                {...register(`customValues.${field.key}`, {
                  setValueAs: (value) =>
                    value === ''
                      ? null
                      : ['number', 'currency'].includes(field.fieldType)
                        ? Number(value)
                        : value,
                })}
              />
            )}
          </Field>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="border-t border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t bg-slate-50 p-3">
        <Button type="button" onClick={onCancel}>
          Discard
        </Button>
        <Button className="btn-primary" disabled={isSubmitting}>
          Save
        </Button>
      </div>
    </form>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
function Select({
  label,
  register,
  items,
}: {
  label: string;
  register: any;
  items: { _id: string; name: string }[];
}) {
  return (
    <Field label={label}>
      <select className="field" {...register}>
        <option value="">—</option>
        {items.map((x) => (
          <option key={x._id} value={x._id}>
            {x.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
