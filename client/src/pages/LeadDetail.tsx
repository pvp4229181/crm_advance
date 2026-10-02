import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarPlus,
  CheckCircle2,
  LoaderCircle,
  Mail,
  Phone,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { api, date, money } from '../lib/api';
import type { Activity, Lead, Timeline } from '../lib/types';
import { Avatar, Button, Empty, Loading } from '../components/ui';

type LeadProfile = Lead & {
  notes?: string;
  whatsappSummary?: WhatsAppSummary;
  medium?: { name: string };
  updatedAt?: string;
  timeline: Timeline[];
  activities: Activity[];
};
type WhatsAppMessage = {
  _id: string;
  direction: 'inbound' | 'outbound';
  mode: 'human' | 'ai';
  body: string;
  status: string;
  createdAt: string;
  metadata?: {
    template?: { name: string };
    whatsappStatus?: { errors?: { title?: string; message?: string }[] };
  };
};
export type WhatsAppSummary = {
  summary: string;
  intent?: string;
  requirements?: string[];
  budget?: string;
  timeline?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  nextStep?: string;
  generatedAt?: string;
};
type TemplateOption = {
  _id: string;
  // 'crm' templates are sent as ordinary text; 'meta' ones are Meta-approved and can open a conversation.
  kind: 'meta' | 'crm';
  name: string;
  language: string;
  category?: string;
  preview: string;
  // Fields that came out empty for this lead, e.g. "{{2}}" or "{companyName}".
  missing: string[];
};
type WhatsAppConversation = {
  mode: 'human' | 'ai';
  configured: boolean;
  aiConfigured: boolean;
  phone?: string;
  messages: WhatsAppMessage[];
  // `tracked` is false when the webhook is not set up, so the 24-hour window is unknown.
  window: { tracked: boolean; open: boolean; expiresAt: string | null };
  summary: WhatsAppSummary | null;
  templates: TemplateOption[];
  // Created in the CRM but not yet approved by Meta.
  pendingTemplates: number;
};
export default function LeadDetail() {
  const { id } = useParams(),
    nav = useNavigate(),
    qc = useQueryClient();
  const [note, setNote] = useState('');
  const [params] = useSearchParams();
  const [tab, setTab] = useState<
    'overview' | 'activity' | 'whatsapp' | 'tasks'
  >(params.get('tab') === 'whatsapp' ? 'whatsapp' : 'overview');
  const q = useQuery({
    queryKey: ['lead', id],
    queryFn: () => api<LeadProfile>(`/leads/${id}`),
  });
  const addNote = useMutation({
    mutationFn: () =>
      api(`/timeline/Lead/${id}`, {
        method: 'POST',
        body: JSON.stringify({ eventType: 'note_added', message: note.trim() }),
      }),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['lead', id] });
    },
  });
  const convert = useMutation({
    mutationFn: () =>
      api<{ _id: string }>(`/leads/${id}/convert`, { method: 'POST' }),
    onSuccess: (deal) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      nav(`/opportunities/${deal._id}`);
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data)
    return (
      <div className="p-6">
        <div className="panel p-8 text-center">
          <h1 className="font-semibold">Lead unavailable</h1>
          <p className="mt-1 text-sm text-slate-500">
            It may have been removed or you may not have access.
          </p>
          <Button className="mt-4" onClick={() => nav('/leads')}>
            Back to leads
          </Button>
        </div>
      </div>
    );
  const lead = q.data;
  const temperature =
    lead.priority >= 3 ? 'Hot' : lead.priority === 2 ? 'Warm' : 'Cold';
  return (
    <>
      <header className="border-b bg-white px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button aria-label="Back to leads" onClick={() => nav('/leads')}>
            <ArrowLeft size={16} />
          </Button>
          <Avatar name={lead.contactName || lead.title} size={42} />
          <div className="mr-auto">
            <div className="text-[11px] text-slate-400">Leads / Profile</div>
            <h1 className="text-xl font-semibold tracking-tight">
              {lead.contactName || lead.title}
            </h1>
            <p className="text-xs text-slate-500">
              {lead.companyName || 'No company'} · {lead.title}
            </p>
          </div>
          <span
            className={`badge ${temperature === 'Hot' ? 'bg-red-50 text-red-700' : temperature === 'Warm' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}
          >
            {temperature}
          </span>
          <span className="badge bg-indigo-50 capitalize text-indigo-700">
            {lead.status}
          </span>
          {lead.converted && lead.convertedOpportunity ? (
            <Link
              className="btn"
              to={`/opportunities/${lead.convertedOpportunity._id}`}
            >
              View deal
            </Link>
          ) : (
            <Button
              className="btn-primary"
              disabled={convert.isPending}
              onClick={() => convert.mutate()}
            >
              <BriefcaseBusiness size={15} />
              Convert to deal
            </Button>
          )}
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto">
          <Action
            icon={<Phone />}
            label="Call"
            href={lead.phone ? `tel:${lead.phone}` : undefined}
            missingMessage="Add a phone number to this lead before calling."
          />
          <button
            type="button"
            className="btn"
            onClick={() => setTab('whatsapp')}
          >
            <WhatsAppIcon size={15} /> WhatsApp
          </button>
          <Action
            icon={<Mail />}
            label="Email"
            href={lead.email ? `mailto:${lead.email}` : undefined}
            missingMessage="Add an email address to this lead before sending email."
          />
          <button className="btn">
            <CalendarPlus size={15} />
            Meeting
          </button>
          <button className="btn" onClick={() => setTab('activity')}>
            <StickyNote size={15} />
            Add note
          </button>
          <button
            className="btn btn-danger ml-auto"
            onClick={async () => {
              if (
                !confirm(
                  `Delete ${lead.contactName || lead.title}? This cannot be undone.`,
                )
              )
                return;
              try {
                await api(`/leads/${id}`, { method: 'DELETE' });
                qc.invalidateQueries({ queryKey: ['leads'] });
                nav('/leads');
              } catch (cause) {
                alert(
                  cause instanceof Error
                    ? cause.message
                    : 'Could not delete this lead.',
                );
              }
            }}
          >
            <Trash2 size={15} />
            Delete lead
          </button>
        </div>
      </header>
      <nav className="flex overflow-x-auto border-b bg-white px-4 sm:px-6">
        {(['overview', 'activity', 'whatsapp', 'tasks'] as const).map(
          (item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`border-b-2 px-4 py-3 text-xs font-semibold capitalize ${tab === item ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}
            >
              {item}
            </button>
          ),
        )}
      </nav>
      <main className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section>
          {tab === 'overview' && (
            <div className="panel overflow-hidden">
              <div className="border-b p-5">
                <h2 className="font-semibold">Lead information</h2>
                <p className="text-xs text-slate-500">
                  Customer and commercial details
                </p>
              </div>
              <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label="Contact" value={lead.contactName} />
                <Stat label="Company" value={lead.companyName} />
                <Stat label="Deal value" value={money(lead.expectedRevenue)} />
                <Stat label="Email" value={lead.email} />
                <Stat label="Phone" value={lead.phone} />
                <Stat label="Owner" value={lead.salesperson?.name} />
                <Stat label="Sales team" value={lead.salesTeam?.name} />
                <Stat label="Source" value={lead.source?.name} />
                <Stat label="Campaign" value={lead.campaign?.name} />
                <Stat label="Created" value={date(lead.createdAt)} />
                <Stat label="Status" value={lead.status} />
                <Stat label="Priority" value={temperature} />
              </div>
              {lead.whatsappSummary?.summary && (
                <div className="border-t">
                  <ConversationSummary summary={lead.whatsappSummary} />
                </div>
              )}
              {lead.notes && (
                <div className="border-t p-5">
                  <h3 className="text-xs font-semibold text-slate-500">
                    Notes
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                    {lead.notes}
                  </p>
                </div>
              )}
            </div>
          )}
          {tab === 'activity' && <TimelineList items={lead.timeline} />}{' '}
          {tab === 'whatsapp' && (
            <WhatsAppPanel leadId={lead._id} phone={lead.phone} />
          )}{' '}
          {tab === 'tasks' && <TaskList items={lead.activities} />}
        </section>
        <aside className="panel h-fit overflow-hidden">
          <div className="border-b p-4">
            <h2 className="font-semibold">Activity timeline</h2>
            <p className="text-xs text-slate-500">
              Notes and customer touchpoints
            </p>
          </div>
          <div className="border-b p-4">
            <label className="label" htmlFor="lead-note">
              Add an internal note
            </label>
            <textarea
              id="lead-note"
              className="field min-h-24 py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Capture context, requirements, or next steps…"
            />
            <div className="mt-2 flex justify-end">
              <Button
                className="btn-primary"
                disabled={!note.trim() || addNote.isPending}
                onClick={() => addNote.mutate()}
              >
                <Send size={14} />
                Post note
              </Button>
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto p-4">
            <TimelineList items={lead.timeline.slice(0, 8)} compact />
          </div>
        </aside>
      </main>
    </>
  );
}
function Action({
  icon,
  label,
  href,
  missingMessage,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  missingMessage: string;
}) {
  return href ? (
    <a className="btn" href={href}>
      {icon}
      {label}
    </a>
  ) : (
    <button type="button" className="btn" onClick={() => alert(missingMessage)}>
      {icon}
      {label}
    </button>
  );
}

