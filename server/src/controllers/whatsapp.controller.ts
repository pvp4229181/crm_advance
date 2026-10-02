import { normalizePhone, phoneSuffix } from '../utils/phone.js';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import {
  Communication,
  Lead,
  TimelineEvent,
  WhatsAppBot,
  WhatsAppTemplate,
  WebhookJob,
} from '../models/index.js';
import { accessScope } from '../middleware/auth.js';
import { ApiError } from '../utils/http.js';
import {
  crmTemplateInput,
  crmTemplatePatch,
  objectId,
  whatsappBotInput,
  whatsappTemplateInput,
  whatsappTemplatePatch,
} from '../validators/index.js';
import { aiConfig } from '../services/ai.service.js';
import {
  applyTemplateStatus,
  assertWindowOpen,
  conversationWindow,
  crmTemplateProblem,
  deliverTemplate,
  submitWhatsAppTemplate,
  templateProblem,
  renderTemplate,
  sendWhatsAppText,
  syncWhatsAppTemplates,
  whatsappConfig,
} from '../services/whatsapp.service.js';
import {
  autoSummarize,
  botSettings,
  draftReply,
  handOff,
  summarizeConversation,
  wantsHuman,
} from '../services/whatsappBot.service.js';

export function status(_req: Request, res: Response) {
  res.json(whatsappConfig());
}
async function accessibleLead(req: Request, id: string) {
  const lead = await Lead.findOne({ _id: id, ...accessScope(req) })
    .populate('salesperson', 'name')
    .lean();
  if (!lead) throw new ApiError(404, 'Lead not found');
  return lead;
}
const sendableTemplates = () =>
  WhatsAppTemplate.find({
    active: true,
    unsupportedReason: { $in: [null, ''] },
    $or: [{ kind: 'crm' }, { status: 'APPROVED' }],
  })
    .sort('name')
    .lean();
