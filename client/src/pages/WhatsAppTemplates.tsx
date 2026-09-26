import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button, Empty, Loading, Modal, RowMenu } from "../components/ui";
import { api, date } from "../lib/api";

export type WhatsAppTemplate = {
  _id: string;
  // 'crm' templates never go to Meta and are sent as ordinary text; older records have no kind and are Meta templates.
  kind?: "meta" | "crm";
  name: string;
  language: string;
  category?: string;
  status: string;
  statusReason?: string;
  header?: string;
  body: string;
  footer?: string;
  variables?: string[];
  unsupportedReason?: string;
  active: boolean;
  metaId?: string;
  syncedAt?: string;
};
type Status = { templateSyncConfigured: boolean };
type SyncResult = {
  synced: number;
  removed: number;
  starters: number;
  created: string[];
  failed: { name: string; error: string }[];
};

export const placeholderCount = (body: string) =>
  Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])));
export const isCrmTemplate = (template: WhatsAppTemplate) => template.kind === "crm";
export const sendable = (template: WhatsAppTemplate) =>
  template.active && (isCrmTemplate(template) || (template.status === "APPROVED" && !template.unsupportedReason));
const tokens = ["{contactName}", "{companyName}", "{title}", "{ownerName}"];
const statusStyle: Record<string, string> = {
  APPROVED: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  DRAFT: "bg-slate-100 text-slate-600",
};

function syncMessage(result: SyncResult) {
  const parts = [`Pulled ${result.synced} template${result.synced === 1 ? "" : "s"} from Meta`];
  if (result.starters) parts.push(`created ${result.starters} starter template${result.starters === 1 ? "" : "s"}`);
  if (result.created.length) parts.push(`submitted ${result.created.join(", ")} for approval`);
  if (result.removed) parts.push(`${result.removed} no longer in Meta`);
  return `${parts.join("; ")}.`;
}

