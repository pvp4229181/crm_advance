import {Communication,Lead,Notification,TimelineEvent,WhatsAppBot} from '../models/index.js';
import {ApiError,escapeRegex} from '../utils/http.js';
import {aiConfig,generateGroundedJson} from './ai.service.js';

// The settings document is created on first read, so the bot always has defaults to work with.
export async function botSettings(){
  return (await WhatsAppBot.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true}).lean()) as any;
}

const filled=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
const clip=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
const leadFacts=(lead:any)=>({title:lead.title,contactName:lead.contactName,companyName:lead.companyName,expectedRevenue:lead.expectedRevenue,status:lead.status,notes:lead.notes,conversationSummary:lead.whatsappSummary?.summary});
const transcript=(messages:any[])=>messages.map(x=>({from:x.direction==='inbound'?'customer':x.mode==='ai'?'bot':'team',body:x.body,at:x.createdAt}));

async function recentMessages(leadId:unknown,limit:number){
  const messages=await Communication.find({channel:'whatsapp',relatedModel:'Lead',relatedId:leadId}).sort('-createdAt').limit(limit).lean();
  return messages.reverse();
}

function replyInstructions(bot:any){
  return[
    `You are the WhatsApp assistant${bot.businessName?` for ${bot.businessName}`:''}. Persona: ${bot.persona||'a friendly, concise sales assistant'}.`,
    'Write one concise WhatsApp reply (under 600 characters) in the language the customer is using.',
    'Answer only from the business facts, FAQ, lead details, and conversation supplied. When they do not cover the question, say a team member will confirm instead of guessing.',
    bot.guardrails&&`Rules you must always follow: ${bot.guardrails}`,
    'Set "handoff" to true when the customer asks for a person, is upset, wants to negotiate or place an order, or asks something the facts cannot answer.',
    'Return {"message":string,"handoff":boolean,"reason":string}.',
  ].filter(Boolean).join('\n');
}

/** Drafts a reply from the configured bot persona. `handoff` is the model's judgement that a person should take over. */
export async function draftReply(lead:any,instruction?:string){
  const[bot,messages]=await Promise.all([botSettings(),recentMessages(lead._id,12)]);
  const result:any=await generateGroundedJson(replyInstructions(bot),{business:{name:bot.businessName,facts:bot.businessInfo,faq:bot.faq},lead:leadFacts(lead),conversation:transcript(messages),instruction:instruction||'Suggest the best helpful response.'},result=>filled(result?.message));
  const message=clip(result?.message,4096);if(!message)throw new ApiError(502,'AI returned an invalid WhatsApp draft');
  return{message,handoff:result?.handoff===true,reason:clip(result?.reason,300)};
}

export const wantsHuman=(bot:any,text:string)=>(bot.handoffKeywords??[]).some((keyword:string)=>keyword.trim()&&new RegExp(`\\b${escapeRegex(keyword.trim())}\\b`,'i').test(text));

/** Moves the lead back to human mode and tells its owner, so the customer is not left waiting on the bot. */
export async function handOff(lead:any,reason:string){
  await Lead.updateOne({_id:lead._id},{communicationMode:'human'});
  const owner=lead.salesperson?._id??lead.salesperson??lead.createdBy;
  await TimelineEvent.create({createdBy:owner,relatedModel:'Lead',relatedId:lead._id,eventType:'whatsapp_handoff',message:`WhatsApp bot handed the conversation to a person: ${reason}`});
  await Notification.create({user:owner,title:'WhatsApp needs a person',message:`${lead.contactName||lead.title}: ${reason}`,type:'whatsapp',link:`/leads/${lead._id}`});
}

const sentiments=['positive','neutral','negative'];
/** Summarizes the WhatsApp conversation onto the lead and its timeline. */
export async function summarizeConversation(leadId:unknown,actor?:unknown){
  const lead:any=await Lead.findById(leadId).lean();if(!lead)throw new ApiError(404,'Lead not found');
  const[messages,messageCount]=await Promise.all([recentMessages(lead._id,40),Communication.countDocuments({channel:'whatsapp',relatedModel:'Lead',relatedId:lead._id})]);
  if(!messages.length)throw new ApiError(422,'There are no WhatsApp messages to summarize yet');
  const result:any=await generateGroundedJson('Summarize this WhatsApp conversation for the sales team\'s CRM record. Record only what was actually said. Return {"summary":string (2-4 sentences),"intent":string,"requirements":string[],"budget":string,"timeline":string,"sentiment":"positive"|"neutral"|"negative","nextStep":string}. Use "" or [] for anything that was not discussed.',{lead:{title:lead.title,contactName:lead.contactName,companyName:lead.companyName,status:lead.status},conversation:transcript(messages)},result=>filled(result?.summary));
  const summary=clip(result?.summary,1200);if(!summary)throw new ApiError(502,'AI returned an invalid conversation summary');
  const whatsappSummary={summary,intent:clip(result.intent,200),requirements:(Array.isArray(result.requirements)?result.requirements:[]).map((item:unknown)=>clip(item,200)).filter(Boolean).slice(0,10),budget:clip(result.budget,120),timeline:clip(result.timeline,120),sentiment:sentiments.includes(result.sentiment)?result.sentiment:'neutral',nextStep:clip(result.nextStep,300),messageCount,generatedAt:new Date()};
  await Lead.updateOne({_id:lead._id},{whatsappSummary});
  await TimelineEvent.create({createdBy:actor??lead.salesperson??lead.createdBy,relatedModel:'Lead',relatedId:lead._id,eventType:'whatsapp_summary',message:`WhatsApp summary: ${summary}${whatsappSummary.nextStep?` Next step: ${whatsappSummary.nextStep}`:''}`});
  return whatsappSummary;
}

// Re-summarize after every few new messages rather than on each one, to stay inside free AI rate limits.
const SUMMARY_EVERY=4;
export async function autoSummarize(lead:any,force=false){
  if(!aiConfig().configured||!(await botSettings()).autoSummarize)return;
  const count=await Communication.countDocuments({channel:'whatsapp',relatedModel:'Lead',relatedId:lead._id});
  if(!force&&count-(lead.whatsappSummary?.messageCount??0)<SUMMARY_EVERY)return;
  await summarizeConversation(lead._id).catch(error=>console.error('WhatsApp auto-summary failed',error));
}
