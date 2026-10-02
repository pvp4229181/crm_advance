import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Pencil,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { PageHeader } from '../components/Shell';
import { Button, Empty, Loading, Modal, RowMenu } from '../components/ui';
import { useAuth } from '../context/Auth';
import { api, date } from '../lib/api';
import type { Metadata } from '../lib/types';
import {
  isCrmTemplate,
  sendable,
  type WhatsAppTemplate,
} from './WhatsAppTemplates';

type EventType =
  | 'lead_created'
  | 'lead_status_changed'
  | 'opportunity_stage_changed'
  | 'opportunity_won'
  | 'opportunity_lost';
type ActionType =
  | 'assign_owner'
  | 'create_activity'
  | 'notify'
  | 'add_tag'
  | 'set_priority'
  | 'add_note'
  | 'send_whatsapp';
type Conditions = {
  source?: string | null;
  status?: string | null;
  stage?: string | null;
  minRevenue?: number | null;
  minPriority?: number | null;
};
type Action = { type: ActionType; config: Record<string, any> };
type Draft = {
  _id?: string;
  name: string;
  active: boolean;
  trigger: { event: EventType; conditions: Conditions };
  actions: Action[];
};
type WorkflowRecord = Draft & {
  _id: string;
  runs?: number;
  failures?: number;
  lastRunAt?: string;
  lastError?: string;
};

const events: Record<EventType, string> = {
  lead_created: 'Lead is created',
  lead_status_changed: 'Lead status changes',
  opportunity_stage_changed: 'Opportunity moves stage',
  opportunity_won: 'Opportunity is won',
  opportunity_lost: 'Opportunity is lost',
};
const actionLabels: Record<ActionType, string> = {
  assign_owner: 'Assign owner',
  create_activity: 'Create activity',
  notify: 'Send notification',
  add_tag: 'Add tag',
  set_priority: 'Set priority',
  add_note: 'Add timeline note',
  send_whatsapp: 'Send WhatsApp message',
};
const priorities = ['Normal', 'Medium', 'High', 'Very high'];
const isLeadEvent = (event: EventType) => event.startsWith('lead_');

function defaultConfig(type: ActionType, meta?: Metadata): Record<string, any> {
  switch (type) {
    case 'assign_owner':
      return { user: null, team: null, onlyIfUnassigned: true };
    case 'create_activity':
      return {
        activityType: meta?.activityTypes[0]?._id ?? '',
        days: 1,
        summary: 'Follow up with {contactName}',
      };
    case 'notify':
      return { user: null, message: '' };
    case 'add_tag':
      return { tag: meta?.tags[0]?._id ?? '' };
    case 'set_priority':
      return { priority: 2 };
    case 'send_whatsapp':
      return { message: '', template: null };
    default:
      return { message: '' };
  }
}

function followUpTemplate(meta?: Metadata): Draft {
  const call =
    meta?.activityTypes.find((type) => /call/i.test(type.name)) ??
    meta?.activityTypes[0];
  return {
    name: 'Lead follow-up',
    active: true,
    trigger: { event: 'lead_created', conditions: {} },
    actions: [
      { type: 'assign_owner', config: defaultConfig('assign_owner') },
      {
        type: 'create_activity',
        config: {
          activityType: call?._id ?? '',
          days: 1,
          summary: 'Follow up with {contactName}',
        },
      },
    ],
  };
}

// Mirrors the server's rules so Save stays disabled instead of failing with a bare "Validation failed".
function problem(draft: Draft) {
  if (draft.name.trim().length < 2) return 'Give the workflow a name.';
  if (!draft.actions.length) return 'Add at least one action.';
  for (const action of draft.actions) {
    const c = action.config;
    if (action.type === 'create_activity' && !c.activityType)
      return 'Choose an activity type.';
    if (action.type === 'add_tag' && !c.tag) return 'Choose a tag.';
    if (action.type === 'add_note' && !String(c.message ?? '').trim())
      return `${actionLabels[action.type]} needs a message.`;
    if (
      action.type === 'send_whatsapp' &&
      !c.template &&
      !String(c.message ?? '').trim()
    )
      return 'Choose a WhatsApp template or write a message.';
  }
  return '';
}