export async function conversation(req: Request, res: Response) {
  const lead: any = await accessibleLead(req, String(req.params.id));
  const [messages, window, templates, pendingTemplates] = await Promise.all([
    Communication.find({
      channel: 'whatsapp',
      relatedModel: 'Lead',
      relatedId: lead._id,
    })
      .sort('createdAt')
      .limit(250)
      .lean(),
    conversationWindow(lead.phone),
    sendableTemplates(),
    WhatsAppTemplate.countDocuments({
      active: true,
      kind: { $ne: 'crm' },
      status: { $in: ['DRAFT', 'PENDING'] },
    }),
  ]);
  const options = await Promise.all(
    templates.map(async (template: any) => {
      const rendered = await renderTemplate(template, lead);
      return {
        _id: template._id,
        kind: template.kind ?? 'meta',
        name: template.name,
        language: template.language,
        category: template.category,
        preview: rendered.text,
        missing: rendered.missing,
      };
    }),
  );
  res.json({
    mode: lead.communicationMode ?? 'human',
    configured: whatsappConfig().configured,
    aiConfigured: aiConfig().configured,
    phone: lead.phone ?? null,
    messages,
    window,
    summary: lead.whatsappSummary?.summary ? lead.whatsappSummary : null,
    templates: options,
    pendingTemplates,
  });
}
export async function setMode(req: Request, res: Response) {
  const mode = String(req.body.mode ?? '');
  if (!['human', 'ai'].includes(mode))
    throw new ApiError(422, 'Mode must be human or ai');
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, ...accessScope(req) },
    { communicationMode: mode, updatedBy: req.user!._id },
    { new: true },
  );
  if (!lead) throw new ApiError(404, 'Lead not found');
  await TimelineEvent.create({
    createdBy: req.user!._id,
    relatedModel: 'Lead',
    relatedId: lead._id,
    eventType: 'whatsapp_mode_changed',
    message: `WhatsApp changed to ${mode === 'ai' ? 'AI bot' : 'human'} mode`,
  });
  res.json({ mode });
}
export async function draft(req: Request, res: Response) {
  const lead = await accessibleLead(req, String(req.params.id));
  const reply = await draftReply(lead, String(req.body.instruction ?? ''));
  res.json({ message: reply.message, provider: 'openrouter' });
}
export async function send(req: Request, res: Response) {
  const lead: any = await accessibleLead(req, String(req.params.id));
  const body = String(req.body.body ?? '').trim(),
    mode = req.body.mode === 'ai' ? 'ai' : 'human';
  if (!body || body.length > 4096)
    throw new ApiError(
      422,
      'Message must contain between 1 and 4,096 characters',
    );
  if (!lead.phone)
    throw new ApiError(422, 'Add a phone number to this lead first');
  await assertWindowOpen(lead.phone);
  const providerMessageId = await sendWhatsAppText(lead.phone, body);
  const message = await Communication.create({
    channel: 'whatsapp',
    direction: 'outbound',
    mode,
    provider: 'meta-cloud-api',
    providerMessageId,
    status: 'sent',
    body,
    relatedModel: 'Lead',
    relatedId: lead._id,
    sender: process.env.WHATSAPP_BUSINESS_NUMBER,
    recipient: lead.phone,
    createdBy: req.user!._id,
  });
  await TimelineEvent.create({
    createdBy: req.user!._id,
    relatedModel: 'Lead',
    relatedId: lead._id,
    eventType: 'whatsapp_sent',
    message: `WhatsApp message sent in ${mode} mode`,
  });
  res.status(201).json(message);
}
export async function sendTemplate(req: Request, res: Response) {
  const lead: any = await accessibleLead(req, String(req.params.id));
  if (!lead.phone)
    throw new ApiError(422, 'Add a phone number to this lead first');
  const id = objectId.safeParse(req.body.template);
  const template: any = id.success
    ? await WhatsAppTemplate.findOne({ _id: id.data, active: true }).lean()
    : null;
  if (!template) throw new ApiError(404, 'WhatsApp template not found');
  const rendered = await renderTemplate(template, lead);
  if (rendered.missing.length)
    throw new ApiError(
      422,
      `Template “${template.name}” has no value for ${rendered.missing.join(', ')}. Fill in this lead's details${template.kind === 'crm' ? '' : ', or map the template’s variables under WhatsApp → Templates'}.`,
    );
  const providerMessageId = await deliverTemplate(
    lead.phone,
    template,
    rendered,
  );
  const message = await Communication.create({
    channel: 'whatsapp',
    direction: 'outbound',
    mode: 'human',
    provider: 'meta-cloud-api',
    providerMessageId,
    status: 'sent',
    body: rendered.text,
    relatedModel: 'Lead',
    relatedId: lead._id,
    sender: process.env.WHATSAPP_BUSINESS_NUMBER,
    recipient: lead.phone,
    metadata: {
      template: {
        id: template._id,
        name: template.name,
        language: template.language,
      },
    },
    createdBy: req.user!._id,
  });
  await TimelineEvent.create({
    createdBy: req.user!._id,
    relatedModel: 'Lead',
    relatedId: lead._id,
    eventType: 'whatsapp_sent',
    message: `WhatsApp template “${template.name}” sent`,
  });
  res.status(201).json(message);
}
export async function summarize(req: Request, res: Response) {
  const lead: any = await accessibleLead(req, String(req.params.id));
  res.json(await summarizeConversation(lead._id, req.user!._id));
}
export async function getBot(_req: Request, res: Response) {
  res.json(await botSettings());
}
export async function updateBot(req: Request, res: Response) {
  const body = whatsappBotInput.parse(req.body);
  res.json(
    await WhatsAppBot.findOneAndUpdate(
      { key: 'default' },
      { ...body, updatedBy: req.user!._id },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    ),
  );
}
export async function syncTemplates(_req: Request, res: Response) {
  res.json(await syncWhatsAppTemplates());
}
/** Creates the template in the CRM and submits it to Meta straight away; without Meta credentials it stays a draft for the next sync. */
export async function createTemplate(req: Request, res: Response) {
  if (req.body?.kind === 'crm') {
    const input = crmTemplateInput.parse(req.body);
    const problem = crmTemplateProblem(input.body);
    if (problem) throw new ApiError(422, problem);
    if (await WhatsAppTemplate.exists({ name: input.name, language: 'crm' }))
      throw new ApiError(
        409,
        `A CRM template named “${input.name}” already exists`,
      );
    return res.status(201).json(
      await WhatsAppTemplate.create({
        ...input,
        kind: 'crm',
        language: 'crm',
        status: 'READY',
        createdBy: req.user!._id,
      }),
    );
  }
  const input = whatsappTemplateInput.parse(req.body);
  const problem = templateProblem(input.body, input.variables);
  if (problem) throw new ApiError(422, problem);
  if (
    await WhatsAppTemplate.exists({
      name: input.name,
      language: input.language,
    })
  )
    throw new ApiError(
      409,
      `A “${input.name}” template in ${input.language} already exists`,
    );
  const template = await WhatsAppTemplate.create({
    ...input,
    status: 'DRAFT',
    createdBy: req.user!._id,
  });
  if (!whatsappConfig().templateSyncConfigured)
    return res.status(201).json(template);
  // A draft Meta refused would only fail again on every sync, so it is removed and the admin fixes the wording.
  try {
    res.status(201).json(await submitWhatsAppTemplate(template));
  } catch (error) {
    await WhatsAppTemplate.deleteOne({ _id: template._id });
    throw error;
  }
}
/** Meta templates only change their CRM-side mapping; CRM templates are free to edit because nothing outside holds a copy. */
export async function updateTemplate(req: Request, res: Response) {
  const id = objectId.safeParse(req.params.id);
  const template: any = id.success
    ? await WhatsAppTemplate.findById(id.data).lean()
    : null;
  if (!template) throw new ApiError(404, 'WhatsApp template not found');
  const body: any =
    template.kind === 'crm'
      ? crmTemplatePatch.parse(req.body)
      : whatsappTemplatePatch.partial().parse(req.body);
  if (template.kind === 'crm') {
    const problem = body.body && crmTemplateProblem(body.body);
    if (problem) throw new ApiError(422, problem);
    if (
      body.name &&
      (await WhatsAppTemplate.exists({
        _id: { $ne: template._id },
        name: body.name,
        language: 'crm',
      }))
    )
      throw new ApiError(
        409,
        `A CRM template named “${body.name}” already exists`,
      );
  }
  res.json(
    await WhatsAppTemplate.findByIdAndUpdate(template._id, body, {
      new: true,
      runValidators: true,
    }),
  );
}
export async function submitTemplate(req: Request, res: Response) {
  const id = objectId.safeParse(req.params.id);
  const template = id.success
    ? await WhatsAppTemplate.findById(id.data).lean()
    : null;
  if (!template) throw new ApiError(404, 'WhatsApp template not found');
  res.json(await submitWhatsAppTemplate(template));
}

