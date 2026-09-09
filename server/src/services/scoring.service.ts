import mongoose from 'mongoose';
import { Activity, IntakeChannel, Lead, TimelineEvent } from '../models/index.js';

// The AI Lead Score: not a chatbot bolted on the side, a score that recomputes itself in the
// background every time a lead's situation changes - captured, called, emailed, revisited,
// demoed, quoted - so "who do I call today" is always answered from the latest signal instead of
// a number frozen at intake. rescoreLead() is the one place that happens; every write path that
// changes a lead's engagement (ingestion, activities, timeline events) calls it after saving.

export type ScoreReason = { label: string; points: number };
export type ScoreResult = { score: number; reasons: ScoreReason[]; recommendation: string };

const paidChannels = new Set(['google_ads', 'facebook', 'instagram']);
const warmChannels = new Set(['website_form', 'landing_page', 'whatsapp', 'chatbot', 'api']);
const demoTypeName = /demo|meeting/i;
const proposalTypeName = /proposal|quote/i;

// Pure scoring function - no I/O - so it's easy to reason about and to unit test. Every input is
// a plain signal already sitting on the lead or its history; nothing here calls an external AI
// provider, which is the point: the score has to be explainable in one glance, not a black box.
export function scoreFromSignals(input: {
  email?: string; phone?: string; companyName?: string; expectedRevenue?: number;
  channelType?: string; touchCount?: number;
  requestedDemo?: boolean; openedProposal?: boolean; websiteActivity?: boolean; repliedToEmail?: boolean;
}): ScoreResult {
  const reasons: ScoreReason[] = [];
  const add = (label: string, points: number) => { if (points > 0) reasons.push({ label, points }); };

  const revenue = input.expectedRevenue ?? 0;
  if (input.companyName) add('Company size', revenue >= 1_000_000 ? 25 : revenue >= 100_000 ? 20 : revenue > 0 ? 15 : 10);
  add('Requested demo', input.requestedDemo ? 20 : 0);
  add('Opened proposal', input.openedProposal ? 15 : 0);
  add('Website activity', input.websiteActivity ? 15 : 0);
  add('Replied to email', input.repliedToEmail ? 12 : 0);
  add('Reachable by phone', input.phone ? 5 : 0);
  add('Reachable by email', input.email ? 5 : 0);
  if (input.channelType) add('Channel warmth', paidChannels.has(input.channelType) ? 8 : warmChannels.has(input.channelType) ? 5 : 2);

  const score = Math.max(0, Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0)));
  const recommendation = score >= 70
    ? 'Call today. High probability of conversion.'
    : score >= 40
      ? 'Follow up this week to keep the deal warm.'
      : 'Low urgency for now - nurture by email until it warms up.';
  return { score, reasons: reasons.sort((a, b) => b.points - a.points), recommendation };
}

// Reads whatever the lead's history already contains and turns it into the signals above. No new
// tracking infrastructure required: a "Demo" or "Proposal" activity logged against the lead, an
// inbound email logged on its timeline, or the lead resubmitting/reopening (touchCount) are all
// already captured by the rest of the app - this just reads them back.
async function deriveSignals(lead: { _id: mongoose.Types.ObjectId; touchCount?: number; channel?: mongoose.Types.ObjectId | null }) {
  const [activities, timeline, channel] = await Promise.all([
    Activity.find({ lead: lead._id }).populate('activityType', 'name').select('activityType status'),
    TimelineEvent.find({ relatedModel: 'Lead', relatedId: lead._id }).select('eventType'),
    lead.channel ? IntakeChannel.findById(lead.channel).select('channelType') : null,
  ]);
  const typeName = (activity: any) => String(activity.activityType?.name ?? '');
  return {
    channelType: channel?.channelType as string | undefined,
    requestedDemo: activities.some(a => demoTypeName.test(typeName(a))),
    openedProposal: activities.some(a => proposalTypeName.test(typeName(a)) && a.status === 'completed'),
    websiteActivity: (lead.touchCount ?? 1) > 1,
    repliedToEmail: timeline.some(event => event.eventType === 'email_received'),
  };
}

// Recomputes and persists one lead's score. Returns null if the lead no longer exists (a caller
// racing a delete). Safe to call as often as needed - it only ever reads the lead's own history.
export async function rescoreLead(leadId: mongoose.Types.ObjectId | string) {
  const lead = await Lead.findById(leadId).select('email phone companyName expectedRevenue channel touchCount score');
  if (!lead) return null;
  const signals = await deriveSignals(lead);
  const result = scoreFromSignals({ email: lead.email ?? undefined, phone: lead.phone ?? undefined, companyName: lead.companyName ?? undefined, expectedRevenue: lead.expectedRevenue, touchCount: lead.touchCount, ...signals });
  lead.score = result.score;
  lead.scoreReasons = result.reasons as any;
  lead.scoreRecommendation = result.recommendation;
  lead.hot = result.score >= 70;
  await lead.save();
  return result;
}
