import mongoose from 'mongoose';
import { ActivityType, AssignmentCursor, Lead, Notification, Role, SalesTeam, TimelineEvent, User } from '../models/index.js';
import { createActivityWithRelations } from './activity.service.js';
import { rescoreLead, scoreFromSignals } from './scoring.service.js';
import { sendTwilioMessage } from './messaging.service.js';
import { emailConfigured, sendNotifyEmail } from './mail.service.js';
import { ApiError } from '../utils/http.js';

// How long an assigned salesperson has before the auto-created follow-up task is due.
const FOLLOW_UP_SLA_HOURS = Number(process.env.FOLLOW_UP_SLA_HOURS || 4);
// A lead scoring above this is auto-flagged HOT, per the AI Lead Score's "score lead -> if score
// crosses the threshold, mark HOT" rule (see scoring.service).
const HOT_SCORE_THRESHOLD = Number(process.env.HOT_SCORE_THRESHOLD || 70);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value?: unknown) => typeof value === 'string' && emailPattern.test(value.trim()) ? value.trim().toLowerCase() : undefined;
const normalizePhone = (value?: unknown) => typeof value === 'string' && value.replace(/\D/g, '').length >= 6 ? value.replace(/[^\d+]/g, '') : undefined;

async function findDuplicateLead(email?: string, phone?: string) {
  const or: Record<string, string>[] = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (!or.length) return null;
  return Lead.findOne({ $or: or }).sort('-createdAt');
}

// Round-robins across the active Salespeople on a team (or the whole workspace, when the lead
// has no team yet), remembering the last pick per scope in AssignmentCursor. Not perfectly
// race-free under heavy concurrent intake, but self-healing: a lost race just repeats one name.
async function pickAssignee(salesTeamId?: mongoose.Types.ObjectId | string | null) {
  const scopeKey = salesTeamId ? String(salesTeamId) : 'global';
  let candidateIds: mongoose.Types.ObjectId[];
  if (salesTeamId) {
    const team = await SalesTeam.findById(salesTeamId).select('members teamLeader');
    candidateIds = [...(team?.members ?? []), ...(team?.teamLeader ? [team.teamLeader] : [])];
  } else {
    const salesRole = await Role.findOne({ name: 'Salesperson' }).select('_id');
    const pool = await User.find({ active: true, ...(salesRole ? { role: salesRole._id } : {}) }).select('_id').sort('_id');
    candidateIds = pool.map(u => u._id);
  }
  const candidates = await User.find({ _id: { $in: candidateIds }, active: true }).select('_id').sort('_id');
  if (!candidates.length) return null;
  const cursor = await AssignmentCursor.findOneAndUpdate({ _id: scopeKey }, {}, { upsert: true, new: true });
  const lastIndex = cursor.lastUserId ? candidates.findIndex(c => String(c._id) === String(cursor.lastUserId)) : -1;
  const next = candidates[(lastIndex + 1) % candidates.length]!;
  await AssignmentCursor.updateOne({ _id: scopeKey }, { lastUserId: next._id });
  return next._id;
}

async function scheduleFollowUp(lead: { _id: mongoose.Types.ObjectId; title: string; salesperson?: mongoose.Types.ObjectId | null }) {
  if (!lead.salesperson) return;
  const activityType = await ActivityType.findOneAndUpdate({ name: 'Follow-up' }, { $setOnInsert: { icon: 'repeat', defaultDays: 1, active: true } }, { upsert: true, new: true });
  await createActivityWithRelations({ activityType: activityType._id, dueDate: new Date(Date.now() + FOLLOW_UP_SLA_HOURS * 60 * 60 * 1000), assignedTo: lead.salesperson, summary: `Follow up on new lead: ${lead.title}`, relatedModel: 'Lead', relatedId: lead._id, createdBy: lead.salesperson });
  await Notification.create({ user: lead.salesperson, title: 'New lead assigned', message: lead.title, type: 'assignment', link: '/leads' });
}

// The "Send WhatsApp message" / "Send email" steps of the automation engine: a best-effort
// welcome touch the moment a lead is captured. Both channels are optional (Twilio/SMTP may not
// be configured yet) and neither failure should ever break lead capture itself, so each attempt
// is logged to the timeline as sent or skipped and errors are swallowed after logging.
async function sendCaptureOutreach(lead: { _id: mongoose.Types.ObjectId; title: string; contactName?: string | null; email?: string | null; phone?: string | null }) {
  const greetingName = lead.contactName || lead.title;
  const attempts: Promise<unknown>[] = [];
  if (lead.phone) {
    attempts.push(sendTwilioMessage('whatsapp', lead.phone, `Hi ${greetingName}, thanks for reaching out! A member of our team will be in touch with you shortly.`)
      .then(() => TimelineEvent.create({ relatedModel: 'Lead', relatedId: lead._id, eventType: 'whatsapp_sent', message: 'Automated WhatsApp welcome message sent' }))
      .catch(cause => {
        if (cause instanceof ApiError && cause.status === 503) return; // not configured - silently skip
        console.error('Automated WhatsApp send failed', cause);
      }));
  }
  if (lead.email && emailConfigured()) {
    attempts.push(sendNotifyEmail({ to: lead.email, subject: 'Thanks for reaching out', heading: `Hi ${greetingName}`, body: 'Thanks for your interest - we received your details and a member of our team will follow up with you shortly.' })
      .then(() => TimelineEvent.create({ relatedModel: 'Lead', relatedId: lead._id, eventType: 'email_sent', message: 'Automated welcome email sent' }))
      .catch(cause => console.error('Automated welcome email failed', cause)));
  }
  await Promise.all(attempts);
}

