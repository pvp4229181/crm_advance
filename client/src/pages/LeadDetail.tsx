import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Briefcase, CalendarClock, CalendarPlus, Check, CheckCircle2, Copy, ExternalLink,
  Flame, Mail, MapPin, MessageCircle, MessageSquare, Phone, RotateCcw, Sparkles, StickyNote, ThumbsDown, Trophy,
} from 'lucide-react';
import { api, date, money, when } from '../lib/api';
import type { Activity, Lead, Metadata, Timeline } from '../lib/types';
import { useAuth } from '../context/Auth';
import { Avatar, Button, Loading, RowMenu } from '../components/ui';
import { PhoneActions } from '../components/Communicate';

// One screen that answers the four questions a salesperson opens a lead with: who is this person,
// what has happened, where is the deal, and what do I do next. It all arrives in a single
// GET /leads/:id, which already folds in the converted opportunity's history.

const temperature = (score: number) => score >= 70
  ? { label: 'HOT 🔥', tone: 'bg-red-100 text-red-700' }
  : score >= 40
    ? { label: 'WARM', tone: 'bg-amber-100 text-amber-700' }
    : { label: 'COLD', tone: 'bg-slate-200 text-slate-600' };

// How each kind of history entry reads in the feed. Unknown types still render - the timeline
// endpoint takes a free-form eventType, and a generic entry beats a missing one.
const entryStyles: Record<string, { icon: typeof Phone; label: string; tone: string }> = {
  lead_captured: { icon: Sparkles, label: 'Lead captured', tone: 'text-sky-600' },
  duplicate_submission: { icon: Copy, label: 'Submitted again', tone: 'text-orange-600' },
  note_added: { icon: StickyNote, label: 'Note', tone: 'text-slate-500' },
  call_logged: { icon: Phone, label: 'Called', tone: 'text-emerald-600' },
  sms_sent: { icon: MessageSquare, label: 'SMS sent', tone: 'text-sky-600' },
  whatsapp_sent: { icon: MessageCircle, label: 'WhatsApp', tone: 'text-emerald-600' },
  whatsapp_received: { icon: MessageCircle, label: 'WhatsApp received', tone: 'text-emerald-600' },
  email_received: { icon: Mail, label: 'Email received', tone: 'text-violet-600' },
  email_sent: { icon: Mail, label: 'Email sent', tone: 'text-violet-600' },
  stage_changed: { icon: ArrowRight, label: 'Stage changed', tone: 'text-sky-600' },
  opportunity_created: { icon: Briefcase, label: 'Converted to opportunity', tone: 'text-[#8a6d1f]' },
  opportunity_won: { icon: Trophy, label: 'Deal won', tone: 'text-emerald-600' },
  opportunity_lost: { icon: ThumbsDown, label: 'Deal lost', tone: 'text-red-600' },
  opportunity_reopened: { icon: RotateCcw, label: 'Deal reopened', tone: 'text-slate-500' },
  activity_planned: { icon: CalendarClock, label: 'Scheduled', tone: 'text-blue-600' },
  activity_done: { icon: CheckCircle2, label: 'Completed', tone: 'text-emerald-600' },
  lead_marked_hot: { icon: Flame, label: 'Marked HOT', tone: 'text-red-600' },
  escalated_uncontacted: { icon: AlertTriangle, label: 'Escalated to manager', tone: 'text-red-600' },
};
const styleFor = (eventType: string) => entryStyles[eventType] ?? { icon: StickyNote, label: eventType.replace(/_/g, ' '), tone: 'text-slate-500' };
const callMessages: Record<string, string> = { connected: 'Spoke with the customer', no_answer: 'Called, no answer', voicemail: 'Called, left a voicemail' };

