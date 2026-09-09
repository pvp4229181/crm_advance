import type { Request, Response } from 'express';
import { ActivityType, Campaign, Company, Contact, IntakeChannel, Lead, LeadSource, Medium, Opportunity, TimelineEvent } from '../models/index.js';
import { hashApiKey, newApiKey } from '../middleware/apiKey.js';
import { ingestLead } from '../services/ingestion.service.js';
import { createActivityWithRelations, resolveActivityRelations, type ActivityRelatedModel } from '../services/activity.service.js';
import { rescoreLead } from '../services/scoring.service.js';
import { ZodError } from 'zod';
import { channelInput, inboundEmailInput, inboundWhatsappInput, publicLeadInput } from '../validators/index.js';
import { ApiError } from '../utils/http.js';

// A channel's own name/campaign/medium arrive as free text from outside (a webhook body, a CSV
// column) rather than picked from a dropdown, so they're matched or created by name here instead
// of failing validation - the same list an admin curates under Configuration just grows to match.
async function resolveByName(model: typeof LeadSource | typeof Medium | typeof Campaign, name: unknown) {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const doc = await model.findOneAndUpdate({ name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { $setOnInsert: { name: name.trim(), active: true } }, { upsert: true, new: true });
  return doc._id;
}

export async function listChannels(_req: Request, res: Response) {
  res.json(await IntakeChannel.find({}).populate('source medium campaign salesTeam', 'name').sort('-createdAt'));
}

// select:false only hides a field on documents that come back from a query - a document just
// created or saved in-process still carries it in memory, so it has to be stripped by hand here
// before the raw key (deliberately included, once) goes out in the same response.
const withoutHash = (channel: any) => { const data = channel.toObject(); delete data.apiKeyHash; return data; };

export async function createChannel(req: Request, res: Response) {
  const input = channelInput.parse(req.body);
  const key = newApiKey();
  const channel = await IntakeChannel.create({ ...input, apiKeyHash: hashApiKey(key), keyPreview: key.slice(-4), createdBy: req.user!._id, active: true });
  // The raw key is only ever shown once, at creation - only its hash and last 4 characters persist.
  res.status(201).json({ ...withoutHash(await channel.populate('source medium campaign salesTeam', 'name')), apiKey: key });
}

export async function rotateChannel(req: Request, res: Response) {
  const channel = await IntakeChannel.findById(req.params.id);
  if (!channel) throw new ApiError(404, 'Channel not found');
  const key = newApiKey();
  channel.apiKeyHash = hashApiKey(key); channel.keyPreview = key.slice(-4);
  await channel.save();
  res.json({ ...withoutHash(channel), apiKey: key });
}

export async function updateChannel(req: Request, res: Response) {
  const channel = await IntakeChannel.findByIdAndUpdate(req.params.id, { active: Boolean(req.body.active) }, { new: true });
  if (!channel) throw new ApiError(404, 'Channel not found');
  res.json(channel);
}

export async function deleteChannel(req: Request, res: Response) {
  const channel = await IntakeChannel.findByIdAndDelete(req.params.id);
  if (!channel) throw new ApiError(404, 'Channel not found');
  res.status(204).end();
}

// Public intake: no session cookie, authenticated by requireIntakeKey via the channel's API key.
// This is the single door every external source (a form, a webhook forwarder standing in for
// WhatsApp/Facebook/Instagram/Google Ads, a chatbot, or a bespoke integration) posts a lead through.
export async function receiveLead(req: Request, res: Response) {
  const input = publicLeadInput.parse(req.body);
  const channel = req.intakeChannel!;
  const [source, medium, campaign] = await Promise.all([resolveByName(LeadSource, input.source), resolveByName(Medium, input.medium), resolveByName(Campaign, input.campaign)]);
  const { lead, duplicate } = await ingestLead({ ...input, source: source ?? undefined, medium: medium ?? undefined, campaign: campaign ?? undefined }, { channel });
  res.status(duplicate ? 200 : 201).json({ duplicate, lead: { _id: lead._id, title: lead.title, score: lead.score, status: lead.status } });
}

// A "Name <email>" From header is the norm for inbound mail, but a bare address shows up too
// (some inbound-parse providers strip the display name before forwarding).
function parseFromHeader(raw: string) {
  const match = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (match) return { name: match[1]!.trim().replace(/^"|"$/g, '') || undefined, email: match[2]!.trim() };
  return { name: undefined, email: raw.trim() };
}

// Inbound email capture: authenticated the same way as receiveLead (a per-channel API key), but
// pointed at whichever field names the mail provider's inbound webhook happens to send instead of
// a fixed shape - SendGrid's Inbound Parse, Mailgun Routes, and Postmark's inbound webhook each
// use their own names for "who sent it" and "what did it say".
function pickField(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) { const value = body[key]; if (typeof value === 'string' && value.trim()) return value; }
  return undefined;
}
export async function receiveEmail(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const input = inboundEmailInput.parse({
    from: pickField(body, 'from', 'From', 'sender'),
    subject: pickField(body, 'subject', 'Subject'),
    text: pickField(body, 'text', 'body-plain', 'stripped-text', 'TextBody', 'plain'),
  });
  const { name, email } = parseFromHeader(input.from);
  const channel = req.intakeChannel!;
  const { lead, duplicate } = await ingestLead({ title: input.subject, contactName: name, email, notes: input.text }, { channel });
  res.status(duplicate ? 200 : 201).json({ duplicate, lead: { _id: lead._id, title: lead.title, score: lead.score, status: lead.status } });
}