export type IngestChannel = { _id?: mongoose.Types.ObjectId; name: string; channelType: string; source?: unknown; medium?: unknown; campaign?: unknown; salesTeam?: unknown } | null | undefined;
export type IngestInput = {
  title?: unknown; contactName?: unknown; companyName?: unknown; email?: unknown; phone?: unknown;
  city?: unknown; expectedRevenue?: unknown; priority?: unknown; notes?: unknown; tags?: unknown;
  source?: unknown; medium?: unknown; campaign?: unknown; salesTeam?: unknown; salesperson?: unknown;
};

// The single funnel every intake surface goes through - manual entry, the public channel API,
// and CSV import alike - so Capture -> Deduplicate -> Enrich -> Score -> Assign -> Follow-up
// happens exactly once, in one place, regardless of where the lead came from.
export async function ingestLead(input: IngestInput, opts: { userId?: mongoose.Types.ObjectId; channel?: IngestChannel } = {}) {
  const channel = opts.channel ?? null;
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const contactName = typeof input.contactName === 'string' ? input.contactName.trim() || undefined : undefined;
  const companyName = typeof input.companyName === 'string' ? input.companyName.trim() || undefined : undefined;
  // Enrich: fall back to whatever identifying detail is present so a title always exists, even
  // when a channel (a WhatsApp message, a missed call) supplies no explicit title itself.
  const title = (typeof input.title === 'string' && input.title.trim()) || contactName || companyName || email || phone || 'New lead';

  // Deduplicate: the same person submitting twice (a resubmitted form, a WhatsApp follow-up
  // message) touches the existing lead instead of spawning a look-alike record.
  const duplicate = await findDuplicateLead(email, phone);
  if (duplicate) {
    duplicate.touchCount = (duplicate.touchCount ?? 1) + 1;
    duplicate.lastTouchedAt = new Date();
    await duplicate.save();
    await TimelineEvent.create({ createdBy: opts.userId ?? duplicate.salesperson ?? undefined, relatedModel: 'Lead', relatedId: duplicate._id, eventType: 'duplicate_submission', message: `Duplicate submission received${channel ? ` via ${channel.name}` : ''}` });
    // A resubmission is itself an engagement signal (see scoring.service's "Website activity"
    // reason, driven by touchCount) - rescore so the card reflects it immediately.
    await rescoreLead(duplicate._id);
    return { lead: duplicate, duplicate: true as const };
  }

  const salesTeam = input.salesTeam ?? channel?.salesTeam ?? null;
  const salesperson = input.salesperson ?? (await pickAssignee(salesTeam as string | null));
  const city = typeof input.city === 'string' ? input.city.trim() || undefined : undefined;
  const data = {
    title, email, phone, contactName, companyName, city,
    expectedRevenue: typeof input.expectedRevenue === 'number' ? input.expectedRevenue : Number(input.expectedRevenue) || 0,
    priority: typeof input.priority === 'number' ? input.priority : Number(input.priority) || 1,
    notes: typeof input.notes === 'string' ? input.notes : undefined,
    tags: Array.isArray(input.tags) ? input.tags : [],
    source: input.source ?? channel?.source ?? null,
    medium: input.medium ?? channel?.medium ?? null,
    campaign: input.campaign ?? channel?.campaign ?? null,
    salesTeam, salesperson, channel: channel?._id,
    createdBy: opts.userId ?? salesperson ?? undefined,
    updatedBy: opts.userId ?? salesperson ?? undefined,
  };
  // Score: the AI Lead Score card's number, reasons, and recommendation all come from one
  // formula (see scoring.service) so the "why" behind the number is never a mystery.
  const { score, reasons, recommendation } = scoreFromSignals({ ...data, channelType: channel?.channelType, touchCount: 1 });
  const hot = score >= HOT_SCORE_THRESHOLD;
  const lead = await Lead.create({ ...data, score, scoreReasons: reasons, scoreRecommendation: recommendation, hot });

  await TimelineEvent.create({ createdBy: opts.userId ?? lead.salesperson ?? undefined, relatedModel: 'Lead', relatedId: lead._id, eventType: 'lead_captured', message: `Lead captured${channel ? ` via ${channel.name}` : ' manually'}` });
  if (hot) await TimelineEvent.create({ relatedModel: 'Lead', relatedId: lead._id, eventType: 'lead_marked_hot', message: `Marked HOT — score ${score} is above the threshold of ${HOT_SCORE_THRESHOLD}` });
  await Promise.all([sendCaptureOutreach(lead), scheduleFollowUp(lead)]);
  return { lead, duplicate: false as const };
}