export function verifyWebhook(req: Request, res: Response) {
  const mode = req.query['hub.mode'],
    token = req.query['hub.verify_token'],
    challenge = req.query['hub.challenge'];
  if (
    mode === 'subscribe' &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  )
    return res.status(200).send(String(challenge ?? ''));
  res.sendStatus(403);
}
export async function receiveWebhook(req: Request, res: Response) {
  if (!validSignature(req)) return res.sendStatus(401);
  const id = crypto
    .createHash('sha256')
    .update((req as any).rawBody)
    .digest('hex');
  await WebhookJob.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        payload: req.body,
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true },
  );
  // A 200 means the work is durably stored. Local polling and the cron endpoint recover failed runs.
  res.sendStatus(200);
  waitUntil(
    drainWebhookJobs(id).catch((error) =>
      console.error('WhatsApp webhook processing failed', error),
    ),
  );
}
function validSignature(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET,
    signature = req.header('x-hub-signature-256');
  if (!secret || !signature || !(req as any).rawBody) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update((req as any).rawBody)
    .digest('hex')}`;
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}
// Quick-reply buttons on templates arrive as 'button' or 'interactive' messages rather than 'text'.
const incomingText = (incoming: any): string | undefined =>
  incoming.type === 'text'
    ? incoming.text?.body
    : incoming.type === 'button'
      ? incoming.button?.text
      : incoming.type === 'interactive'
        ? (incoming.interactive?.button_reply?.title ??
          incoming.interactive?.list_reply?.title)
        : undefined;
/** Replies in AI mode and returns true when the conversation was handed to a person. */
async function botReply(
  lead: any,
  text: string,
  from: string,
  businessNumber?: string,
) {
  if (lead.communicationMode !== 'ai' || !whatsappConfig().configured)
    return false;
  const bot = await botSettings();
  if (!bot.enabled) return false;
  try {
    let body: string,
      handoff = '';
    if (wantsHuman(bot, text)) {
      handoff = 'the customer asked for a person';
      body = bot.handoffMessage;
    } else {
      const reply = await draftReply(
        lead,
        'Reply to the newest customer message.',
      );
      body = reply.message;
      if (reply.handoff) {
        handoff = reply.reason || 'the question is outside what the bot knows';
        body = bot.handoffMessage || reply.message;
      }
    }
    if (body) {
      const providerMessageId = await sendWhatsAppText(from, body);
      await Communication.create({
        channel: 'whatsapp',
        direction: 'outbound',
        mode: 'ai',
        provider: 'meta-cloud-api',
        providerMessageId,
        status: 'sent',
        body,
        relatedModel: 'Lead',
        relatedId: lead._id,
        sender: businessNumber,
        recipient: from,
      });
    }
    if (handoff) await handOff(lead, handoff);
    return Boolean(handoff);
  } catch (error) {
    // A silent failure would leave the customer unanswered, so a person takes over instead.
    console.error('WhatsApp bot reply failed', error);
    await handOff(
      lead,
      `the bot could not reply (${error instanceof Error ? error.message : 'unknown error'})`,
    ).catch(console.error);
    return true;
  }
}
export async function processWebhook(payload: any) {
  for (const entry of payload?.entry ?? [])
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (change?.field === 'message_template_status_update') {
        await applyTemplateStatus(value);
        continue;
      }
      for (const status of value?.statuses ?? []) {
        if (!status.id) continue;
        await Communication.updateOne(
          { provider: 'meta-cloud-api', providerMessageId: status.id },
          {
            $set: {
              status: ['sent', 'delivered', 'read', 'failed'].includes(
                status.status,
              )
                ? status.status
                : 'sent',
              'metadata.whatsappStatus': status,
            },
          },
        );
      }
      for (const incoming of value?.messages ?? []) {
        if (
          typeof incoming.id !== 'string' ||
          typeof incoming.from !== 'string'
        )
          continue;
        const from = normalizePhone(incoming.from);
        if (from.length < 7) continue;
        const text = incomingText(incoming);
        let candidates = await Lead.find({ normalizedPhone: from })
          .limit(2)
          .lean();
        if (!candidates.length)
          candidates = await Lead.find({ phoneSuffix: phoneSuffix(from) })
            .limit(2)
            .lean();
        // Ambiguous phone matches must never send customer data to the wrong record.
        if (candidates.length !== 1) continue;
        const lead: any = candidates[0];
        let result: any;
        try {
          result = await Communication.findOneAndUpdate(
            { provider: 'meta-cloud-api', providerMessageId: incoming.id },
            {
              $setOnInsert: {
                channel: 'whatsapp',
                direction: 'inbound',
                mode: lead.communicationMode ?? 'human',
                status: 'received',
                body: text ?? `[${incoming.type} message]`,
                relatedModel: 'Lead',
                relatedId: lead._id,
                sender: from,
                recipient: value?.metadata?.display_phone_number,
                metadata: {
                  timestamp: incoming.timestamp,
                  type: incoming.type,
                  replyState: 'pending',
                },
              },
            },
            { upsert: true, new: true, includeResultMetadata: true },
          );
        } catch (error: any) {
          if (error.code === 11000) continue;
          throw error;
        }
        const message = result.value;
        if (message.metadata?.replyState === 'completed') continue;
        const claimed = await Communication.findOneAndUpdate(
          { _id: message._id, 'metadata.replyState': 'pending' },
          {
            $set: {
              'metadata.replyState': 'processing',
              'metadata.replyStartedAt': new Date(),
            },
          },
          { new: true },
        );
        if (!claimed) {
          if (
            message.metadata?.replyState === 'processing' &&
            new Date(message.metadata.replyStartedAt).getTime() <
              Date.now() - 5 * 60 * 1000
          ) {
            // Sending and persisting a provider acknowledgement cannot be atomic. A person resolves uncertain sends.
            await handOff(
              lead,
              'a previous message reply was interrupted; please check the conversation before replying',
            );
            await Communication.updateOne(
              { _id: message._id },
              { $set: { 'metadata.replyState': 'completed' } },
            );
          }
          continue;
        }
        const handedOff = text
          ? await botReply(
              lead,
              text,
              from,
              value?.metadata?.display_phone_number,
            )
          : false;
        await Communication.updateOne(
          { _id: message._id },
          { $set: { 'metadata.replyState': 'completed' } },
        );
        await autoSummarize(lead, handedOff);
      }
    }
}

export async function drainWebhookJobs(id?: string) {
  let processed = 0;
  // ponytail: bounded Mongo-backed worker; move to a dedicated queue if throughput requires it.
  for (let index = 0; index < 10; index++) {
    const now = new Date();
    const job = await WebhookJob.findOneAndUpdate(
      {
        ...(id ? { _id: id } : {}),
        attempts: { $lt: 5 },
        $or: [
          {
            status: { $in: ['pending', 'failed'] },
            nextAttemptAt: { $lte: now },
          },
          {
            status: 'processing',
            lockedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
          },
        ],
      },
      { $set: { status: 'processing', lockedAt: now }, $inc: { attempts: 1 } },
      { new: true, sort: { nextAttemptAt: 1 } },
    ).lean();
    if (!job) break;
    try {
      await processWebhook(job.payload);
      await WebhookJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'completed',
            expiresAt: new Date(Date.now() + 30 * 86400000),
          },
          $unset: { lastError: 1, lockedAt: 1 },
        },
      );
      processed++;
    } catch (error) {
      await WebhookJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            lastError:
              error instanceof Error ? error.message : 'Processing failed',
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
            ),
          },
          $unset: { lockedAt: 1 },
        },
      );
      console.error('WhatsApp job failed', error);
    }
  }
  return processed;
}