function nameOf(
  list: { _id: string; name: string }[] | undefined,
  id: unknown,
) {
  return list?.find((item) => item._id === id)?.name ?? 'a removed item';
}

function describeAction(action: Action, meta?: Metadata) {
  const c = action.config;
  switch (action.type) {
    case 'assign_owner':
      return c.user
        ? `Assign to ${nameOf(meta?.users, c.user)}`
        : `Round-robin across ${c.team ? nameOf(meta?.teams, c.team) : 'all users'}`;
    case 'create_activity':
      return `${nameOf(meta?.activityTypes, c.activityType)} in ${c.days} day${c.days === 1 ? '' : 's'}`;
    case 'notify':
      return `Notify ${c.user ? nameOf(meta?.users, c.user) : 'the owner'}`;
    case 'add_tag':
      return `Tag “${nameOf(meta?.tags, c.tag)}”`;
    case 'set_priority':
      return `Priority → ${priorities[c.priority] ?? c.priority}`;
    case 'send_whatsapp':
      return c.template ? 'Send WhatsApp template' : 'Send WhatsApp message';
    default:
      return actionLabels[action.type];
  }
}

function describeConditions(conditions: Conditions, meta?: Metadata) {
  const parts: string[] = [];
  if (conditions.status) parts.push(`status is ${conditions.status}`);
  if (conditions.stage)
    parts.push(`stage is ${nameOf(meta?.stages, conditions.stage)}`);
  if (conditions.source)
    parts.push(`source is ${nameOf(meta?.sources, conditions.source)}`);
  if (conditions.minRevenue != null)
    parts.push(`value ≥ ${conditions.minRevenue}`);
  if (conditions.minPriority != null)
    parts.push(`priority ≥ ${priorities[conditions.minPriority]}`);
  return parts.join(', ');
}

