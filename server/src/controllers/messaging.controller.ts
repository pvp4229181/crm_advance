import type { Request, Response } from 'express';
import { ActivityType, Company, Contact, Lead, Opportunity, TimelineEvent } from '../models/index.js';
import { accessScope } from '../middleware/auth.js';
import { sendTwilioMessage, type MessageChannel } from '../services/messaging.service.js';
import { createActivityWithRelations } from '../services/activity.service.js';
import { ApiError } from '../utils/http.js';

const relatedModels: Record<string, any> = { Lead, Opportunity, Contact, Company };

// A message sent from the CRM is logged the same way a note is - a TimelineEvent on the record -
// so "who called/messaged this lead and what was said" shows up in the same history either way.
export async function sendMessage(req: Request, res: Response) {
  const { relatedModel, relatedId, channel, body } = req.body as { relatedModel?: string; relatedId?: string; channel?: MessageChannel; body?: string; to?: string };
  const Model = relatedModel && relatedModels[relatedModel];
  if (!Model) throw new ApiError(422, 'relatedModel must be one of Lead, Opportunity, Contact, or Company');
  if (channel !== 'sms' && channel !== 'whatsapp') throw new ApiError(422, 'channel must be "sms" or "whatsapp"');
  if (typeof body !== 'string' || !body.trim()) throw new ApiError(422, 'Message body is required');

  const doc = await Model.findOne({ _id: relatedId, ...accessScope(req) });
  if (!doc) throw new ApiError(404, 'Record not found');
  const to = (typeof req.body.to === 'string' && req.body.to.trim()) || doc.phone;
  if (!to) throw new ApiError(422, 'This record has no phone number to send to');

  await sendTwilioMessage(channel, to, body.trim());
  const event = await TimelineEvent.create({ createdBy: req.user!._id, relatedModel, relatedId: doc._id, eventType: `${channel}_sent`, message: body.trim(), metadata: { to } });
  // WhatsApp is one of the Activity Engine's fixed types, so a WhatsApp send also logs a
  // completed activity (cross-linked to the lead/contact/company/deal/campaign/salesperson it
  // belongs to) - not just a timeline note. Plain SMS has no dedicated activity type and stays
  // timeline-only.
  if (channel === 'whatsapp') {
    const activityType = await ActivityType.findOneAndUpdate({ name: 'WhatsApp' }, { $setOnInsert: { icon: 'message-circle', defaultDays: 0, active: true } }, { upsert: true, new: true });
    await createActivityWithRelations({ activityType: activityType._id, dueDate: new Date(), assignedTo: req.user!._id, summary: `WhatsApp message to ${to}`, body: body.trim(), relatedModel, relatedId: doc._id, direction: 'outbound', status: 'completed', completedAt: new Date(), createdBy: req.user!._id });
  }
  res.status(201).json(event);
}
