import {z} from'zod';
import {channelTypes} from'../models/index.js';
export const objectId=z.string().regex(/^[a-f\d]{24}$/i);
// Selects submit '' for the blank option; treat that as "not set" rather than an invalid id.
export const optionalId=objectId.or(z.literal('')).nullish().transform(v=>v===''||v===null?null:v);
export const listQuery=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20),search:z.string().max(100).optional(),status:z.string().max(30).optional(),stage:objectId.optional(),salesperson:objectId.optional(),team:objectId.optional(),priority:z.coerce.number().int().min(0).max(3).optional(),source:objectId.optional(),campaign:objectId.optional(),channel:objectId.optional(),sortBy:z.enum(['createdAt','updatedAt','title','expectedRevenue','priority','probability','expectedClosingDate']).default('createdAt'),sortOrder:z.enum(['asc','desc']).default('desc')});
const common={title:z.string().trim().min(2).max(160),email:z.string().email().or(z.literal('')).optional(),phone:z.string().max(40).optional(),expectedRevenue:z.coerce.number().min(0).default(0),priority:z.coerce.number().int().min(0).max(3).default(1),salesperson:optionalId,salesTeam:optionalId,tags:z.array(objectId).default([]),source:optionalId,medium:optionalId,campaign:optionalId};
export const opportunityInput=z.object({...common,company:optionalId,contact:optionalId,recurringRevenue:z.coerce.number().min(0).default(0),probability:z.coerce.number().min(0).max(100).default(10),stage:objectId,expectedClosingDate:z.coerce.date().nullish(),internalNotes:z.string().max(10000).optional()});
// 'converted' is set by the conversion flow itself and is deliberately not selectable here.
export const leadInput=z.object({...common,contactName:z.string().max(120).optional(),companyName:z.string().max(160).optional(),city:z.string().max(120).optional(),notes:z.string().max(10000).optional(),status:z.enum(['new','qualified','disqualified']).optional(),lostReason:optionalId,lostNotes:z.string().max(2000).optional()});

// External capture surfaces (a webhook forwarder, a CSV row) rarely have a ready-made "title" and
// shouldn't be rejected on formatting alone - this stays permissive and lets ingestLead() derive
// a title, so the only hard requirement is that *some* identifying detail was sent at all.
export const publicLeadInput=z.object({title:z.string().trim().max(160).optional(),contactName:z.string().trim().max(120).optional(),companyName:z.string().trim().max(160).optional(),email:z.string().trim().max(200).optional(),phone:z.string().trim().max(40).optional(),city:z.string().trim().max(120).optional(),expectedRevenue:z.coerce.number().min(0).optional(),priority:z.coerce.number().int().min(0).max(3).optional(),notes:z.string().max(10000).optional(),source:z.string().max(120).optional(),medium:z.string().max(120).optional(),campaign:z.string().max(120).optional()}).refine(v=>v.title||v.contactName||v.companyName||v.email||v.phone,{message:'Provide at least a name, email, or phone number'});
export const channelInput=z.object({name:z.string().trim().min(2).max(120),channelType:z.enum(channelTypes),source:optionalId,medium:optionalId,campaign:optionalId,salesTeam:optionalId});

// Logging a call (inbound, missed, or a callback) is its own capture surface, distinct from
// click-to-call (which just dials out and needs no lead at all): a phone number is the one thing
// every call has, so it's the only hard requirement.
export const callInput=z.object({phone:z.string().trim().min(6).max(40),contactName:z.string().trim().max(120).optional(),companyName:z.string().trim().max(160).optional(),notes:z.string().max(10000).optional(),outcome:z.enum(['connected','no_answer','voicemail']).default('connected')});

// SendGrid's Inbound Parse, Mailgun Routes, and Postmark's inbound webhook each spell "who sent
// it" and "what did it say" with different field names - intake.controller picks whichever of
// those names is present before this validates the normalized {from, subject, text} shape.
export const inboundEmailInput=z.object({from:z.string().trim().min(3).max(320),subject:z.string().trim().max(200).optional(),text:z.string().max(20000).optional()});

// Twilio's WhatsApp webhook (and the WhatsApp Cloud API, similarly) posts the sender as
// "whatsapp:+1415..." and the text as Body - intake.controller normalizes provider-specific field
// names into this shape before it validates. text is optional: a media-only message (an image, a
// voice note) still arrives with no Body at all and shouldn't be rejected for it.
export const inboundWhatsappInput=z.object({from:z.string().trim().min(3).max(60),text:z.string().max(4096).optional()});

// One activity shape covers all twelve activity types (Call, Email, WhatsApp, Meeting, Demo,
// Follow-up, Task, Note, Reminder, Site visit, Proposal, Payment) - which admin-configured
// ActivityType it is just picks the icon/summary/default schedule; the type-specific extras
// (direction, duration, message body, amount) are all optional so any type can use any of them.
export const activityInput=z.object({activityType:objectId,dueDate:z.coerce.date(),assignedTo:optionalId,summary:z.string().trim().min(2).max(200),notes:z.string().max(10000).optional(),relatedModel:z.enum(['Lead','Opportunity','Contact','Company']),relatedId:objectId,direction:z.enum(['outbound','inbound']).optional(),durationMinutes:z.coerce.number().min(0).max(1440).optional(),body:z.string().max(10000).optional(),amount:z.coerce.number().min(0).optional(),status:z.enum(['planned','completed']).optional()});