export function WhatsAppPanel({
  leadId,
  phone,
}: {
  leadId: string;
  phone?: string;
}) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [instruction, setInstruction] = useState('');
  const [composer, setComposer] = useState<'message' | 'template' | null>(null);
  const [templateId, setTemplateId] = useState('');
  const conversation = useQuery({
    queryKey: ['lead-whatsapp', leadId],
    queryFn: () => api<WhatsAppConversation>(`/leads/${leadId}/whatsapp`),
    // Customer messages arrive through Meta's webhook, so poll while the chat is open to show them without a reload.
    refetchInterval: 5000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lead-whatsapp', leadId] });
    qc.invalidateQueries({ queryKey: ['lead', leadId] });
  };
  const mode = useMutation({
    mutationFn: (next: 'human' | 'ai') =>
      api(`/leads/${leadId}/whatsapp/mode`, {
        method: 'PATCH',
        body: JSON.stringify({ mode: next }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['lead-whatsapp', leadId] }),
  });
  const draft = useMutation({
    mutationFn: () =>
      api<{ message: string }>(`/leads/${leadId}/whatsapp/draft`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      }),
    onSuccess: (result) => setMessage(result.message),
  });
  const send = useMutation({
    mutationFn: () =>
      api(`/leads/${leadId}/whatsapp/send`, {
        method: 'POST',
        body: JSON.stringify({
          body: message,
          mode: conversation.data?.mode ?? 'human',
        }),
      }),
    onSuccess: () => {
      setMessage('');
      setInstruction('');
      refresh();
    },
  });
  const sendTemplate = useMutation({
    mutationFn: (template: string) =>
      api(`/leads/${leadId}/whatsapp/send-template`, {
        method: 'POST',
        body: JSON.stringify({ template }),
      }),
    onSuccess: refresh,
  });
  const summarize = useMutation({
    mutationFn: () =>
      api<WhatsAppSummary>(`/leads/${leadId}/whatsapp/summarize`, {
        method: 'POST',
      }),
    onSuccess: refresh,
  });
  if (conversation.isLoading)
    return (
      <div className="panel p-6">
        <Loading />
      </div>
    );
  if (conversation.isError || !conversation.data)
    return (
      <div className="panel p-6 text-sm text-red-700">
        Could not load this WhatsApp conversation.
      </div>
    );
  const data = conversation.data;
  const windowClosed = data.window.tracked && !data.window.open;
  const activeComposer = composer ?? (windowClosed ? 'template' : 'message');
  // CRM templates go out as normal text, so Meta rejects them while the window is closed; only
  // Meta-approved templates can open a conversation. Default to one that can actually be sent.
  const sendable = (item: TemplateOption) =>
    !(windowClosed && item.kind === 'crm');
  const metaTemplates = data.templates.filter((item) => item.kind !== 'crm');
  const crmTemplates = data.templates.filter((item) => item.kind === 'crm');
  const template =
    data.templates.find((item) => item._id === templateId && sendable(item)) ??
    data.templates.find(sendable) ??
    data.templates[0];
  const error =
    draft.error || send.error || sendTemplate.error || summarize.error;
  const summarizeButton = (
    <Button
      disabled={
        !data.aiConfigured || !data.messages.length || summarize.isPending
      }
      title={
        data.aiConfigured
          ? undefined
          : 'Add OPENROUTER_API_KEY on the server to summarize'
      }
      onClick={() => summarize.mutate()}
    >
      <Sparkles size={14} />
      {summarize.isPending
        ? 'Summarizing…'
        : data.summary
          ? 'Refresh'
          : 'Summarize'}
    </Button>
  );
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
          <WhatsAppIcon size={19} />
        </span>
        <div className="mr-auto">
          <h2 className="font-semibold">WhatsApp conversation</h2>
          <p className="text-xs text-slate-500">{phone || 'No phone number'}</p>
        </div>
        {phone && (
          <a
            className="btn"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/${phone.replace(/\D/g, '')}`}
          >
            <WhatsAppIcon size={14} />
            Open WhatsApp
          </a>
        )}
        <div
          className="flex rounded-lg border bg-slate-50 p-1"
          aria-label="Conversation mode"
        >
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${data.mode === 'human' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
            onClick={() => mode.mutate('human')}
            aria-pressed={data.mode === 'human'}
          >
            Human
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${data.mode === 'ai' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-500'}`}
            onClick={() => mode.mutate('ai')}
            aria-pressed={data.mode === 'ai'}
          >
            <Sparkles size={12} className="mr-1 inline" />
            AI bot
          </button>
        </div>
      </div>
      {!data.configured && (
        <div className="border-b border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <b>Meta Cloud API is not configured.</b> AI drafting and mode
          selection work, but CRM sending and automatic replies require the
          WhatsApp environment variables.{' '}
          {phone && (
            <a
              className="ml-1 font-semibold underline"
              target="_blank"
              rel="noreferrer"
              href={`https://wa.me/${phone.replace(/\D/g, '')}`}
            >
              Open WhatsApp manually
            </a>
          )}
        </div>
      )}
      {data.mode === 'ai' && (
        <div className="border-b bg-violet-50 px-4 py-2 text-xs text-violet-800">
          The AI bot replies using the bot agent settings and this lead&apos;s
          CRM facts. It hands the chat back to a person when asked or when it
          can&apos;t answer. Switch to Human at any time to pause it.
        </div>
      )}
      {data.summary ? (
        <ConversationSummary summary={data.summary} action={summarizeButton} />
      ) : (
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <p className="mr-auto text-xs text-slate-500">
            No conversation summary yet. Summaries are saved to this lead and
            its timeline.
          </p>
          {summarizeButton}
        </div>
      )}
      <div className="min-h-40 max-h-[320px] space-y-3 overflow-y-auto bg-slate-50 p-4">
        {data.messages.map((item) => {
          const failure = item.metadata?.whatsappStatus?.errors?.[0];
          return (
            <div
              className={`flex ${item.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              key={item._id}
            >
              <div
                className={`max-w-[82%] rounded-xl px-3 py-2 text-sm ${item.direction === 'outbound' ? 'bg-blue-600 text-white' : 'border bg-white text-slate-800'}`}
              >
                <p className="whitespace-pre-wrap">{item.body}</p>
                <div
                  className={`mt-1 flex gap-2 text-[9px] ${item.direction === 'outbound' ? 'text-blue-100' : 'text-slate-400'}`}
                >
                  <span>
                    {item.mode === 'ai'
                      ? 'AI bot'
                      : item.direction === 'outbound'
                        ? 'Human'
                        : 'Lead'}
                  </span>
                  {item.metadata?.template && (
                    <span>Template {item.metadata.template.name}</span>
                  )}
                  <span>{date(item.createdAt)}</span>
                  <span className="capitalize">{item.status}</span>
                </div>
                {item.status === 'failed' && failure && (
                  <p className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    {failure.message || failure.title}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {!data.messages.length && (
          <Empty
            title="No WhatsApp messages yet"
            detail="Start with an approved template, or reply once the lead messages you."
          />
        )}
      </div>
      <div className="border-t p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-semibold text-slate-800">
            Compose WhatsApp message
          </h3>
          <div className="flex rounded-lg border bg-slate-50 p-1">
            {(['message', 'template'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded-md px-3 py-1 text-xs font-semibold capitalize ${activeComposer === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
                aria-pressed={activeComposer === item}
                onClick={() => setComposer(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {data.window.tracked && (
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${windowClosed ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}
          >
            {windowClosed ? (
              <>
                This contact hasn&apos;t messaged in the last 24 hours, so
                WhatsApp only delivers Meta-approved templates.{' '}
                {metaTemplates.length
                  ? 'Send one to restart the chat — once they reply, free-form messages open for 24 hours.'
                  : "You don't have an approved template yet — create one under WhatsApp → Templates and submit it to Meta."}
                {activeComposer === 'message' && metaTemplates.length > 0 && (
                  <button
                    type="button"
                    className="ml-2 font-semibold underline"
                    onClick={() => setComposer('template')}
                  >
                    Choose a template
                  </button>
                )}
              </>
            ) : (
              `Free-form replies are open until ${new Date(data.window.expiresAt!).toLocaleString()}.`
            )}
          </p>
        )}
        {activeComposer === 'message' ? (
          <>
            {/* A form so pressing Enter in the instruction drafts, same as clicking the button. */}
            <form
              className="mb-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.isPending) draft.mutate();
              }}
            >
              <input
                className="field"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Optional AI instruction, e.g. follow up on the proposal"
              />
              <Button
                type="submit"
                className="btn-primary btn-ai shrink-0 whitespace-nowrap"
                disabled={draft.isPending}
                aria-busy={draft.isPending}
              >
                {draft.isPending ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {draft.isPending ? 'Drafting…' : 'AI draft'}
              </Button>
            </form>
            <textarea
              className="field min-h-24 py-2"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                data.mode === 'ai'
                  ? 'Review or edit the AI-generated reply before sending…'
                  : 'Write a WhatsApp message…'
              }
            />
          </>
        ) : template ? (
          <>
            <select
              className="field"
              aria-label="WhatsApp template"
              value={template._id}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {metaTemplates.length > 0 && (
                <optgroup label="Meta-approved · can start a conversation">
                  {metaTemplates.map((item) => (
                    <option key={item._id} value={item._id}>
                      {`${item.name} (${item.language})`}
                    </option>
                  ))}
                </optgroup>
              )}
              {crmTemplates.length > 0 && (
                <optgroup
                  label={
                    windowClosed
                      ? 'CRM · available after the contact replies'
                      : 'CRM · sent as a normal message'
                  }
                >
                  {crmTemplates.map((item) => (
                    <option
                      key={item._id}
                      value={item._id}
                      disabled={windowClosed}
                    >
                      {`${item.name} (CRM)`}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
              {template.preview}
            </p>
            {template.missing.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                No value for {template.missing.join(', ')}. Fill in this
                lead&apos;s details
                {template.kind === 'crm'
                  ? '.'
                  : ", or map the template's variables under WhatsApp → Templates."}
              </p>
            )}
            {template.kind === 'crm' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="mr-auto text-xs text-slate-500">
                  {windowClosed
                    ? 'CRM templates go out as normal messages, so they need the contact to have messaged in the last 24 hours.'
                    : 'A CRM template: sent as a normal message, not through Meta.'}
                </p>
                <Button
                  onClick={() => {
                    setMessage(template.preview);
                    setComposer('message');
                  }}
                >
                  Edit before sending
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
            {data.pendingTemplates
              ? `${data.pendingTemplates} template${data.pendingTemplates === 1 ? ' is' : 's are'} waiting for Meta approval. They appear here as soon as Meta approves them.`
              : 'No templates yet. An administrator can create CRM templates, or Meta-approved ones for new conversations, under WhatsApp → Templates.'}
          </p>
        )}
        {error && (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {error.message}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-slate-400">
            {activeComposer === 'message'
              ? `${message.length}/4096 · Messages are never sent without a configured provider.`
              : template?.kind === 'crm'
                ? "CRM templates are filled with this lead's details and sent as a normal message."
                : 'Templates are pre-approved by Meta and can start a conversation.'}
          </span>
          {activeComposer === 'message' ? (
            <Button
              className="btn-primary"
              disabled={
                !data.configured ||
                !phone ||
                windowClosed ||
                !message.trim() ||
                send.isPending
              }
              onClick={() => send.mutate()}
            >
              <Send size={14} />
              {send.isPending ? 'Sending…' : 'Send WhatsApp'}
            </Button>
          ) : (
            <Button
              className="btn-primary"
              disabled={
                !data.configured ||
                !phone ||
                !template ||
                template.missing.length > 0 ||
                (template.kind === 'crm' && windowClosed) ||
                sendTemplate.isPending
              }
              onClick={() => template && sendTemplate.mutate(template._id)}
            >
              <Send size={14} />
              {sendTemplate.isPending ? 'Sending…' : 'Send template'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
const sentimentStyle = {
  positive: 'bg-emerald-50 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  negative: 'bg-red-50 text-red-700',
};
export function ConversationSummary({
  summary,
  action,
}: {
  summary: WhatsAppSummary;
  action?: React.ReactNode;
}) {
  const facts = [
    ['Intent', summary.intent],
    ['Budget', summary.budget],
    ['Timeline', summary.timeline],
    ['Next step', summary.nextStep],
  ].filter(([, value]) => value);
  return (
    <div className="border-b bg-white p-4 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={14} className="text-violet-600" />
        <h3 className="text-sm font-semibold">WhatsApp summary</h3>
        {summary.sentiment && (
          <span
            className={`badge capitalize ${sentimentStyle[summary.sentiment]}`}
          >
            {summary.sentiment}
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          Updated {date(summary.generatedAt)}
        </span>
        {action}
      </div>
      <p className="mt-2 text-sm text-slate-700">{summary.summary}</p>
      {facts.length > 0 && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!summary.requirements?.length && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summary.requirements.map((item) => (
            <span key={item} className="badge bg-indigo-50 text-indigo-700">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium capitalize text-slate-800">
        {value || '—'}
      </div>
    </div>
  );
}
function TimelineList({
  items,
  compact = false,
}: {
  items: Timeline[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'panel p-5'}>
      {items.length ? (
        items.map((item) => (
          <div
            className="relative ml-3 flex gap-4 border-l border-slate-200 pb-6 pl-6 last:pb-0"
            key={item._id}
          >
            <span className="absolute -left-3 top-0">
              <Avatar name={item.createdBy?.name} size={24} />
            </span>
            <div>
              <div className="text-xs">
                <b>{item.createdBy?.name || 'System'}</b>
                <span className="ml-2 text-slate-400">
                  {date(item.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{item.message}</p>
            </div>
          </div>
        ))
      ) : (
        <Empty
          title="No activity yet"
          detail="Notes and changes will appear here."
        />
      )}
    </div>
  );
}
function TaskList({ items }: { items: Activity[] }) {
  return (
    <div className="panel overflow-hidden">
      {items.length ? (
        items.map((item) => (
          <div
            className="flex items-center gap-3 border-b p-4 last:border-0"
            key={item._id}
          >
            <span
              className={`grid h-9 w-9 place-items-center rounded-lg ${item.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}
            >
              {item.status === 'completed' ? (
                <CheckCircle2 size={17} />
              ) : (
                <CalendarPlus size={17} />
              )}
            </span>
            <div>
              <b className="text-sm">{item.summary}</b>
              <p className="text-xs text-slate-500">
                {item.activityType?.name} · {date(item.dueDate)}
              </p>
            </div>
          </div>
        ))
      ) : (
        <Empty
          title="No tasks for this lead"
          detail="Schedule a follow-up to keep momentum."
        />
      )}
    </div>
  );
}
