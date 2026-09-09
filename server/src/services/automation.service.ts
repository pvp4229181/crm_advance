import mongoose from 'mongoose';
import { Activity, ActivityType, Lead, Notification, Opportunity, Role, SalesTeam, TimelineEvent, User } from '../models/index.js';
import { createActivityWithRelations } from './activity.service.js';
import { emailConfigured, sendNotifyEmail } from './mail.service.js';

// The automation engine's two time-based rules - "lead hasn't been contacted within N minutes ->
// escalate to manager" and "deal stays in a stage for > N days -> notify salesperson and
// manager, create a follow-up task" - run on a plain interval (see server.ts) rather than a job
// queue, since nothing here needs exactly-once delivery: each sweep is idempotent, guarded by a
// "have we already acted on this" timestamp field on the record itself.
const UNCONTACTED_ESCALATE_MINUTES = Number(process.env.UNCONTACTED_ESCALATE_MINUTES || 15);
const STALE_STAGE_DAYS = Number(process.env.STALE_STAGE_DAYS || 5);
const APP_URL = (process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

// A "contacted" signal is any outbound touch logged against the lead: a completed activity (a
// call logged, a meeting held) or an automated/manual message send recorded on its timeline.
async function hasBeenContacted(leadId: mongoose.Types.ObjectId) {
  const [activity, message] = await Promise.all([
    Activity.exists({ lead: leadId, status: 'completed' }),
    TimelineEvent.exists({ relatedModel: 'Lead', relatedId: leadId, eventType: { $in: ['sms_sent', 'whatsapp_sent', 'email_sent'] } }),
  ]);
  return Boolean(activity || message);
}

// Resolves who "the manager" is for a record: the lead/team's Sales Manager where one is set,
// falling back to every active Sales Manager in the workspace so escalations never go nowhere.
async function findManagers(salesTeamId?: mongoose.Types.ObjectId | null) {
  const managerRole = await Role.findOne({ name: 'Sales Manager' }).select('_id');
  if (salesTeamId) {
    const team = await SalesTeam.findById(salesTeamId).select('teamLeader');
    if (team?.teamLeader) {
      const leader = await User.findOne({ _id: team.teamLeader, active: true }).select('_id name email');
      if (leader) return [leader];
    }
  }
  if (!managerRole) return [];
  return User.find({ active: true, role: managerRole._id }).select('_id name email');
}

async function notifyManagers(managers: { _id: mongoose.Types.ObjectId; email?: string }[], input: { title: string; message: string; type: string; link: string; emailSubject: string; emailHeading: string; emailBody: string }) {
  await Promise.all(managers.map(async manager => {
    await Notification.create({ user: manager._id, title: input.title, message: input.message, type: input.type, link: input.link });
    if (manager.email && emailConfigured()) {
      try {
        await sendNotifyEmail({ to: manager.email, subject: input.emailSubject, heading: input.emailHeading, body: input.emailBody, link: { url: `${APP_URL}${input.link}`, label: 'Open in Lead CRM' } });
      } catch (cause) {
        console.error('Automation escalation email failed', cause);
      }
    }
  }));
}

// IF a lead hasn't been contacted within N minutes -> escalate to manager.
export async function escalateUncontactedLeads() {
  const cutoff = new Date(Date.now() - UNCONTACTED_ESCALATE_MINUTES * 60 * 1000);
  const leads = await Lead.find({ status: 'new', converted: false, escalatedAt: null, createdAt: { $lte: cutoff } }).select('title salesTeam salesperson createdAt');
  for (const lead of leads) {
    if (await hasBeenContacted(lead._id)) continue;
    const managers = await findManagers(lead.salesTeam as mongoose.Types.ObjectId | null);
    lead.escalatedAt = new Date();
    await lead.save();
    await TimelineEvent.create({ relatedModel: 'Lead', relatedId: lead._id, eventType: 'escalated_uncontacted', message: `Escalated to manager - not contacted within ${UNCONTACTED_ESCALATE_MINUTES} minutes` });
    if (managers.length) await notifyManagers(managers, {
      title: 'Lead not contacted in time', message: lead.title, type: 'escalation', link: '/leads',
      emailSubject: `Escalation: “${lead.title}” has not been contacted`,
      emailHeading: 'A lead needs attention',
      emailBody: `“${lead.title}” was captured over ${UNCONTACTED_ESCALATE_MINUTES} minutes ago and still has no logged contact.`,
    });
  }
  return leads.length;
}

// IF a deal stays in a stage for > N days -> notify salesperson, notify manager, create a
// follow-up task.
export async function flagStaleOpportunities() {
  const cutoff = new Date(Date.now() - STALE_STAGE_DAYS * 24 * 60 * 60 * 1000);
  const deals = await Opportunity.find({ status: 'open', stageEnteredAt: { $lte: cutoff }, staleNotifiedAt: null }).populate('stage', 'name').select('title salesperson salesTeam stage stageEnteredAt');
  for (const deal of deals) {
    const stageName = (deal.stage as any)?.name ?? 'this stage';
    deal.staleNotifiedAt = new Date();
    await deal.save();
    await TimelineEvent.create({ relatedModel: 'Opportunity', relatedId: deal._id, eventType: 'stage_stale', message: `Stuck in ${stageName} for more than ${STALE_STAGE_DAYS} days` });

    const managers = await findManagers(deal.salesTeam as mongoose.Types.ObjectId | null);
    const recipients = [...(deal.salesperson ? [await User.findById(deal.salesperson).select('_id name email')] : []), ...managers].filter((u): u is NonNullable<typeof u> => Boolean(u));
    if (recipients.length) await notifyManagers(recipients, {
      title: 'Deal stuck in stage', message: `${deal.title} — ${stageName}`, type: 'stale_deal', link: `/opportunities/${deal._id}`,
      emailSubject: `“${deal.title}” has been in ${stageName} for over ${STALE_STAGE_DAYS} days`,
      emailHeading: 'A deal needs a push',
      emailBody: `“${deal.title}” has stayed in ${stageName} for more than ${STALE_STAGE_DAYS} days without moving.`,
    });

    if (deal.salesperson) {
      const activityType = await ActivityType.findOneAndUpdate({ name: 'Follow-up' }, { $setOnInsert: { icon: 'repeat', defaultDays: 1, active: true } }, { upsert: true, new: true });
      await createActivityWithRelations({ activityType: activityType._id, dueDate: new Date(), assignedTo: deal.salesperson, summary: `Deal stuck in ${stageName}: ${deal.title}`, relatedModel: 'Opportunity', relatedId: deal._id, createdBy: deal.salesperson });
    }
  }
  return deals.length;
}

export async function runAutomationSweep() {
  const results = await Promise.allSettled([escalateUncontactedLeads(), flagStaleOpportunities()]);
  for (const result of results) if (result.status === 'rejected') console.error('Automation sweep step failed', result.reason);
}