type Entry = { id: string; at: string; eventType: string; message: string; author?: string };

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<'note' | 'call'>('note');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('connected');
  const [error, setError] = useState('');

  const q = useQuery({ queryKey: ['lead', id], queryFn: () => api<Lead>(`/leads/${id}`) });
  const meta = useQuery({ queryKey: ['metadata'], queryFn: () => api<Metadata>('/metadata') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lead', id] }); qc.invalidateQueries({ queryKey: ['leads'] }); };

  const log = useMutation({
    mutationFn: (body: { eventType: string; message: string }) => api(`/timeline/Lead/${id}`, { method: 'POST', body: JSON.stringify(body) }),
    onMutate: () => setError(''),
    onSuccess: () => { setNote(''); refresh(); },
    onError: (cause: any) => setError(cause?.message ?? 'Could not save this entry.'),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onMutate: () => setError(''),
    onSuccess: refresh,
    onError: (cause: any) => setError(cause?.message ?? 'Could not update this lead.'),
  });
  const convert = useMutation({
    mutationFn: () => api<{ _id: string }>(`/leads/${id}/convert`, { method: 'POST' }),
    onMutate: () => setError(''),
    onSuccess: deal => { refresh(); nav(`/opportunities/${deal._id}`); },
    onError: (cause: any) => setError(cause?.message ?? 'Could not convert this lead.'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/leads/${id}`, { method: 'DELETE' }),
    onMutate: () => setError(''),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); nav('/leads'); },
    onError: (cause: any) => setError(cause?.message ?? 'Could not delete this lead.'),
  });

  const lead = q.data;
  // Timeline events and activities are two tables telling one story, so the feed reads them as a
  // single list. An activity is dated by when it actually happened, falling back to when it is due.
  const feed = useMemo<Entry[]>(() => {
    if (!lead) return [];
    const events: Entry[] = (lead.timeline ?? []).map((event: Timeline) => ({ id: event._id, at: event.createdAt, eventType: event.eventType, message: event.message, author: event.createdBy?.name }));
    const activities: Entry[] = (lead.activities ?? []).map((activity: Activity) => ({
      id: `activity-${activity._id}`,
      at: activity.completedAt ?? activity.dueDate,
      eventType: activity.status === 'completed' ? 'activity_done' : 'activity_planned',
      message: `${activity.activityType?.name ?? 'Activity'}: ${activity.summary}`,
      author: activity.assignedTo?.name,
    }));
    return [...events, ...activities].sort((left, right) => +new Date(right.at) - +new Date(left.at));
  }, [lead]);

  if (q.isLoading || meta.isLoading) return <Loading />;
  if (!lead) return <div className="p-8 text-sm text-slate-500">This lead is no longer available.</div>;

  const heat = temperature(lead.score);
  const deal = lead.deal ?? null;
  const revenue = deal?.expectedRevenue ?? lead.expectedRevenue;

  return <>
    <div className="border-b bg-white">
      <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2">
        <Button onClick={() => nav('/leads')} title="Back to leads"><ArrowLeft size={15} /></Button>
        <div className="mr-auto">
          <div className="text-[11px] text-slate-400">Leads / 360° view</div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{lead.contactName || lead.title}</h1>
            <span className={`badge ${heat.tone}`}>{heat.label}</span>
            {lead.touchCount > 1 && <span className="badge bg-orange-100 text-orange-700">Reached out ×{lead.touchCount}</span>}
          </div>
          <div className="text-xs text-slate-500">{lead.companyName || 'No company'} · <b className="text-slate-700">{money(revenue)}</b> {deal ? 'opportunity' : 'expected'}</div>
        </div>
        {deal && <Button onClick={() => nav(`/opportunities/${deal._id}`)}><ExternalLink size={14} />Open deal</Button>}
        {!lead.converted && <>
          <select className="field w-36" value={lead.status} disabled={setStatus.isPending} onChange={event => setStatus.mutate(event.target.value)}>
            <option value="new">New</option><option value="qualified">Qualified</option><option value="disqualified">Disqualified</option>
          </select>
          <Button className="btn-primary" disabled={convert.isPending} onClick={() => confirm('Convert this lead into an opportunity?') && convert.mutate()}>
            <Check size={15} />{convert.isPending ? 'Converting…' : 'Convert'}
          </Button>
        </>}
        <RowMenu label="Delete lead" busy={remove.isPending} onDelete={() => { if (confirm(`Delete "${lead.title}"? This cannot be undone.`)) remove.mutate(); }} />
      </div>
      <Journey lead={lead} stages={meta.data!.stages} />
    </div>
    {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

    <div className="grid gap-4 p-4 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <section className="panel">
          <h2 className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact</h2>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center gap-2.5">
              <Phone size={14} className="shrink-0 text-slate-400" />
              <PhoneActions phone={lead.phone} relatedModel="Lead" relatedId={lead._id} onSent={refresh} />
            </div>
            <div className="flex items-center gap-2.5">
              <Mail size={14} className="shrink-0 text-slate-400" />
              {lead.email ? <a className="truncate text-[#0284c7] hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="text-slate-400">—</span>}
            </div>
            <div className="flex items-center gap-2.5">
              <MapPin size={14} className="shrink-0 text-slate-400" />
              <span className={lead.city ? '' : 'text-slate-400'}>{lead.city || '—'}</span>
            </div>
            <div className="flex items-center gap-2.5 border-t pt-3 text-xs text-slate-500">
              <Avatar name={lead.salesperson?.name} size={22} />
              <span>{lead.salesperson?.name ?? 'Unassigned'}{lead.salesTeam ? ` · ${lead.salesTeam.name}` : ''}</span>
            </div>
          </div>
        </section>

        <ScoreCard lead={lead} />

        <NextAction lead={lead} activityTypes={meta.data!.activityTypes ?? []} defaultAssignee={lead.salesperson?._id ?? user?._id} onDone={refresh} onError={setError} />

        <section className="panel">
          <h2 className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Where it came from</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
            <Field label="Source" value={lead.source?.name} />
            <Field label="Channel" value={lead.channel?.name ?? 'Manual entry'} />
            <Field label="Campaign" value={lead.campaign?.name} />
            <Field label="Medium" value={lead.medium?.name} />
            <Field label="Captured" value={date(lead.createdAt)} />
            {lead.lostReason && <Field label="Disqualified because" value={lead.lostReason.name} />}
          </dl>
          {lead.notes && <p className="whitespace-pre-wrap border-t p-4 text-xs text-slate-600">{lead.notes}</p>}
        </section>
      </div>

      <section className="panel flex flex-col">
        <h2 className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Activity timeline</h2>
        <div className="flex border-b">
          <button className={`flex flex-1 items-center justify-center gap-1.5 p-3 text-xs ${tab === 'note' ? 'font-semibold text-[#0284c7]' : 'text-slate-500'}`} onClick={() => setTab('note')}><StickyNote size={14} />Log note</button>
          <button className={`flex flex-1 items-center justify-center gap-1.5 p-3 text-xs ${tab === 'call' ? 'font-semibold text-[#0284c7]' : 'text-slate-500'}`} onClick={() => setTab('call')}><Phone size={14} />Log call</button>
        </div>
        <div className="border-b p-3">
          <textarea className="field min-h-20 py-2" placeholder={tab === 'note' ? 'What did you learn?' : 'What was said on the call?'} value={note} onChange={event => setNote(event.target.value)} />
          <div className="mt-2 flex items-center justify-between gap-2">
            {tab === 'call'
              ? <select className="field w-40" value={outcome} onChange={event => setOutcome(event.target.value)}>
                <option value="connected">Connected</option><option value="no_answer">No answer</option><option value="voicemail">Left voicemail</option>
              </select>
              : <span className="text-[11px] text-slate-400">Visible to your team</span>}
            <Button className="btn-primary" disabled={log.isPending || (tab === 'note' && !note.trim())}
              onClick={() => log.mutate(tab === 'note'
                ? { eventType: 'note_added', message: note.trim() }
                : { eventType: 'call_logged', message: `${callMessages[outcome]}${note.trim() ? ` — ${note.trim()}` : ''}` })}>
              {log.isPending ? 'Saving…' : tab === 'note' ? 'Post note' : 'Log call'}
            </Button>
          </div>
        </div>
        <div className="max-h-[620px] overflow-auto p-4">
          {feed.length === 0
            ? <p className="py-8 text-center text-xs text-slate-400">Nothing has happened on this lead yet.</p>
            : feed.map(entry => {
              const style = styleFor(entry.eventType);
              const Icon = style.icon;
              return <div key={entry.id} className="relative flex gap-3 border-l border-slate-200 pb-5 pl-5 last:border-transparent last:pb-0">
                <span className={`absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full border bg-white ${style.tone}`}><Icon size={13} /></span>
                <div className="min-w-0">
                  <div className="text-xs"><b>{style.label}</b> <span className="text-slate-400">— {when(entry.at)}</span></div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{entry.message}</p>
                  {entry.author && <div className="mt-1 text-[11px] text-slate-400">{entry.author}</div>}
                </div>
              </div>;
            })}
        </div>
      </section>
    </div>
  </>;
}

// The AI Lead Score, made visible: not a chatbot you ask, a number the CRM keeps current on its
// own (see server/scoring.service) and explains in the same breath - what earned the points, and
// what to do about it. This is what "AI built into the CRM" looks like on screen.
function ScoreCard({ lead }: { lead: Lead }) {
  const heat = temperature(lead.score);
  const reasons = lead.scoreReasons ?? [];
  const max = Math.max(...reasons.map(r => r.points), 1);
  return <section className="panel">
    <h2 className="flex items-center gap-1.5 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      <Sparkles size={12} className="text-[#0284c7]" />AI Lead Score
    </h2>
    <div className="space-y-3 p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800">{lead.score}</span>
        <span className="text-xs text-slate-400">/ 100</span>
        <span className={`badge ml-auto ${heat.tone}`}>{heat.label}</span>
      </div>
      {reasons.length > 0
        ? <ul className="space-y-1.5">
          {reasons.map(reason => <li key={reason.label} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-slate-500">{reason.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-[#0284c7]" style={{ width: `${(reason.points / max) * 100}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right font-semibold text-emerald-600">+{reason.points}</span>
          </li>)}
        </ul>
        : <p className="text-xs text-slate-400">No signals yet.</p>}
      {lead.scoreRecommendation && <p className="rounded border border-sky-100 bg-sky-50 p-2.5 text-xs font-medium text-sky-900">{lead.scoreRecommendation}</p>}
    </div>
  </section>;
}

function Field({ label, value }: { label: string; value?: string }) {
  return <div><dt className="text-[11px] text-slate-400">{label}</dt><dd className="mt-0.5 truncate font-medium">{value || '—'}</dd></div>;
}

// Where the deal stands. Before conversion that is the lead's own qualification track; after it,
// the real pipeline the opportunity now sits in - the same strip the opportunity screen draws.
function Journey({ lead, stages }: { lead: Lead; stages: Metadata['stages'] }) {
  if (lead.status === 'disqualified') {
    return <div className="border-t bg-red-50 px-4 py-2 text-center text-[11px] font-semibold text-red-700">
      Disqualified{lead.lostReason ? ` — ${lead.lostReason.name}` : ''}
    </div>;
  }
  const deal = lead.deal;
  const steps = deal
    ? stages.map(stage => ({ key: stage._id, name: stage.name, done: stage.sequence <= (deal.stage?.sequence ?? -1) }))
    : [
      { key: 'new', name: 'New', done: true },
      { key: 'qualified', name: 'Qualified', done: lead.status === 'qualified' },
      { key: 'converted', name: 'Converted', done: false },
    ];
  return <div className="flex overflow-x-auto border-t px-4">
    {steps.map(step => <div key={step.key} className={`min-w-28 flex-1 border-r px-3 py-2 text-center text-[11px] font-semibold ${step.done ? 'bg-[#0284c7] text-white' : 'bg-slate-100 text-slate-500'}`}>{step.name}</div>)}
  </div>;
}

// The answer to "what should I do next" - the soonest open activity, with the two things a
// salesperson does about one: tick it off, or put the next step in the diary.
function NextAction({ lead, activityTypes, defaultAssignee, onDone, onError }: {
  lead: Lead; activityTypes: Metadata['activityTypes'];
  defaultAssignee?: string; onDone: () => void; onError: (message: string) => void;
}) {
  const [planning, setPlanning] = useState(false);
  const [summary, setSummary] = useState('');
  const [typeId, setTypeId] = useState('');
  const [due, setDue] = useState('');

  const complete = useMutation({
    mutationFn: (activityId: string) => api(`/activities/${activityId}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed', completedAt: new Date().toISOString() }) }),
    onMutate: () => onError(''),
    onSuccess: onDone,
    onError: (cause: any) => onError(cause?.message ?? 'Could not complete this activity.'),
  });
  const schedule = useMutation({
    mutationFn: () => api('/activities', {
      method: 'POST',
      body: JSON.stringify({ activityType: typeId, dueDate: new Date(due).toISOString(), assignedTo: defaultAssignee, summary: summary.trim(), relatedModel: 'Lead', relatedId: lead._id }),
    }),
    onMutate: () => onError(''),
    onSuccess: () => { setPlanning(false); setSummary(''); setDue(''); onDone(); },
    onError: (cause: any) => onError(cause?.message ?? 'Could not schedule this activity.'),
  });

  const next = (lead.activities ?? []).filter(activity => activity.status !== 'completed').sort((left, right) => +new Date(left.dueDate) - +new Date(right.dueDate))[0];
  const overdue = Boolean(next) && new Date(next!.dueDate) < new Date();

  return <section className={`panel ${overdue ? 'border-red-200' : ''}`}>
    <h2 className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next action</h2>
    <div className="space-y-3 p-4">
      {next
        ? <div className="flex items-start gap-3">
          <CalendarClock size={16} className={`mt-0.5 shrink-0 ${overdue ? 'text-red-500' : 'text-[#0284c7]'}`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{next.summary}</div>
            <div className={`mt-0.5 text-xs ${overdue ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
              {next.activityType?.name ?? 'Activity'} · {when(next.dueDate)}{overdue ? ' · overdue' : ''}
            </div>
          </div>
          <Button className="h-8" disabled={complete.isPending} onClick={() => complete.mutate(next._id)}><Check size={14} />Done</Button>
        </div>
        : <p className="text-xs text-slate-400">Nothing scheduled. A lead with no next step goes cold.</p>}

      {planning
        ? <div className="space-y-2 border-t pt-3">
          <select className="field" value={typeId} onChange={event => setTypeId(event.target.value)}>
            {activityTypes.length === 0 && <option value="">No activity types configured</option>}
            {activityTypes.map(type => <option key={type._id} value={type._id}>{type.name}</option>)}
          </select>
          <input className="field" placeholder="What needs doing?" value={summary} onChange={event => setSummary(event.target.value)} />
          <input className="field" type="datetime-local" value={due} onChange={event => setDue(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button className="h-8" onClick={() => setPlanning(false)}>Cancel</Button>
            <Button className="btn-primary h-8" disabled={!summary.trim() || !due || !typeId || !defaultAssignee || schedule.isPending} onClick={() => schedule.mutate()}>
              {schedule.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </div>
        : <Button className="w-full" onClick={() => { setTypeId(activityTypes[0]?._id ?? ''); setPlanning(true); }}><CalendarPlus size={14} />Schedule next step</Button>}
    </div>
  </section>;
}