export function WhatsAppTemplates({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState<"crm" | "meta" | null>(null);
  const templates = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: () => api<WhatsAppTemplate[]>("/whatsappTemplates"),
  });
  const status = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => api<Status>("/whatsapp/status"),
  });
  const sync = useMutation({
    mutationFn: () => api<SyncResult>("/whatsapp/templates/sync", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["whatsapp-templates"] }),
  });
  const canSync = status.data?.templateSyncConfigured;
  const crm = (templates.data ?? []).filter(isCrmTemplate);
  const meta = (templates.data ?? []).filter((template) => !isCrmTemplate(template));
  const syncButton = (label: string) => (
    <Button
      className="btn-primary"
      disabled={!canSync || sync.isPending}
      title={canSync ? undefined : "Add WHATSAPP_BUSINESS_ACCOUNT_ID to server/.env to sync"}
      onClick={() => sync.mutate()}
    >
      <RefreshCw size={15} className={sync.isPending ? "animate-spin" : ""} />
      {sync.isPending ? "Syncing…" : label}
    </Button>
  );
  if (templates.isLoading)
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <div className="mr-auto max-w-2xl">
            <h2 className="font-semibold">CRM templates</h2>
            <p className="mt-1 text-xs text-slate-500">
              Ready-made replies kept only in the CRM. They are not sent to
              Meta and need no approval, and go out as normal messages, so they
              only reach contacts who messaged you in the last 24 hours. Use
              fields such as {tokens.join(", ")} to fill in lead details.
            </p>
          </div>
          {isAdmin && (
            <Button className="btn-primary" onClick={() => setCreating("crm")}>
              <Plus size={15} />
              New CRM template
            </Button>
          )}
        </div>
        {crm.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {crm.map((template) => (
              <CrmTemplateCard key={template._id} template={template} isAdmin={isAdmin} />
            ))}
          </div>
        ) : (
          <div className="panel">
            <Empty
              title="No CRM templates yet"
              detail={isAdmin ? "Create one for replies your team sends often." : "An administrator can create reusable replies here."}
            />
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <div className="mr-auto max-w-2xl">
            <h2 className="font-semibold">WhatsApp approved templates</h2>
            <p className="mt-1 text-xs text-slate-500">
              Needed to start a conversation, or to message someone who
              hasn&apos;t written in 24 hours. These are submitted to Meta and
              can be sent once approved (usually within minutes). Sync also
              brings in templates made in Meta WhatsApp Manager.
            </p>
          </div>
          {isAdmin && (
            <>
              <Button onClick={() => setCreating("meta")}>
                <Plus size={15} />
                New approved template
              </Button>
              {syncButton("Sync with Meta")}
            </>
          )}
          {sync.data && (
            <div className="w-full space-y-1 text-xs" role="status">
              <p className="text-emerald-700">{syncMessage(sync.data)}</p>
              {sync.data.failed.map((item) => (
                <p key={item.name} className="text-red-700">
                  {item.name} was not accepted by Meta: {item.error}
                </p>
              ))}
            </div>
          )}
          {sync.error && <p className="w-full text-xs text-red-700" role="alert">{sync.error.message}</p>}
          {isAdmin && status.data && !canSync && (
            <p className="w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Submitting and syncing need <b>WHATSAPP_ACCESS_TOKEN</b> and{" "}
              <b>WHATSAPP_BUSINESS_ACCOUNT_ID</b> in server/.env. Approved
              templates you create now are saved as drafts and submitted on the
              next sync.
            </p>
          )}
        </div>
        {meta.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {meta.map((template) => (
              // Keyed on the body so a re-synced template resets its placeholder inputs.
              <TemplateCard key={template._id + template.body} template={template} isAdmin={isAdmin} />
            ))}
          </div>
        ) : (
          <div className="panel flex flex-col items-center gap-3 p-8 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <Sparkles size={20} />
            </span>
            <h3 className="font-semibold">No approved templates yet</h3>
            <p className="max-w-md text-xs text-slate-500">
              {isAdmin
                ? "Sync to bring in your Meta templates. If Meta has none either, the CRM creates a welcome and a follow-up template and submits them for approval."
                : "An administrator needs to sync or create templates before you can message new leads."}
            </p>
            {isAdmin && syncButton("Sync and create starter templates")}
          </div>
        )}
      </section>
      {creating === "crm" && <CrmTemplateForm onClose={() => setCreating(null)} />}
      {creating === "meta" && <NewTemplate onClose={() => setCreating(null)} />}
      <datalist id="whatsapp-template-tokens">
        {tokens.map((token) => (
          <option key={token} value={token} />
        ))}
      </datalist>
    </div>
  );
}

