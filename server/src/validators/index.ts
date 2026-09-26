import {z} from'zod';
export const objectId=z.string().regex(/^[a-f\d]{24}$/i);
// Selects submit '' for the blank option; treat that as "not set" rather than an invalid id.
export const optionalId=objectId.or(z.literal('')).nullish().transform(v=>v===''||v===null?null:v);
export const listQuery=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20),search:z.string().max(100).optional(),status:z.string().max(30).optional(),stage:objectId.optional(),salesperson:objectId.optional(),team:objectId.optional(),priority:z.coerce.number().int().min(0).max(3).optional(),source:objectId.optional(),campaign:objectId.optional(),sortBy:z.enum(['createdAt','updatedAt','title','expectedRevenue','priority','probability','expectedClosingDate']).default('createdAt'),sortOrder:z.enum(['asc','desc']).default('desc')});
const common={title:z.string().trim().min(2).max(160),email:z.string().email().or(z.literal('')).optional(),phone:z.string().max(40).optional(),expectedRevenue:z.coerce.number().min(0).default(0),priority:z.coerce.number().int().min(0).max(3).default(1),salesperson:optionalId,salesTeam:optionalId,tags:z.array(objectId).default([]),source:optionalId,medium:optionalId,campaign:optionalId};
export const opportunityInput=z.object({...common,company:optionalId,contact:optionalId,recurringRevenue:z.coerce.number().min(0).default(0),probability:z.coerce.number().min(0).max(100).default(10),stage:objectId,expectedClosingDate:z.coerce.date().nullish(),internalNotes:z.string().max(10000).optional()});
export const workflowEvents=['lead_created','lead_status_changed','opportunity_stage_changed','opportunity_won','opportunity_lost'] as const;
const workflowAction=z.discriminatedUnion('type',[
  z.object({type:z.literal('assign_owner'),config:z.object({user:optionalId,team:optionalId,onlyIfUnassigned:z.boolean().default(true)})}),
  z.object({type:z.literal('create_activity'),config:z.object({activityType:objectId,days:z.coerce.number().int().min(0).max(365).default(1),summary:z.string().trim().max(200).default('')})}),
  z.object({type:z.literal('notify'),config:z.object({user:optionalId,message:z.string().trim().max(300).default('')})}),
  z.object({type:z.literal('add_tag'),config:z.object({tag:objectId})}),
  z.object({type:z.literal('set_priority'),config:z.object({priority:z.coerce.number().int().min(0).max(3)})}),
  z.object({type:z.literal('add_note'),config:z.object({message:z.string().trim().min(1).max(2000)})}),
  // A template can open a conversation; free text only reaches contacts who messaged in the last 24 hours.
  z.object({type:z.literal('send_whatsapp'),config:z.object({message:z.string().trim().max(4096).default(''),template:optionalId}).refine(c=>c.template||c.message,{message:'Choose a template or write a message',path:['message']})}),
]);
const workflowTrigger=z.object({event:z.enum(workflowEvents),conditions:z.object({source:optionalId,status:z.enum(['new','qualified','disqualified']).nullish(),stage:optionalId,minRevenue:z.coerce.number().min(0).nullish(),minPriority:z.coerce.number().int().min(0).max(3).nullish()}).default({source:null,stage:null})}).superRefine((trigger,ctx)=>{
  const lead=trigger.event.startsWith('lead_');
  if(lead&&trigger.conditions.stage)ctx.addIssue({code:'custom',path:['conditions','stage'],message:'Stage only applies to opportunity triggers'});
  if(!lead&&trigger.conditions.status)ctx.addIssue({code:'custom',path:['conditions','status'],message:'Lead status only applies to lead triggers'});
});
// No defaults on top-level fields: Zod 4 applies defaults inside .partial(), so a PATCH of just the name would reset them.
export const workflowInput=z.object({name:z.string().trim().min(2).max(120),active:z.boolean().optional(),trigger:workflowTrigger,actions:z.array(workflowAction).min(1).max(10)});
// 'converted' is set by the conversion flow itself and is deliberately not selectable here.
export const leadInput=z.object({...common,contactName:z.string().max(120).optional(),companyName:z.string().max(160).optional(),notes:z.string().max(10000).optional(),status:z.enum(['new','qualified','disqualified']).optional(),lostReason:optionalId,lostNotes:z.string().max(2000).optional()});
// Partial on purpose: the settings form may save any subset of fields.
export const whatsappBotInput=z.object({enabled:z.boolean(),businessName:z.string().trim().max(120),persona:z.string().trim().max(500),businessInfo:z.string().trim().max(6000),faq:z.string().trim().max(6000),guardrails:z.string().trim().max(2000),handoffKeywords:z.array(z.string().trim().min(1).max(40)).max(20),handoffMessage:z.string().trim().max(1000),autoSummarize:z.boolean()}).partial();
// Meta's rules for new templates: lower-case snake_case names, a UTILITY or MARKETING category, and a body of at most 1,024 characters.
export const whatsappTemplateInput=z.object({name:z.string().trim().regex(/^[a-z0-9_]{1,512}$/,'Template names use lower-case letters, numbers and underscores only'),language:z.string().trim().min(2).max(15).default('en_US'),category:z.enum(['UTILITY','MARKETING']).default('UTILITY'),header:z.string().trim().max(60).optional(),body:z.string().trim().min(1).max(1024),footer:z.string().trim().max(60).optional(),variables:z.array(z.string().trim().max(200)).max(20).default([])});
// Only the CRM-side mapping can change after creation; the wording is fixed once Meta has it.
// CRM-only templates are free text with {contactName}-style fields, so they stay editable.
export const crmTemplateInput=z.object({name:z.string().trim().min(2).max(120),body:z.string().trim().min(1).max(4096)});
export const crmTemplatePatch=crmTemplateInput.partial().extend({active:z.boolean().optional()});
export const whatsappTemplatePatch=z.object({variables:z.array(z.string().trim().max(200)).max(20),active:z.boolean()});