// Inbound WhatsApp capture: same per-channel API key door as receiveLead/receiveEmail, pointed at
// Twilio's WhatsApp webhook (or any provider that speaks the same From/Body shape). A reply from a
// number the CRM already knows continues that record's conversation instead of spawning a
// look-alike lead - checked in this order (deal in progress, then the lead that hasn't converted
// yet, then a bare contact/company) so a customer mid-deal keeps talking to the live opportunity.
const conversationModels: [ActivityRelatedModel, any][] = [
  ['Opportunity', Opportunity], ['Lead', Lead], ['Contact', Contact], ['Company', Company],
];
async function findByPhone(phone: string) {
  for (const [relatedModel, Model] of conversationModels) {
    const doc = await Model.findOne({ phone }).sort('-createdAt');
    if (doc) return { relatedModel, doc };
  }
  return null;
}

// Logs the inbound message to the record's timeline and, when it already has someone assigned, as
// a completed inbound WhatsApp activity too - mirroring how an outbound WhatsApp send is logged in
// messaging.controller. A record with nobody assigned yet still gets the timeline entry; the
// activity is skipped rather than thrown, since Activity.assignedTo is required.
async function logInboundWhatsapp(relatedModel: ActivityRelatedModel, relatedId: unknown, text: string) {
  await TimelineEvent.create({ relatedModel, relatedId, eventType: 'whatsapp_received', message: text || '(no text - media message)' });
  const links = await resolveActivityRelations(relatedModel, relatedId);
  if (!links.salesperson) return;
  const activityType = await ActivityType.findOneAndUpdate({ name: 'WhatsApp' }, { $setOnInsert: { icon: 'message-circle', defaultDays: 0, active: true } }, { upsert: true, new: true });
  await createActivityWithRelations({ activityType: activityType._id, dueDate: new Date(), assignedTo: links.salesperson, summary: 'WhatsApp message received', body: text, relatedModel, relatedId, direction: 'inbound', status: 'completed', completedAt: new Date() });
}

export async function receiveWhatsapp(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const input = inboundWhatsappInput.parse({ from: pickField(body, 'From', 'from', 'WaId', 'waId'), text: pickField(body, 'Body', 'body', 'text') });
  const phone = input.from.replace(/^whatsapp:/i, '').trim();
  const text = (input.text ?? '').trim();

  const match = await findByPhone(phone);
  if (match) {
    await logInboundWhatsapp(match.relatedModel, match.doc._id, text);
    if (match.relatedModel === 'Lead') {
      const lead = match.doc as InstanceType<typeof Lead>;
      lead.touchCount = (lead.touchCount ?? 1) + 1;
      lead.lastTouchedAt = new Date();
      await lead.save();
      await rescoreLead(lead._id);
    }
    return res.status(200).json({ matched: match.relatedModel, id: match.doc._id });
  }

  // An unrecognized number is a brand-new inbound conversation - it goes through the same
  // Capture -> Deduplicate -> Enrich -> Score -> Assign -> Follow-up funnel as any other lead.
  const { lead, duplicate } = await ingestLead({ phone, notes: text || undefined }, { channel: req.intakeChannel });
  await logInboundWhatsapp('Lead', lead._id, text);
  res.status(duplicate ? 200 : 201).json({ matched: 'new', id: lead._id });
}

// Bulk variant of the same funnel for CSV/Excel import: rows are parsed client-side (or below,
// from raw CSV text) into plain objects and each runs through ingestLead exactly like any other
// source, so an imported list gets deduped, scored, and assigned the same way a live lead would.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length);
  if (!lines.length) return [];
  const splitRow = (line: string) => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
  const headers = splitRow(lines[0]!).map(h => h.toLowerCase());
  return lines.slice(1).map(line => Object.fromEntries(splitRow(line).map((cell, i) => [headers[i], cell])));
}

export async function importLeads(req: Request, res: Response) {
  const rows = typeof req.body.csv === 'string' ? parseCsv(req.body.csv) : Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!rows) throw new ApiError(422, 'Provide CSV text as `csv` or an array of rows as `rows`');
  if (rows.length > 2000) throw new ApiError(422, 'Import is limited to 2000 rows at a time');
  const results = { created: 0, duplicates: 0, failed: 0, errors: [] as { row: number; message: string }[] };
  for (const [index, raw] of rows.entries()) {
    try {
      const parsed = publicLeadInput.parse(raw);
      const [source, medium, campaign] = await Promise.all([resolveByName(LeadSource, parsed.source), resolveByName(Medium, parsed.medium), resolveByName(Campaign, parsed.campaign)]);
      const { duplicate } = await ingestLead({ ...parsed, source: source ?? undefined, medium: medium ?? undefined, campaign: campaign ?? undefined }, { userId: req.user!._id, channel: { name: 'CSV import', channelType: 'csv_import' } });
      duplicate ? results.duplicates++ : results.created++;
    } catch (error) {
      results.failed++;
      const message = error instanceof ZodError ? error.issues[0]?.message ?? 'Invalid row' : error instanceof Error ? error.message : 'Invalid row';
      results.errors.push({ row: index + 2, message });
    }
  }
  res.status(201).json(results);
}
