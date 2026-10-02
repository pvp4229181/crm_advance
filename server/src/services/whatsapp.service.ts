import {
  Communication,
  User,
  WhatsAppBot,
  WhatsAppTemplate,
} from '../models/index.js';
import {
  metaTemplates,
  starterTemplateNames,
} from '../seed/whatsappTemplates.js';
import { ApiError } from '../utils/http.js';

export const whatsappConfig = () => ({
  configured: Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  ),
  provider: 'meta-cloud-api' as const,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ? 'configured' : null,
  webhookConfigured: Boolean(
    process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET,
  ),
  templateSyncConfigured: Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  ),
});

const graphUrl = (path: string) =>
  `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${path}`;
const authHeader = () => ({
  Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
});

async function postMessage(to: string, message: Record<string, unknown>) {
  const config = whatsappConfig();
  if (!config.configured)
    throw new ApiError(
      503,
      'WhatsApp is not configured. Add the Meta Cloud API credentials in server/.env.',
    );
  const recipient = to.replace(/\D/g, '');
  if (recipient.length < 8)
    throw new ApiError(
      422,
      'This lead needs a valid international phone number',
    );
  const response = await fetch(
    graphUrl(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`),
    {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        ...message,
      }),
    },
  );
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      502,
      result?.error?.error_data?.details ||
        result?.error?.message ||
        'WhatsApp could not send this message',
    );
  return String(result?.messages?.[0]?.id ?? '');
}

export const sendWhatsAppText = (to: string, body: string) =>
  postMessage(to, { type: 'text', text: { preview_url: false, body } });

// Meta only delivers free-form text within 24 hours of the customer's last message; outside it only
// approved templates go through. The window belongs to the phone number, not to a CRM record.
const WINDOW_MS = 24 * 60 * 60 * 1000;
export async function conversationWindow(phone?: string) {
  const tracked = whatsappConfig().webhookConfigured,
    digits = String(phone ?? '')
      .replace(/\D/g, '')
      .slice(-10);
  const last: any =
    digits.length < 8
      ? null
      : await Communication.findOne({
          channel: 'whatsapp',
          direction: 'inbound',
          sender: { $regex: `${digits}$` },
        })
          .sort('-createdAt')
          .select('createdAt')
          .lean();
  const expiresAt = last
    ? new Date(new Date(last.createdAt).getTime() + WINDOW_MS)
    : null;
  return {
    tracked,
    open: Boolean(expiresAt && expiresAt > new Date()),
    expiresAt,
  };
}
// Without the webhook we never see inbound messages, so the window is unknown and sending is left to Meta.
export async function assertWindowOpen(phone?: string) {
  const window = await conversationWindow(phone);
  if (window.tracked && !window.open)
    throw new ApiError(
      422,
      'The 24-hour WhatsApp window is closed because this contact has not messaged in the last 24 hours. Send an approved template instead.',
    );
}

const TOKEN = /\{(title|contactName|companyName|ownerName)\}/g;
export const TOKEN_NAMES = ['contactName', 'companyName', 'title', 'ownerName'];
export const placeholderCount = (body: string) =>
  Math.max(
    0,
    ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])),
  );
// Meta rejects parameters containing newlines, tabs, or more than four consecutive spaces.
const cleanParameter = (value: string) =>
  value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();

/**
 * Fills a template for one record. Meta templates resolve each {{n}} from the variable mapping; CRM templates resolve
 * {contactName}-style fields in the body. `missing` names whatever came out empty, e.g. "{{2}}" or "{companyName}".
 */
export async function renderTemplate(template: any, record: any) {
  const variables: string[] = template.variables ?? [];
  let ownerName = record.salesperson?.name;
  if (
    ownerName === undefined &&
    record.salesperson &&
    [template.body, ...variables].some((value) =>
      String(value).includes('{ownerName}'),
    )
  )
    ownerName = (
      (await User.findById(record.salesperson).select('name').lean()) as any
    )?.name;
  const tokens: Record<string, unknown> = {
    title: record.title,
    contactName: record.contactName,
    companyName: record.companyName,
    ownerName,
  };
  const fill = (text: string) =>
    text.replace(TOKEN, (_match, key: string) =>
      String(tokens[key] ?? '').trim(),
    );
  if (template.kind === 'crm') {
    const missing = [
      ...new Set(
        [...template.body.matchAll(TOKEN)]
          .filter((match: any) => !String(tokens[match[1]] ?? '').trim())
          .map((match: any) => match[0] as string),
      ),
    ];
    return {
      values: [] as string[],
      missing,
      text: fill(template.body).trim(),
    };
  }
  const values = Array.from(
    { length: placeholderCount(template.body) },
    (_, index) => cleanParameter(fill(variables[index] ?? '')),
  );
  const missing = values.flatMap((value, index) =>
    value ? [] : [`{{${index + 1}}}`],
  );
  const body = template.body.replace(
    /\{\{(\d+)\}\}/g,
    (match: string, n: string) => values[Number(n) - 1] || match,
  );
  return {
    values,
    missing,
    text: [template.header, body, template.footer].filter(Boolean).join('\n\n'),
  };
}

/** Rejects fields the CRM cannot fill, including Meta-style {{1}} placeholders that would otherwise go out literally. */
export function crmTemplateProblem(body: string) {
  if (/\{\{/.test(body))
    return 'CRM templates use fields such as {contactName}, not {{1}} placeholders';
  const unknown = [
    ...new Set(
      [...body.matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .filter((name) => !TOKEN_NAMES.includes(name!)),
    ),
  ];
  return unknown.length
    ? `Unknown field ${unknown.map((name) => `{${name}}`).join(', ')}. Use ${TOKEN_NAMES.map((name) => `{${name}}`).join(', ')}`
    : undefined;
}

/** CRM-only templates go out as ordinary text, so like any typed message they need the 24-hour window. */
export async function deliverTemplate(
  to: string,
  template: any,
  rendered: { values: string[]; text: string },
) {
  if (template.kind === 'crm') {
    await assertWindowOpen(to);
    return sendWhatsAppText(to, rendered.text);
  }
  return sendWhatsAppTemplate(to, template, rendered.values);
}

export async function sendWhatsAppTemplate(
  to: string,
  template: any,
  values: string[],
) {
  if (template.status !== 'APPROVED')
    throw new ApiError(
      422,
      `Template “${template.name}” is ${String(template.status).toLowerCase()} in Meta and cannot be sent`,
    );
  if (template.unsupportedReason)
    throw new ApiError(
      422,
      `Template “${template.name}” cannot be sent from the CRM: ${template.unsupportedReason}`,
    );
  return postMessage(to, {
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      components: values.length
        ? [
            {
              type: 'body',
              parameters: values.map((text) => ({ type: 'text', text })),
            },
          ]
        : [],
    },
  });
}

// Only body {{n}} parameters are sent, so anything needing other parameters is stored but marked unsendable.
function unsupportedReason(template: any, components: any[]) {
  const header = components.find((part) => part.type === 'HEADER'),
    body = components.find((part) => part.type === 'BODY');
  if (template.category === 'AUTHENTICATION')
    return 'Authentication templates are not supported';
  if (
    components.some(
      (part) => !['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(part.type),
    )
  )
    return 'This template layout is not supported';
  if (header && header.format !== 'TEXT')
    return `${String(header.format).toLowerCase()} headers are not supported`;
  if (header?.text?.includes('{{')) return 'Header variables are not supported';
  if (/\{\{\s*[^\d\s}]/.test(body?.text ?? ''))
    return 'Named parameters are not supported; use numbered {{1}} parameters';
  const buttons =
    components.find((part) => part.type === 'BUTTONS')?.buttons ?? [];
  if (
    buttons.some(
      (button: any) =>
        String(button.url ?? '').includes('{{') ||
        ['COPY_CODE', 'OTP', 'FLOW', 'CATALOG', 'MPM'].includes(button.type),
    )
  )
    return 'Buttons that need parameters are not supported';
  return undefined;
}

// Sample values Meta requires alongside every {{n}} when reviewing a new template.
const SAMPLES: Record<string, string> = {
  title: 'Website enquiry',
  contactName: 'Asha',
  companyName: 'Acme Traders',
  ownerName: 'Ravi',
};
const metaError = (result: any, fallback: string) =>
  result?.error?.error_user_msg ||
  result?.error?.error_data?.details ||
  result?.error?.message ||
  fallback;

/** Checks the rules Meta enforces on new templates, so the admin gets a precise reason instead of a generic rejection. */
export function templateProblem(body: string, variables: string[] = []) {
  if (/\{\{\s*[^\d\s}]/.test(body))
    return 'Use numbered placeholders such as {{1}}, not named ones';
  const used = [
    ...new Set(
      [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])),
    ),
  ].sort((a, b) => a - b);
  if (used.some((n, index) => n !== index + 1))
    return 'Number placeholders in order starting at {{1}}, without gaps';
  if (/^\{\{\d+\}\}/.test(body.trim()) || /\{\{\d+\}\}$/.test(body.trim()))
    return 'WhatsApp does not allow the body to start or end with a placeholder';
  const missing = used.filter((n) => !variables[n - 1]?.trim());
  if (missing.length)
    return `Choose what fills ${missing.map((n) => `{{${n}}}`).join(', ')}`;
  return undefined;
}

/** Submits a CRM template to Meta for approval and records the id and status Meta returns. */
export async function submitWhatsAppTemplate(template: any) {
  if (!whatsappConfig().templateSyncConfigured)
    throw new ApiError(
      503,
      'Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID to server/.env to submit templates to Meta.',
    );
  if (template.kind === 'crm')
    throw new ApiError(
      422,
      `“${template.name}” is a CRM-only template and is not sent to Meta`,
    );
  if (template.metaId)
    throw new ApiError(409, `Template “${template.name}” is already in Meta`);
  const problem = templateProblem(template.body, template.variables);
  if (problem) throw new ApiError(422, problem);
  const examples = Array.from(
    { length: placeholderCount(template.body) },
    (_, index) =>
      cleanParameter(
        String(template.variables?.[index] ?? '').replace(
          TOKEN,
          (_match: string, key: string) => SAMPLES[key] ?? '',
        ),
      ) || 'sample',
  );
  const components: any[] = [];
  if (template.header)
    components.push({ type: 'HEADER', format: 'TEXT', text: template.header });
  components.push({
    type: 'BODY',
    text: template.body,
    ...(examples.length ? { example: { body_text: [examples] } } : {}),
  });
  if (template.footer)
    components.push({ type: 'FOOTER', text: template.footer });
  const response = await fetch(
    graphUrl(`${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`),
    {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.name,
        language: template.language,
        category: template.category || 'UTILITY',
        components,
      }),
    },
  );
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    await WhatsAppTemplate.updateOne(
      { _id: template._id },
      {
        $set: {
          statusReason: metaError(result, 'Meta rejected this template'),
        },
      },
    );
    throw new ApiError(
      422,
      metaError(result, 'Meta could not create this template'),
    );
  }
  // Meta may move the template to a different category than requested; keep what it decided.
  return WhatsAppTemplate.findByIdAndUpdate(
    template._id,
    {
      $set: {
        metaId: String(result.id),
        status: result.status || 'PENDING',
        category: result.category || template.category,
        syncedAt: new Date(),
      },
      $unset: { statusReason: 1 },
    },
    { new: true },
  ).lean();
}

// Created when Meta and the CRM have no approved-template candidates, so there is always a way to open a conversation.
const starterTemplates = (business: string) =>
  metaTemplates(business).filter((template) =>
    starterTemplateNames.includes(template.name),
  );

// Meta sends these through the webhook when it reviews a template; REINSTATED means it can be sent again.
export async function applyTemplateStatus(value: any) {
  const event = String(value?.event ?? '');
  if (!value?.message_template_id || !event) return;
  const reason =
    value.reason && value.reason !== 'NONE' ? String(value.reason) : undefined;
  await WhatsAppTemplate.updateOne(
    { metaId: String(value.message_template_id) },
    reason
      ? {
          $set: {
            status: event === 'REINSTATED' ? 'APPROVED' : event,
            statusReason: reason,
          },
        }
      : {
          $set: { status: event === 'REINSTATED' ? 'APPROVED' : event },
          $unset: { statusReason: 1 },
        },
  );
}

/** Two-way sync: pulls Meta's templates, submits CRM templates Meta does not have, and seeds starters when there are none. */
export async function syncWhatsAppTemplates() {
  const account = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!whatsappConfig().templateSyncConfigured)
    throw new ApiError(
      503,
      'Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID to server/.env to sync templates.',
    );
  const seen: string[] = [],
    syncedAt = new Date();
  let url: string | null = graphUrl(
    `${account}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`,
  );
  while (url) {
    const response: Response = await fetch(url, { headers: authHeader() });
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new ApiError(
        502,
        result?.error?.message || 'Meta could not list the message templates',
      );
    for (const template of result.data ?? []) {
      const components: any[] = template.components ?? [],
        text = (type: string) =>
          components.find((part) => part.type === type)?.text as
            string | undefined;
      const header = components.find((part) => part.type === 'HEADER');
      const reason =
        template.rejected_reason && template.rejected_reason !== 'NONE'
          ? String(template.rejected_reason)
          : undefined;
      await WhatsAppTemplate.updateOne(
        { name: template.name, language: template.language },
        {
          $set: {
            metaId: template.id,
            category: template.category,
            status: template.status,
            header: header?.format === 'TEXT' ? header.text : undefined,
            body: text('BODY') || '(no body text)',
            footer: text('FOOTER'),
            unsupportedReason: unsupportedReason(template, components),
            syncedAt,
            ...(reason ? { statusReason: reason } : {}),
          },
          ...(reason ? {} : { $unset: { statusReason: 1 } }),
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
      seen.push(template.id);
    }
    url = result.paging?.next ?? null;
  }
  // Templates deleted in Meta keep their CRM record so workflows that point at them fail with a clear reason.
  const removed = await WhatsAppTemplate.updateMany(
    { metaId: { $exists: true, $nin: seen }, status: { $ne: 'DELETED' } },
    { $set: { status: 'DELETED', syncedAt } },
  );
  let starters = 0;
  if (
    !(await WhatsAppTemplate.countDocuments({
      kind: { $ne: 'crm' },
      status: { $ne: 'DELETED' },
    }))
  ) {
    const bot: any = await WhatsAppBot.findOne({ key: 'default' }).lean();
    for (const template of starterTemplates(bot?.businessName ?? ''))
      if (
        !(await WhatsAppTemplate.exists({
          name: template.name,
          language: template.language,
        }))
      ) {
        await WhatsAppTemplate.create(template);
        starters++;
      }
  }
  const created: string[] = [],
    failed: { name: string; error: string }[] = [];
  for (const template of await WhatsAppTemplate.find({
    kind: { $ne: 'crm' },
    metaId: { $exists: false },
  }).lean()) {
    try {
      await submitWhatsAppTemplate(template);
      created.push(template.name);
    } catch (error) {
      failed.push({
        name: template.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return {
    synced: seen.length,
    removed: removed.modifiedCount,
    starters,
    created,
    failed,
  };
}
