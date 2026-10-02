import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { Button, Loading } from '../components/ui';
import { api } from '../lib/api';

type BotSettings = {
  enabled: boolean;
  businessName: string;
  persona: string;
  businessInfo: string;
  faq: string;
  guardrails: string;
  handoffKeywords: string[];
  handoffMessage: string;
  autoSummarize: boolean;
};

export function WhatsAppBotSettings({ isAdmin }: { isAdmin: boolean }) {
  const settings = useQuery({
    queryKey: ['whatsapp-bot'],
    queryFn: () => api<BotSettings>('/whatsapp/bot'),
  });
  if (settings.isLoading)
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  if (settings.isError || !settings.data)
    return (
      <div className="panel p-6 text-sm text-red-700">
        Could not load the bot settings.
      </div>
    );
  return <BotForm initial={settings.data} isAdmin={isAdmin} />;
}

function BotForm({
  initial,
  isAdmin,
}: {
  initial: BotSettings;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [keywords, setKeywords] = useState(initial.handoffKeywords.join(', '));
  const save = useMutation({
    mutationFn: () =>
      api<BotSettings>('/whatsapp/bot', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          handoffKeywords: keywords
            .split(',')
            .map((word) => word.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: (saved) => qc.setQueryData(['whatsapp-bot'], saved),
  });
  const set = (patch: Partial<BotSettings>) => {
    save.reset();
    setForm({ ...form, ...patch });
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <fieldset disabled={!isAdmin} className="panel space-y-5 p-5">
        <legend className="sr-only">Bot agent settings</legend>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.enabled}
            onChange={(event) => set({ enabled: event.target.checked })}
          />
          <span>
            <b className="block text-sm">Bot replies automatically</b>
            <span className="text-xs text-slate-500">
              Applies to leads switched to AI bot mode. Turn off to pause every
              bot conversation at once.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">Business name</span>
            <input
              className="field"
              value={form.businessName}
              onChange={(event) => set({ businessName: event.target.value })}
              maxLength={120}
            />
          </label>
          <label>
            <span className="label">Persona and tone</span>
            <input
              className="field"
              value={form.persona}
              onChange={(event) => set({ persona: event.target.value })}
              maxLength={500}
              placeholder="A friendly, concise sales assistant"
            />
          </label>
        </div>
        <label className="block">
          <span className="label">Business facts</span>
          <textarea
            className="field min-h-32 py-2"
            value={form.businessInfo}
            onChange={(event) => set({ businessInfo: event.target.value })}
            maxLength={6000}
            placeholder="Products and services, opening hours, locations, delivery areas, and any prices you are happy for the bot to share."
          />
        </label>
        <label className="block">
          <span className="label">FAQ</span>
          <textarea
            className="field min-h-32 py-2"
            value={form.faq}
            onChange={(event) => set({ faq: event.target.value })}
            maxLength={6000}
            placeholder={
              'Q: Do you offer installation?\nA: Yes, installation is included in every city we serve.'
            }
          />
        </label>
        <label className="block">
          <span className="label">Rules the bot must follow</span>
          <textarea
            className="field min-h-20 py-2"
            value={form.guardrails}
            onChange={(event) => set({ guardrails: event.target.value })}
            maxLength={2000}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">Hand off when the customer says</span>
            <input
              className="field"
              value={keywords}
              onChange={(event) => {
                save.reset();
                setKeywords(event.target.value);
              }}
              placeholder="human, agent, call me"
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              Comma-separated words or phrases.
            </span>
          </label>
          <label>
            <span className="label">Handoff reply</span>
            <textarea
              className="field min-h-20 py-2"
              value={form.handoffMessage}
              onChange={(event) => set({ handoffMessage: event.target.value })}
              maxLength={1000}
            />
          </label>
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.autoSummarize}
            onChange={(event) => set({ autoSummarize: event.target.checked })}
          />
          <span>
            <b className="block text-sm">
              Summarize conversations into the CRM
            </b>
            <span className="text-xs text-slate-500">
              Saves a summary, intent, requirements, budget and next step on the
              lead after every few messages and on each handoff.
            </span>
          </span>
        </label>
        {isAdmin && (
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {save.isError && (
              <span className="mr-auto text-xs text-red-700">
                {save.error.message}
              </span>
            )}
            {save.isSuccess && (
              <span className="mr-auto text-xs text-emerald-700">Saved.</span>
            )}
            <Button
              className="btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save bot settings'}
            </Button>
          </div>
        )}
      </fieldset>
      <aside className="panel h-fit p-5 text-sm text-slate-600">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600">
          <Bot size={19} />
        </span>
        <h2 className="mt-3 font-semibold text-slate-900">How the bot works</h2>
        <ul className="mt-2 list-disc space-y-2 pl-4 text-xs">
          <li>
            It only replies to leads switched to AI bot mode on their WhatsApp
            tab.
          </li>
          <li>
            Replies use these settings, the lead&apos;s CRM details and the last
            12 messages. It is told not to invent prices, dates or promises.
          </li>
          <li>
            When a customer uses a handoff phrase, or the bot can&apos;t answer,
            the lead switches to Human mode and its owner is notified.
          </li>
          <li>
            Bot replies go out as free-form text, which WhatsApp allows within
            24 hours of the customer&apos;s last message.
          </li>
        </ul>
        {!isAdmin && (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs">
            Only administrators can change these settings.
          </p>
        )}
      </aside>
    </div>
  );
}