export default function Workflows() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role.name === 'Administrator';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const flows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api<WorkflowRecord[]>('/workflows'),
  });
  const meta = useQuery({
    queryKey: ['metadata'],
    queryFn: () => api<Metadata>('/metadata'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['workflows'] });
  const toggle = useMutation({
    mutationFn: (flow: WorkflowRecord) =>
      api(`/workflows/${flow._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !flow.active }),
      }),
    onMutate: () => setError(''),
    onSuccess: refresh,
    onError: (cause: any) =>
      setError(cause?.message ?? 'Could not change this workflow.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/workflows/${id}`, { method: 'DELETE' }),
    onMutate: () => setError(''),
    onSuccess: refresh,
    onError: (cause: any) =>
      setError(cause?.message ?? 'Could not delete this workflow.'),
  });

  const edit = (flow: WorkflowRecord) =>
    setDraft({
      _id: flow._id,
      name: flow.name,
      active: flow.active,
      trigger: {
        event: flow.trigger.event,
        conditions: flow.trigger.conditions ?? {},
      },
      actions: flow.actions.map((a) => ({
        type: a.type,
        config: { ...a.config },
      })),
    });

  return (
    <>
      <PageHeader
        title="Automation"
        subtitle="Run sales steps automatically when CRM events happen"
      >
        {isAdmin && (
          <Button
            className="btn-primary"
            onClick={() =>
              setDraft({
                name: '',
                active: true,
                trigger: { event: 'lead_created', conditions: {} },
                actions: [
                  {
                    type: 'create_activity',
                    config: defaultConfig('create_activity', meta.data),
                  },
                ],
              })
            }
          >
            <Plus size={15} />
            New workflow
          </Button>
        )}
      </PageHeader>
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 sm:px-6">
          {error}
        </div>
      )}
      {!isAdmin && (
        <div className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-600 sm:px-6">
          Only administrators can create or change workflows.
        </div>
      )}
      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-3">
        {isAdmin && (
          <div className="panel border-dashed p-5">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
              <WorkflowIcon size={19} />
            </span>
            <h2 className="mt-4 font-semibold">Lead follow-up</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Lead created → assign owner → create follow-up task.
            </p>
            <button
              className="mt-4 text-xs font-semibold text-indigo-600"
              onClick={() => setDraft(followUpTemplate(meta.data))}
            >
              Use template
            </button>
          </div>
        )}
        {flows.isLoading ? (
          <Loading />
        ) : flows.data?.length ? (
          flows.data.map((flow) => (
            <div className="panel flex flex-col p-5" key={flow._id}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={flow.active}
                  aria-label={
                    flow.active ? 'Turn workflow off' : 'Turn workflow on'
                  }
                  disabled={!isAdmin || toggle.isPending}
                  onClick={() => toggle.mutate(flow)}
                  className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-60 ${flow.active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${flow.active ? 'left-[18px]' : 'left-0.5'}`}
                  />
                </button>
                <span className="text-xs font-medium text-slate-500">
                  {flow.active ? 'Active' : 'Off'}
                </span>
                {isAdmin && (
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      title="Edit workflow"
                      className="text-slate-500 hover:text-slate-900"
                      onClick={() => edit(flow)}
                    >
                      <Pencil size={14} />
                    </button>
                    <RowMenu
                      label="Delete workflow"
                      busy={remove.isPending}
                      onDelete={() =>
                        confirm(`Delete "${flow.name}"?`) &&
                        remove.mutate(flow._id)
                      }
                    />
                  </span>
                )}
              </div>
              <h2 className="mt-4 font-semibold">{flow.name}</h2>
              <p className="mt-1 text-xs text-slate-500">
                When{' '}
                {events[flow.trigger.event]?.toLowerCase() ??
                  flow.trigger.event}
                {describeConditions(flow.trigger.conditions ?? {}, meta.data) &&
                  ` and ${describeConditions(flow.trigger.conditions, meta.data)}`}
              </p>
              <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
                {flow.actions.map((action, index) => (
                  <li key={index} className="flex items-center gap-1.5">
                    {index > 0 && (
                      <ArrowRight size={12} className="text-slate-400" />
                    )}
                    <span className="rounded-md bg-slate-100 px-2 py-1">
                      {describeAction(action, meta.data)}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto pt-4 text-xs text-slate-400">
                {flow.runs
                  ? `Ran ${flow.runs} time${flow.runs === 1 ? '' : 's'} · last ${date(flow.lastRunAt)}`
                  : "Hasn't run yet"}
                {!!flow.failures && ` · ${flow.failures} failed`}
              </div>
              {flow.lastError && (
                <p className="mt-1 text-xs text-red-600">
                  Last error: {flow.lastError}
                </p>
              )}
            </div>
          ))
        ) : (
          !isAdmin && (
            <Empty
              title="No workflows yet"
              detail="An administrator can create one."
            />
          )
        )}
      </div>
      {draft && meta.data && (
        <WorkflowEditor
          initial={draft}
          meta={meta.data}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function WorkflowEditor({
  initial,
  meta,
  onClose,
  onSaved,
}: {
  initial: Draft;
  meta: Metadata;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState('');
  const whatsapp = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api<{ configured: boolean }>('/whatsapp/status'),
  });
  const save = useMutation({
    mutationFn: () => {
      const { _id, ...body } = draft;
      return api(_id ? `/workflows/${_id}` : '/workflows', {
        method: _id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
    },
    onMutate: () => setError(''),
    onSuccess: onSaved,
    onError: (cause: any) =>
      setError(cause?.message ?? 'Could not save this workflow.'),
  });
  const conditions = draft.trigger.conditions;
  const setConditions = (patch: Conditions) =>
    setDraft({
      ...draft,
      trigger: { ...draft.trigger, conditions: { ...conditions, ...patch } },
    });
  const setAction = (index: number, action: Action) =>
    setDraft({
      ...draft,
      actions: draft.actions.map((a, i) => (i === index ? action : a)),
    });
  const blocked = problem(draft);
  const lead = isLeadEvent(draft.trigger.event);

  return (
    <Modal
      title={draft._id ? 'Edit workflow' : 'New workflow'}
      onClose={onClose}
    >
      <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
        <label className="block">
          <span className="label">Name</span>
          <input
            className="field"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Website lead follow-up"
          />
        </label>

        <section>
          <h3 className="text-sm font-semibold">When</h3>
          <select
            className="field mt-2"
            value={draft.trigger.event}
            onChange={(e) => {
              const event = e.target.value as EventType;
              // Status only exists on leads and stage only on opportunities, so drop whichever no longer applies.
              const next = {
                ...conditions,
                ...(isLeadEvent(event) ? { stage: null } : { status: null }),
              };
              setDraft({ ...draft, trigger: { event, conditions: next } });
            }}
          >
            {Object.entries(events).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h3 className="text-sm font-semibold">
            Only if{' '}
            <span className="font-normal text-slate-400">(optional)</span>
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {lead ? (
              <label>
                <span className="label">Lead status</span>
                <select
                  className="field"
                  value={conditions.status ?? ''}
                  onChange={(e) =>
                    setConditions({ status: e.target.value || null })
                  }
                >
                  <option value="">Any status</option>
                  <option value="new">New</option>
                  <option value="qualified">Qualified</option>
                  <option value="disqualified">Disqualified</option>
                </select>
              </label>
            ) : (
              <label>
                <span className="label">Stage</span>
                <select
                  className="field"
                  value={conditions.stage ?? ''}
                  onChange={(e) =>
                    setConditions({ stage: e.target.value || null })
                  }
                >
                  <option value="">Any stage</option>
                  {meta.stages.map((stage) => (
                    <option key={stage._id} value={stage._id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="label">Source</span>
              <select
                className="field"
                value={conditions.source ?? ''}
                onChange={(e) =>
                  setConditions({ source: e.target.value || null })
                }
              >
                <option value="">Any source</option>
                {meta.sources.map((source) => (
                  <option key={source._id} value={source._id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Minimum deal value</span>
              <input
                className="field"
                type="number"
                min={0}
                value={conditions.minRevenue ?? ''}
                onChange={(e) =>
                  setConditions({
                    minRevenue:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                placeholder="Any value"
              />
            </label>
            <label>
              <span className="label">Minimum priority</span>
              <select
                className="field"
                value={conditions.minPriority ?? ''}
                onChange={(e) =>
                  setConditions({
                    minPriority:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">Any priority</option>
                {priorities.map((name, value) => (
                  <option key={name} value={value}>
                    {name} or higher
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold">Then</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Steps run in order. Messages can use {'{title}'}, {'{contactName}'}{' '}
            and {'{companyName}'}.
          </p>
          <ol className="mt-3 space-y-3">
            {draft.actions.map((action, index) => (
              <li key={index} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
                    {index + 1}
                  </span>
                  <select
                    className="field"
                    value={action.type}
                    onChange={(e) => {
                      const type = e.target.value as ActionType;
                      setAction(index, {
                        type,
                        config: defaultConfig(type, meta),
                      });
                    }}
                  >
                    {Object.entries(actionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {[-1, 1].map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      aria-label={
                        direction < 0 ? 'Move step up' : 'Move step down'
                      }
                      className="grid h-11 w-11 shrink-0 place-items-center rounded hover:bg-slate-100 disabled:opacity-30"
                      disabled={
                        index + direction < 0 ||
                        index + direction >= draft.actions.length
                      }
                      onClick={() => {
                        const actions = [...draft.actions];
                        [actions[index], actions[index + direction]] = [
                          actions[index + direction]!,
                          actions[index]!,
                        ];
                        setDraft({ ...draft, actions });
                      }}
                    >
                      {direction < 0 ? (
                        <ArrowUp size={15} />
                      ) : (
                        <ArrowDown size={15} />
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    title="Remove step"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        actions: draft.actions.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-3 pl-8">
                  <ActionFields
                    action={action}
                    meta={meta}
                    whatsappReady={whatsapp.data?.configured}
                    onChange={(config) =>
                      setAction(index, { ...action, config })
                    }
                  />
                </div>
              </li>
            ))}
          </ol>
          {draft.actions.length < 10 && (
            <Button
              className="mt-3"
              onClick={() =>
                setDraft({
                  ...draft,
                  actions: [
                    ...draft.actions,
                    { type: 'notify', config: defaultConfig('notify') },
                  ],
                })
              }
            >
              <Plus size={15} />
              Add step
            </Button>
          )}
        </section>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          Active: run this workflow on new events
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t p-4">
        <span className="mr-auto text-xs text-red-600">
          {error ||
            (blocked && <span className="text-slate-500">{blocked}</span>)}
        </span>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          className="btn-primary"
          disabled={!!blocked || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save workflow'}
        </Button>
      </div>
    </Modal>
  );
}

function ActionFields({
  action,
  meta,
  whatsappReady,
  onChange,
}: {
  action: Action;
  meta: Metadata;
  whatsappReady?: boolean;
  onChange: (config: Record<string, any>) => void;
}) {
  const c = action.config;
  const set = (patch: Record<string, any>) => onChange({ ...c, ...patch });
  switch (action.type) {
    case 'assign_owner':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Owner</span>
            <select
              className="field"
              value={c.user ?? ''}
              onChange={(e) => set({ user: e.target.value || null })}
            >
              <option value="">Round-robin</option>
              {meta.users.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">
              {c.user ? 'Also set sales team' : 'Rotate across'}
            </span>
            <select
              className="field"
              value={c.team ?? ''}
              onChange={(e) => set({ team: e.target.value || null })}
            >
              <option value="">
                {c.user ? 'Leave unchanged' : 'All active users'}
              </option>
              {meta.teams.map((team) => (
                <option key={team._id} value={team._id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input
              type="checkbox"
              checked={c.onlyIfUnassigned !== false}
              onChange={(e) => set({ onlyIfUnassigned: e.target.checked })}
            />
            Only when the record has no owner yet
          </label>
        </div>
      );
    case 'create_activity':
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <label>
            <span className="label">Activity type</span>
            <select
              className="field"
              value={c.activityType ?? ''}
              onChange={(e) => set({ activityType: e.target.value })}
            >
              <option value="">Choose type</option>
              {meta.activityTypes.map((type) => (
                <option key={type._id} value={type._id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Due in (days)</span>
            <input
              className="field"
              type="number"
              min={0}
              max={365}
              value={c.days ?? 1}
              onChange={(e) =>
                set({
                  days: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                })
              }
            />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Summary</span>
            <input
              className="field"
              value={c.summary ?? ''}
              onChange={(e) => set({ summary: e.target.value })}
              placeholder="Follow up with {contactName}"
            />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Assigned to the record's owner, or to whoever triggered it if
            there's no owner.
          </p>
        </div>
      );
    case 'notify':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Notify</span>
            <select
              className="field"
              value={c.user ?? ''}
              onChange={(e) => set({ user: e.target.value || null })}
            >
              <option value="">Record owner</option>
              {meta.users.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Message</span>
            <input
              className="field"
              value={c.message ?? ''}
              onChange={(e) => set({ message: e.target.value })}
              placeholder="Defaults to the record title"
            />
          </label>
        </div>
      );
    case 'add_tag':
      return (
        <label>
          <span className="label">Tag</span>
          <select
            className="field"
            value={c.tag ?? ''}
            onChange={(e) => set({ tag: e.target.value })}
          >
            <option value="">Choose tag</option>
            {meta.tags.map((tag) => (
              <option key={tag._id} value={tag._id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'set_priority':
      return (
        <label>
          <span className="label">Priority</span>
          <select
            className="field"
            value={c.priority ?? 2}
            onChange={(e) => set({ priority: Number(e.target.value) })}
          >
            {priorities.map((name, value) => (
              <option key={name} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'send_whatsapp':
      return (
        <WhatsAppActionFields
          config={c}
          whatsappReady={whatsappReady}
          set={set}
        />
      );
    default:
      return (
        <label className="block">
          <span className="label">Message</span>
          <textarea
            className="field min-h-20 py-2"
            value={c.message ?? ''}
            onChange={(e) => set({ message: e.target.value })}
          />
        </label>
      );
  }
}

function WhatsAppActionFields({
  config,
  whatsappReady,
  set,
}: {
  config: Record<string, any>;
  whatsappReady?: boolean;
  set: (patch: Record<string, any>) => void;
}) {
  const templates = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => api<WhatsAppTemplate[]>('/whatsappTemplates'),
  });
  // Templates still awaiting approval can be chosen so the workflow is ready the moment Meta approves them.
  const awaiting = (template: WhatsAppTemplate) =>
    !isCrmTemplate(template) &&
    (template.status === 'PENDING' || template.status === 'DRAFT');
  const options = (templates.data ?? []).filter(
    (template) =>
      (template.active &&
        !template.unsupportedReason &&
        (sendable(template) || awaiting(template))) ||
      template._id === config.template,
  );
  const chosen = templates.data?.find(
    (template) => template._id === config.template,
  );
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">Send</span>
        <select
          className="field"
          value={config.template ?? ''}
          onChange={(e) => set({ template: e.target.value || null })}
        >
          <option value="">Free-text message</option>
          {options.map((template) => (
            <option key={template._id} value={template._id}>
              {isCrmTemplate(template)
                ? `CRM template: ${template.name}`
                : `Template: ${template.name} (${template.language})${awaiting(template) ? ' — awaiting approval' : ''}`}
            </option>
          ))}
        </select>
      </label>
      {config.template ? (
        chosen ? (
          <>
            <p className="whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
              {chosen.body}
            </p>
            {awaiting(chosen) ? (
              <span className="block text-xs text-amber-700">
                Waiting for Meta approval. This step fails until Meta approves
                the template.
              </span>
            ) : (
              !sendable(chosen) && (
                <span className="block text-xs text-red-700">
                  This template can no longer be sent. Pick another one.
                </span>
              )
            )}
            <span className="block text-xs text-slate-500">
              {isCrmTemplate(chosen)
                ? 'A CRM template is sent as a normal message, so it only reaches contacts who messaged you in the last 24 hours.'
                : 'Placeholders are filled from the mapping under WhatsApp → Templates.'}
            </span>
          </>
        ) : (
          !templates.isLoading && (
            <span className="block text-xs text-red-700">
              This template was removed. Pick another one.
            </span>
          )
        )
      ) : (
        <label className="block">
          <span className="label">Message</span>
          <textarea
            className="field min-h-20 py-2"
            value={config.message ?? ''}
            onChange={(e) => set({ message: e.target.value })}
            placeholder="Hi {contactName}, thanks for reaching out…"
          />
          <span className="mt-1 block text-xs text-amber-700">
            Free text only reaches contacts who messaged you in the last 24
            hours. To message new leads, choose a template (create one under
            WhatsApp → Templates).
          </span>
        </label>
      )}
      {whatsappReady === false && (
        <span className="block text-xs text-amber-700">
          WhatsApp isn't configured on the server yet, so this step will fail
          until it is.
        </span>
      )}
    </div>
  );
}
