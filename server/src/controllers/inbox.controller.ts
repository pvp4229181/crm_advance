import type { Request, Response } from 'express';
import { Communication, Lead, TimelineEvent } from '../models/index.js';
import { accessScope } from '../middleware/auth.js';
import { mailConfigured, sendLeadEmail } from '../services/mail.service.js';
import { ApiError } from '../utils/http.js';
import { whatsappConfig } from '../services/whatsapp.service.js';

export function providerStatus(_req: Request, res: Response) {
  res.json({ whatsapp: whatsappConfig().configured, email: mailConfigured() });
}

// Inbound messages and bot replies have no createdBy, so non-admins see every message on
// the leads they can access in addition to anything they sent themselves.
export async function listInbox(req: Request, res: Response) {
  const isAdmin = (req.user!.role as any).name === 'Administrator';
  const leadIds = isAdmin ? [] : await Lead.find(accessScope(req)).distinct('_id');
  const filter = isAdmin ? {} : { $or: [{ createdBy: req.user!._id }, { relatedModel: 'Lead', relatedId: { $in: leadIds } }] };
  const items = await Communication.find(filter).sort('-createdAt').limit(500).lean();
  const ids = [...new Set(items.filter(x => x.relatedModel === 'Lead').map(x => String(x.relatedId)))];
  const leads = new Map((await Lead.find({ _id: { $in: ids } }).select('title contactName').lean()).map(x => [String(x._id), x]));
  res.json(items.map(x => ({ ...x, lead: x.relatedModel === 'Lead' ? leads.get(String(x.relatedId)) ?? null : null })));
}

export async function sendEmail(req: Request, res: Response) {
  const lead = await Lead.findOne({ _id: req.params.id, ...accessScope(req) }).lean();
  if (!lead) throw new ApiError(404, 'Lead not found');
  if (!lead.email) throw new ApiError(422, 'Add an email address to this lead first');
  const subject = String(req.body.subject ?? '').trim(), body = String(req.body.body ?? '').trim();
  if (!subject || subject.length > 200) throw new ApiError(422, 'Subject must contain between 1 and 200 characters');
  if (!body || body.length > 20000) throw new ApiError(422, 'Message must contain between 1 and 20,000 characters');
  const providerMessageId = await sendLeadEmail({ to: lead.email, subject, body, replyTo: (req.user as any).email });
  const message = await Communication.create({ channel: 'email', direction: 'outbound', provider: 'smtp', providerMessageId, status: 'sent', subject, body, relatedModel: 'Lead', relatedId: lead._id, sender: process.env.SMTP_FROM, recipient: lead.email, createdBy: req.user!._id });
  await TimelineEvent.create({ createdBy: req.user!._id, relatedModel: 'Lead', relatedId: lead._id, eventType: 'email_sent', message: `Email sent: ${subject}` });
  res.status(201).json(message);
}
