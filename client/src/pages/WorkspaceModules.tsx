import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Mail,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { api, date } from '../lib/api';
import { PageHeader } from '../components/Shell';
import { Button, Empty, Loading, Modal, RowMenu } from '../components/ui';
import type { Lead, Paged } from '../lib/types';

type Communication = {
  _id: string;
  channel: 'email' | 'whatsapp' | 'call';
  direction: string;
  status: string;
  subject?: string;
  body?: string;
  sender?: string;
  recipient?: string;
  createdAt: string;
  lead?: { _id: string; title: string; contactName?: string } | null;
  canDelete: boolean;
};
type ProviderStatus = { whatsapp: boolean; email: boolean };
export function Inbox() {
  const [composing, setComposing] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['communications'],
    queryFn: () => api<Communication[]>('/communications'),
  });
  const providers = useQuery({
    queryKey: ['messaging-status'],
    queryFn: () => api<ProviderStatus>('/messaging/status'),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/communications/${id}`, { method: 'DELETE' }),
    onMutate: () => setFeedback(null),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Inbox message deleted.' });
      qc.invalidateQueries({ queryKey: ['communications'] });
    },
    onError: (cause: any) =>
      setFeedback({
        kind: 'error',
        message: cause?.message ?? 'Could not delete this inbox message.',
      }),
  });
  const status = providers.data,
    canSend = Boolean(status?.whatsapp || status?.email);
  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Customer communication across configured providers"
      >
        <Button
          className="btn-primary"
          disabled={!canSend}
          title={
            canSend
              ? 'Message a lead'
              : 'Configure email or WhatsApp before sending'
          }
          onClick={() => setComposing(true)}
        >
          <Plus size={15} />
          Compose
        </Button>
      </PageHeader>
      {status && <ProviderNotice status={status} />}{' '}
      {feedback && (
        <div
          role="status"
          className={`border-b px-4 py-2 text-xs ${feedback.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}
        >
          {feedback.message}
        </div>
      )}
      <div className="p-4 sm:p-6">
        {q.isLoading ? (
          <Loading />
        ) : q.data?.length ? (
          <div className="panel overflow-hidden">
            {q.data.map((item) => {
              const row = (
                <>
                  <ChannelIcon channel={item.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2">
                      <b className="truncate text-sm">
                        {item.subject ||
                          item.body ||
                          `${item.channel} activity`}
                      </b>
                      <span className="badge bg-slate-100 capitalize text-slate-600">
                        {item.status}
                      </span>
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {item.lead
                        ? `${item.lead.contactName || item.lead.title} · `
                        : ''}
                      {item.direction === 'inbound'
                        ? item.sender
                        : item.recipient}{' '}
                      · {date(item.createdAt)}
                    </p>
                  </div>
                </>
              );
              return (
                <div
                  className="flex items-center border-b pr-4 last:border-0 hover:bg-slate-50"
                  key={item._id}
                >
                  {item.lead ? (
                    <Link
                      className="flex min-w-0 flex-1 items-center gap-4 p-4"
                      to={`/leads/${item.lead._id}${item.channel === 'whatsapp' ? '?tab=whatsapp' : ''}`}
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-4 p-4">
                      {row}
                    </div>
                  )}
                  {item.canDelete && (
                    <RowMenu
                      label="Delete message"
                      busy={remove.isPending}
                      onDelete={() => {
                        if (
                          confirm(
                            'Delete this inbox message? This cannot be undone.',
                          )
                        )
                          remove.mutate(item._id);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="panel">
            <Empty
              title="No conversations yet"
              detail={
                canSend
                  ? 'Use Compose to message a lead.'
                  : 'Connect an email or WhatsApp provider to send and receive messages.'
              }
            />
          </div>
        )}
      </div>
      {composing && status && (
        <ComposeModal status={status} onClose={() => setComposing(false)} />
      )}
    </>
  );
}
function ComposeModal({
  status,
  onClose,
}: {
  status: ProviderStatus;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [channel, setChannel] = useState<'whatsapp' | 'email'>(
    status.whatsapp ? 'whatsapp' : 'email',
  );
  const [search, setSearch] = useState('');
  const [lead, setLead] = useState<Lead | null>(null);
  const leads = useQuery({
    queryKey: ['compose-leads', search],
    queryFn: () =>
      api<Paged<Lead>>(`/leads?limit=8&search=${encodeURIComponent(search)}`),
  });
  const contact = (item: Lead) =>
    channel === 'email' ? item.email : item.phone;
  if (lead)
    return (
      <Modal
        title={`Email ${lead.contactName || lead.title}`}
        width="max-w-lg"
        onClose={onClose}
      >
        <EmailForm lead={lead} onBack={() => setLead(null)} onSent={onClose} />
      </Modal>
    );
  return (
    <Modal title="New message" width="max-w-md" onClose={onClose}>
      <div className="p-4">
        {status.whatsapp && status.email && (
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1 text-xs font-semibold">
            {(['whatsapp', 'email'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded px-3 py-1.5 ${channel === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                onClick={() => setChannel(value)}
              >
                {value === 'email' ? 'Email' : 'WhatsApp'}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 rounded-md border px-3 py-2">
          <Search size={15} className="text-slate-400" />
          <input
            autoFocus
            className="w-full text-sm outline-none"
            placeholder={`Search leads by name, company or ${channel === 'email' ? 'email' : 'phone'}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="mt-3 max-h-80 overflow-auto">
          {leads.isLoading ? (
            <Loading />
          ) : leads.data?.data.length ? (
            leads.data.data.map((item) => (
              <button
                key={item._id}
                type="button"
                disabled={!contact(item)}
                title={
                  contact(item)
                    ? undefined
                    : `Add ${channel === 'email' ? 'an email address' : 'a phone number'} to this lead first`
                }
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40"
                onClick={() =>
                  channel === 'email'
                    ? setLead(item)
                    : nav(`/leads/${item._id}?tab=whatsapp`)
                }
              >
                <span className="min-w-0">
                  <b className="block truncate text-sm">
                    {item.contactName || item.title}
                  </b>
                  <span className="block truncate text-xs text-slate-500">
                    {item.companyName || item.title}
                  </span>
                </span>
                <span className="shrink-0 truncate text-xs text-slate-500">
                  {contact(item) ||
                    (channel === 'email' ? 'No email' : 'No phone')}
                </span>
              </button>
            ))
          ) : (
            <Empty title="No leads found" detail="Try a different search." />
          )}
        </div>
      </div>
    </Modal>
  );
}
function EmailForm({
  lead,
  onBack,
  onSent,
}: {
  lead: Lead;
  onBack: () => void;
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api(`/leads/${lead._id}/email`, {
        method: 'POST',
        body: JSON.stringify({ subject, body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['communications'] });
      qc.invalidateQueries({ queryKey: ['lead', lead._id] });
      onSent();
    },
  });
  return (
    <form
      className="space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <p className="text-xs text-slate-500">
        To <b className="text-slate-700">{lead.email}</b> · replies come back to
        your own email
      </p>
      <input
        required
        maxLength={200}
        className="w-full rounded-md border px-3 py-2 text-sm outline-none"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        required
        maxLength={20000}
        rows={8}
        className="w-full rounded-md border px-3 py-2 text-sm outline-none"
        placeholder="Write your message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {send.isError && (
        <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
          {send.error.message}
        </p>
      )}
      <div className="flex justify-between">
        <Button type="button" onClick={onBack}>
          <ArrowLeft size={15} />
          Back
        </Button>
        <Button
          className="btn-primary"
          disabled={send.isPending || !subject.trim() || !body.trim()}
        >
          <Send size={15} />
          {send.isPending ? 'Sending…' : 'Send email'}
        </Button>
      </div>
    </form>
  );
}
function ProviderNotice({ status }: { status: ProviderStatus }) {
  if (status.whatsapp && status.email) return null;
  const missing =
    !status.whatsapp && !status.email
      ? 'Provider setup required'
      : !status.whatsapp
        ? 'WhatsApp not configured'
        : 'Email not configured';
  const detail = [
    !status.whatsapp &&
      'Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to send and receive WhatsApp messages.',
    !status.email && 'Set SMTP_HOST, SMTP_PORT and SMTP_FROM to email leads.',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex gap-3 border-b border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 sm:px-6">
      <ShieldCheck className="shrink-0" size={18} />
      <div>
        <b>{missing}</b>
        <p className="mt-0.5 text-blue-700">
          {detail} Add them to the server environment and restart the API.
        </p>
      </div>
    </div>
  );
}
function ChannelIcon({ channel }: { channel: string }) {
  const Icon =
    channel === 'email' ? Mail : channel === 'whatsapp' ? WhatsAppIcon : Phone;
  return (
    <span className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
      <Icon size={18} />
    </span>
  );
}

type AIStatus = { configured: boolean; provider: string; model: string };
type ActionPlan = {
  overview: string;
  priorities: {
    title: string;
    reason: string;
    action: string;
    urgency: 'high' | 'medium' | 'low';
  }[];
  generatedAt: string;
};
export function AIAssistant() {
  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api<AIStatus>('/ai/status'),
  });
  const plan = useMutation({
    mutationFn: () => api<ActionPlan>('/ai/action-plan', { method: 'POST' }),
  });
  const ready = status.data?.configured;
  return (
    <>
      <PageHeader
        title="AI Assistant"
        subtitle="Grounded sales suggestions based only on CRM data"
      >
        <span
          className={`badge ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {ready ? 'OpenRouter connected' : 'Setup required'}
        </span>
      </PageHeader>
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="panel overflow-hidden">
          <div className="border-b bg-indigo-50 p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 text-white">
              <Sparkles size={20} />
            </span>
            <h2 className="mt-4 text-lg font-semibold">
              OpenRouter sales copilot
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Uses only CRM records visible to you. Suggestions remain separate
              from stored customer facts.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Model: {status.data?.model ?? 'openrouter/free'}
            </p>
          </div>
          {!ready && !status.isLoading && (
            <div className="border-b border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
              Add <b>OPENROUTER_API_KEY</b> to server/.env and restart the API.
            </div>
          )}
          <div className="p-6">
            <Button
              className="btn-primary"
              disabled={!ready || plan.isPending}
              onClick={() => plan.mutate()}
            >
              <Sparkles size={15} />
              {plan.isPending
                ? 'Building action plan…'
                : 'Generate today’s action plan'}
            </Button>
            {plan.isError && (
              <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                {plan.error.message}
              </p>
            )}
            {plan.data && (
              <div className="mt-6">
                <h3 className="font-semibold">Today’s plan</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {plan.data.overview}
                </p>
                <div className="mt-4 grid gap-3">
                  {plan.data.priorities.map((item, index) => (
                    <article
                      className="rounded-xl border p-4"
                      key={`${item.title}-${index}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                          {index + 1}
                        </span>
                        <b className="text-sm">{item.title}</b>
                        <span
                          className={`badge ml-auto ${item.urgency === 'high' ? 'bg-red-50 text-red-700' : item.urgency === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                        >
                          {item.urgency}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {item.reason}
                      </p>
                      <p className="mt-2 text-sm font-medium text-blue-700">
                        {item.action}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