function CrmTemplateCard({ template, isAdmin }: { template: WhatsAppTemplate; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
  const patch = useMutation({
    mutationFn: (body: Partial<WhatsAppTemplate>) =>
      api(`/whatsappTemplates/${template._id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api(`/whatsappTemplates/${template._id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return (
    <article className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <b className="mr-auto truncate text-sm">{template.name}</b>
        <span className="badge bg-blue-50 text-blue-700">CRM only</span>
        {isAdmin && (
          <RowMenu
            busy={remove.isPending}
            onDelete={() => {
              if (confirm(`Delete the CRM template ${template.name}?`)) remove.mutate();
            }}
          />
        )}
      </div>
      <div className="space-y-3 p-4">
        <p className="whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">{template.body}</p>
        {patch.isError && <p className="text-xs text-red-700">{patch.error.message}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="mr-auto flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              disabled={!isAdmin || patch.isPending}
              checked={template.active}
              onChange={(event) => patch.mutate({ active: event.target.checked })}
            />
            Available to send
          </label>
          {isAdmin && (
            <Button onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
        </div>
      </div>
      {editing && <CrmTemplateForm template={template} onClose={() => setEditing(false)} />}
    </article>
  );
}

function CrmTemplateForm({ template, onClose }: { template?: WhatsAppTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const save = useMutation({
    mutationFn: () =>
      api(template ? `/whatsappTemplates/${template._id}` : "/whatsappTemplates", {
        method: template ? "PATCH" : "POST",
        body: JSON.stringify(template ? { name, body } : { kind: "crm", name, body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      onClose();
    },
  });
  return (
    <Modal title={template ? "Edit CRM template" : "New CRM template"} onClose={onClose}>
      <div className="space-y-4 p-5">
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Stays in the CRM and is never sent to Meta. It goes out as a normal
          message, so it only reaches contacts who messaged in the last 24 hours.
        </p>
        <label className="block">
          <span className="label">Name</span>
          <input className="field" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Share price list" />
        </label>
        <label className="block">
          <span className="label">Message</span>
          <textarea
            className="field min-h-32 py-2"
            maxLength={4096}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Hi {contactName}, thanks for your interest! Here is our price list…"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">Insert:</span>
          {tokens.map((token) => (
            <button key={token} type="button" className="badge bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={() => setBody(`${body}${token}`)}>
              {token}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t p-4">
        {save.isError && <span className="mr-auto text-xs text-red-700">{save.error.message}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button className="btn-primary" disabled={name.trim().length < 2 || !body.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : template ? "Save changes" : "Create template"}
        </Button>
      </div>
    </Modal>
  );
}

function VariableFields({
  count,
  values,
  disabled,
  onChange,
}: {
  count: number;
  values: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  if (!count) return null;
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="label">Fill placeholders with</legend>
      {Array.from({ length: count }, (_, index) => (
        <label key={index} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-xs font-semibold text-slate-500">{`{{${index + 1}}}`}</span>
          <input
            className="field"
            list="whatsapp-template-tokens"
            value={values[index] ?? ""}
            placeholder="e.g. {contactName}"
            onChange={(event) =>
              onChange(Array.from({ length: count }, (_, i) => (i === index ? event.target.value : values[i] ?? "")))
            }
          />
        </label>
      ))}
      <p className="text-[11px] text-slate-400">
        Use {tokens.join(", ")} or plain text. A placeholder that comes out empty
        for a lead blocks sending to that lead.
      </p>
    </fieldset>
  );
}

function TemplateCard({ template, isAdmin }: { template: WhatsAppTemplate; isAdmin: boolean }) {
  const qc = useQueryClient();
  const count = placeholderCount(template.body);
  const [variables, setVariables] = useState(() =>
    Array.from({ length: count }, (_, index) => template.variables?.[index] ?? ""),
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
  const patch = useMutation({
    mutationFn: (body: Partial<WhatsAppTemplate>) =>
      api(`/whatsappTemplates/${template._id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
  const submit = useMutation({
    mutationFn: () => api(`/whatsapp/templates/${template._id}/submit`, { method: "POST" }),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api(`/whatsappTemplates/${template._id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const saved = variables.every((value, index) => value === (template.variables?.[index] ?? ""));
  const error = patch.error || submit.error;
  return (
    <article className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <b className="mr-auto truncate text-sm">{template.name}</b>
        <span className="badge bg-slate-100 text-slate-600">{template.language}</span>
        {template.category && (
          <span className="badge bg-slate-100 capitalize text-slate-600">{template.category.toLowerCase()}</span>
        )}
        <span className={`badge capitalize ${statusStyle[template.status] ?? "bg-red-50 text-red-700"}`}>
          {template.status.toLowerCase().replace(/_/g, " ")}
        </span>
        {isAdmin && (
          <RowMenu
            busy={remove.isPending}
            onDelete={() => {
              const message = template.metaId
                ? `Remove ${template.name} from the CRM? It stays in Meta and returns on the next sync.`
                : `Delete the draft ${template.name}?`;
              if (confirm(message)) remove.mutate();
            }}
          />
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
          {template.header && <b className="mb-1 block">{template.header}</b>}
          {template.body}
          {template.footer && <span className="mt-1 block text-xs text-slate-400">{template.footer}</span>}
        </div>
        {template.status === "PENDING" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Waiting for Meta to approve it. It becomes available to send as soon
            as Meta approves it (the webhook or the next sync updates it).
          </p>
        )}
        {template.status === "DRAFT" && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Not in Meta yet{template.statusReason ? ` — last attempt failed: ${template.statusReason}` : ""}.
          </p>
        )}
        {template.status !== "DRAFT" && template.statusReason && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            Meta: {template.statusReason.toLowerCase().replace(/_/g, " ")}
          </p>
        )}
        {template.unsupportedReason && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            Can&apos;t be sent from the CRM: {template.unsupportedReason}.
          </p>
        )}
        <VariableFields count={count} values={variables} disabled={!isAdmin} onChange={setVariables} />
        {error && <p className="text-xs text-red-700">{error.message}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="mr-auto flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              disabled={!isAdmin || patch.isPending}
              checked={template.active}
              onChange={(event) => patch.mutate({ active: event.target.checked })}
            />
            Available to send
          </label>
          <span className="text-[10px] text-slate-400">
            {template.syncedAt ? `Updated from Meta ${date(template.syncedAt)}` : "Created in the CRM"}
          </span>
          {isAdmin && count > 0 && (
            <Button disabled={saved || patch.isPending} onClick={() => patch.mutate({ variables })}>
              {patch.isPending ? "Saving…" : "Save mapping"}
            </Button>
          )}
          {isAdmin && template.status === "DRAFT" && (
            <Button className="btn-primary" disabled={submit.isPending || !saved} onClick={() => submit.mutate()}>
              <Send size={14} />
              {submit.isPending ? "Submitting…" : "Submit to Meta"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function NewTemplate({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", language: "en_US", category: "UTILITY", header: "", body: "", footer: "" });
  const [variables, setVariables] = useState<string[]>([]);
  const count = placeholderCount(form.body);
  const create = useMutation({
    mutationFn: () =>
      api<WhatsAppTemplate>("/whatsappTemplates", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          name: form.name.trim().toLowerCase(),
          header: form.header || undefined,
          footer: form.footer || undefined,
          variables: variables.slice(0, count),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      onClose();
    },
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  return (
    <Modal title="New WhatsApp approved template" onClose={onClose}>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Saving submits the template to Meta for approval. Its wording can&apos;t
          be changed afterwards, so check it before saving.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="sm:col-span-3">
            <span className="label">Template name</span>
            <input
              className="field"
              value={form.name}
              onChange={(event) => set({ name: event.target.value.replace(/[\s-]+/g, "_") })}
              placeholder="e.g. lead_welcome"
            />
            <span className="mt-1 block text-[11px] text-slate-400">Lower-case letters, numbers and underscores.</span>
          </label>
          <label>
            <span className="label">Language code</span>
            <input className="field" value={form.language} onChange={(event) => set({ language: event.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Category</span>
            <select className="field" value={form.category} onChange={(event) => set({ category: event.target.value })}>
              <option value="UTILITY">Utility: follow-ups on a customer&apos;s enquiry</option>
              <option value="MARKETING">Marketing: offers and promotions</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label">Header (optional)</span>
          <input className="field" maxLength={60} value={form.header} onChange={(event) => set({ header: event.target.value })} />
        </label>
        <label className="block">
          <span className="label">Body</span>
          <textarea
            className="field min-h-28 py-2"
            maxLength={1024}
            value={form.body}
            onChange={(event) => set({ body: event.target.value })}
            placeholder="Hi {{1}}, thanks for your enquiry. When is a good time to talk?"
          />
          <span className="mt-1 block text-[11px] text-slate-400">
            Add {"{{1}}"}, {"{{2}}"}… where lead details go. The body can&apos;t start or end with one.
          </span>
        </label>
        <VariableFields count={count} values={variables} onChange={setVariables} />
        <label className="block">
          <span className="label">Footer (optional)</span>
          <input className="field" maxLength={60} value={form.footer} onChange={(event) => set({ footer: event.target.value })} />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t p-4">
        {create.isError && <span className="mr-auto text-xs text-red-700">{create.error.message}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button
          className="btn-primary"
          disabled={!form.name.trim() || !form.body.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Submitting…" : "Create and submit"}
        </Button>
      </div>
    </Modal>
  );
}
