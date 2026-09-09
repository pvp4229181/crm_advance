import { Activity, Company, Contact, Lead, Opportunity } from '../models/index.js';
import { rescoreLead } from './scoring.service.js';

export type ActivityRelatedModel = 'Lead' | 'Opportunity' | 'Contact' | 'Company';

// The Activity Engine: every activity (call, email, WhatsApp, meeting, demo, follow-up, task,
// note, reminder, site visit, proposal, payment) is logged against one primary record, but is
// only really useful once it also shows up on that record's contact, company, deal, campaign and
// salesperson. Rather than make every caller fill six relation fields by hand, this derives the
// full web from whichever single record the activity names and stores it as direct refs.
export async function resolveActivityRelations(relatedModel: ActivityRelatedModel, relatedId: unknown): Promise<Record<string, unknown>> {
  const links: Record<string, unknown> = {};
  if (relatedModel === 'Lead') {
    const lead = await Lead.findById(relatedId).select('salesperson campaign convertedOpportunity');
    if (!lead) return links;
    links.lead = lead._id;
    if (lead.salesperson) links.salesperson = lead.salesperson;
    if (lead.campaign) links.campaign = lead.campaign;
    if (lead.convertedOpportunity) {
      const deal = await Opportunity.findById(lead.convertedOpportunity).select('company contact campaign salesperson');
      if (deal) {
        links.opportunity = deal._id;
        if (deal.company) links.company = deal.company;
        if (deal.contact) links.contact = deal.contact;
        if (deal.campaign && !links.campaign) links.campaign = deal.campaign;
        if (deal.salesperson && !links.salesperson) links.salesperson = deal.salesperson;
      }
    }
  } else if (relatedModel === 'Opportunity') {
    const deal = await Opportunity.findById(relatedId).select('company contact campaign salesperson');
    if (!deal) return links;
    links.opportunity = deal._id;
    if (deal.company) links.company = deal.company;
    if (deal.contact) links.contact = deal.contact;
    if (deal.campaign) links.campaign = deal.campaign;
    if (deal.salesperson) links.salesperson = deal.salesperson;
  } else if (relatedModel === 'Contact') {
    const contact = await Contact.findById(relatedId).select('company salesperson');
    if (!contact) return links;
    links.contact = contact._id;
    if (contact.company) links.company = contact.company;
    if (contact.salesperson) links.salesperson = contact.salesperson;
  } else if (relatedModel === 'Company') {
    const company = await Company.findById(relatedId).select('salesperson');
    if (!company) return links;
    links.company = company._id;
    if (company.salesperson) links.salesperson = company.salesperson;
  }
  return links;
}

// Creates an activity and, in the same call, resolves and stores its full relationship web.
// Explicit fields in `input` (e.g. a caller-chosen salesperson) win over derived ones.
export async function createActivityWithRelations(input: Record<string, unknown>) {
  const relatedModel = input.relatedModel as ActivityRelatedModel;
  const links = await resolveActivityRelations(relatedModel, input.relatedId);
  const activity = await Activity.create({ ...links, ...input });
  // A call, demo, proposal, or WhatsApp message logged against a lead is exactly the kind of
  // engagement the AI Lead Score reacts to - rescore it in the background so the score reflects
  // this the moment it happens, not the next time someone happens to reopen the lead.
  if (links.lead) await rescoreLead(links.lead as any);
  return activity;
}

export const activityPopulate = [
  { path: 'activityType', select: 'name icon' },
  { path: 'assignedTo', select: 'name avatar' },
  { path: 'salesperson', select: 'name avatar' },
  { path: 'lead', select: 'title' },
  { path: 'contact', select: 'name' },
  { path: 'company', select: 'name' },
  { path: 'opportunity', select: 'title' },
  { path: 'campaign', select: 'name' },
];
