import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Activity, ActivityType, Campaign, Company, Contact, Lead, LeadSource, LostReason, Medium, Notification, Opportunity, PipelineStage, SalesTeam, SavedFilter, Tag, TimelineEvent, User } from '../models/index.js';
import { accessScope } from '../middleware/auth.js';
import { activityInput, callInput, leadInput, listQuery, opportunityInput } from '../validators/index.js';
import { ApiError, escapeRegex } from '../utils/http.js';
import { convertLead, getBriefing, getManagerOverview, moveOpportunity } from '../services/crm.service.js';
import { ingestLead } from '../services/ingestion.service.js';
import { activityPopulate, createActivityWithRelations } from '../services/activity.service.js';

const pop = [{ path: 'salesperson', select: 'name email avatar' }, { path: 'salesTeam', select: 'name' }, { path: 'stage', select: 'name color sequence probability' }, { path: 'company', select: 'name' }, { path: 'contact', select: 'name' }, { path: 'tags', select: 'name color' }, { path: 'source', select: 'name' }, { path: 'campaign', select: 'name' }];
const leadPop = [{ path: 'salesperson', select: 'name email avatar' }, { path: 'salesTeam', select: 'name' }, { path: 'tags', select: 'name color' }, { path: 'source', select: 'name' }, { path: 'medium', select: 'name' }, { path: 'campaign', select: 'name' }, { path: 'convertedOpportunity', select: 'stage', populate: { path: 'stage', select: 'name color sequence' } }];
export async function listOpportunities(req: Request, res: Response) {
  const q = listQuery.parse(req.query); const filter: any = { ...accessScope(req) };
  for (const key of ['status','stage','salesperson','source','campaign'] as const) if (q[key]) filter[key] = q[key];
  if (q.team) filter.salesTeam = q.team; if (q.priority !== undefined) filter.priority = q.priority;
  if (q.search) filter.$or = ['title','email','phone'].map((key) => ({ [key]: new RegExp(escapeRegex(q.search!), 'i') }));
  const skip = (q.page - 1) * q.limit;
  const [data, total] = await Promise.all([Opportunity.find(filter).populate(pop).sort({ [q.sortBy]: q.sortOrder === 'asc' ? 1 : -1 }).skip(skip).limit(q.limit), Opportunity.countDocuments(filter)]);
  res.json({ data, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } });
}
export async function createOpportunity(req: Request, res: Response) { const input = opportunityInput.parse(req.body); const count = await Opportunity.countDocuments({ stage: input.stage }); const doc = await Opportunity.create({ ...input, kanbanOrder: count, createdBy: req.user!._id, updatedBy: req.user!._id }); await TimelineEvent.create({ createdBy: req.user!._id, relatedModel: 'Opportunity', relatedId: doc._id, eventType: 'opportunity_created', message: 'Opportunity created' }); res.status(201).json(await doc.populate(pop)); }
export async function getOpportunity(req: Request, res: Response) { const doc = await Opportunity.findOne({ _id: req.params.id, ...accessScope(req) }).populate(pop); if (!doc) throw new ApiError(404, 'Opportunity not found'); const [timeline, activities] = await Promise.all([TimelineEvent.find({ relatedModel: 'Opportunity', relatedId: doc._id }).populate('createdBy','name avatar').sort('-createdAt'), Activity.find({ $or: [{ relatedModel: 'Opportunity', relatedId: doc._id }, { opportunity: doc._id }] }).populate(activityPopulate).sort('dueDate')]); res.json({ ...doc.toObject(), timeline, activities }); }
export async function updateOpportunity(req: Request, res: Response) { const input = opportunityInput.partial().parse(req.body); const doc = await Opportunity.findOneAndUpdate({ _id: req.params.id, ...accessScope(req) }, { ...input, updatedBy: req.user!._id }, { new: true, runValidators: true }).populate(pop); if (!doc) throw new ApiError(404,'Opportunity not found'); res.json(doc); }
export async function setOutcome(req: Request, res: Response) { const status = req.body.status as string; if (!['won','lost','open'].includes(status)) throw new ApiError(422,'Invalid status'); const update: any = { status, updatedBy: req.user!._id, wonAt: status === 'won' ? new Date() : undefined, lostAt: status === 'lost' ? new Date() : undefined, lostReason: status === 'lost' ? req.body.lostReason : undefined, lostNotes: status === 'lost' ? req.body.lostNotes : undefined }; const doc = await Opportunity.findOneAndUpdate({ _id: req.params.id, ...accessScope(req) }, update, { new: true }).populate(pop); if (!doc) throw new ApiError(404,'Opportunity not found'); await TimelineEvent.create({ createdBy: req.user!._id, relatedModel:'Opportunity', relatedId: doc._id, eventType:`opportunity_${status === 'open' ? 'reopened' : status}`, message: status === 'open' ? 'Opportunity reopened' : `Opportunity marked ${status}` }); res.json(doc); }
export async function move(req: Request, res: Response) { const body = req.body as { stageId: string; orderedIds: string[] }; if (!mongoose.isValidObjectId(body.stageId) || !Array.isArray(body.orderedIds) || body.orderedIds.some(x => !mongoose.isValidObjectId(x))) throw new ApiError(422,'Invalid move'); await moveOpportunity(String(req.params.id), body.stageId, body.orderedIds, req.user!._id); res.json({ success: true }); }

export async function deleteOpportunity(req: Request, res: Response) { const doc = await Opportunity.findOneAndDelete({ _id: req.params.id, ...accessScope(req) }); if (!doc) throw new ApiError(404, 'Opportunity not found'); await Promise.all([TimelineEvent.deleteMany({ relatedModel: 'Opportunity', relatedId: doc._id }), Activity.deleteMany({ $or: [{ relatedModel: 'Opportunity', relatedId: doc._id }, { opportunity: doc._id }] }), Lead.updateMany({ convertedOpportunity: doc._id }, { $unset: { convertedOpportunity: 1 } })]); res.status(204).end(); }

export async function listLeads(req: Request, res: Response) { const q = listQuery.parse(req.query); const filter:any = { ...accessScope(req) }; for (const key of ['status','salesperson','source','campaign','channel'] as const) if (q[key]) filter[key] = q[key]; if (q.team) filter.salesTeam = q.team; if (q.priority !== undefined) filter.priority = q.priority; if(q.search) filter.$or=['title','contactName','companyName','email','phone'].map(k=>({[k]:new RegExp(escapeRegex(q.search!),'i')})); const [data,total]=await Promise.all([Lead.find(filter).populate(leadPop).sort({[q.sortBy]:q.sortOrder==='asc'?1:-1}).skip((q.page-1)*q.limit).limit(q.limit),Lead.countDocuments(filter)]); res.json({data,pagination:{page:q.page,limit:q.limit,total,pages:Math.ceil(total/q.limit)}}); }
// Manual entry runs through the same Capture -> Deduplicate -> Enrich -> Score -> Assign ->
// Follow-up funnel as every other intake surface (see ingestion.service) instead of a bare
// insert - a hand-entered lead that matches an existing email/phone is treated as a duplicate too.
export async function createLead(req:Request,res:Response){const input=leadInput.parse(req.body);const {lead,duplicate}=await ingestLead(input,{userId:req.user!._id});res.status(duplicate?200:201).json(await lead.populate(leadPop));}
// Logging an inbound/missed call is its own capture surface (distinct from click-to-call, which
// just dials out): it runs through the same funnel as any other lead, tagged with a synthetic
// 'Phone call' channel the same way CSV import tags its own rows, below.
const outcomeLabel:Record<string,string>={connected:'Connected',no_answer:'No answer',voicemail:'Left voicemail'};
// Logging a call both captures/updates the lead through the usual funnel AND drops a completed
// "Call" activity on it, so the call shows up in that lead's (and its contact/company/campaign/
// salesperson's) activity history exactly like a manually-scheduled call would.
export async function logCall(req:Request,res:Response){
  const input=callInput.parse(req.body);
  const notes=[input.notes,`Call outcome: ${outcomeLabel[input.outcome]}`].filter(Boolean).join('\n');
  const {lead,duplicate}=await ingestLead({phone:input.phone,contactName:input.contactName,companyName:input.companyName,notes,title:input.contactName||input.companyName||input.phone},{userId:req.user!._id,channel:{name:'Phone call',channelType:'phone_call'}});
  const callType=await ActivityType.findOneAndUpdate({name:'Call'},{$setOnInsert:{icon:'phone',defaultDays:1,active:true}},{upsert:true,new:true});
  await createActivityWithRelations({activityType:callType._id,dueDate:new Date(),assignedTo:lead.salesperson??req.user!._id,summary:`Call logged: ${outcomeLabel[input.outcome]}`,notes:input.notes,relatedModel:'Lead',relatedId:lead._id,direction:'inbound',status:'completed',completedAt:new Date(),createdBy:req.user!._id});
  res.status(duplicate?200:201).json(await lead.populate(leadPop));
}
// The 360 view: everything one screen needs about a lead in a single round trip. A converted
// lead's story continues on the opportunity it became, so both records' timeline events and
// activities are merged into one stream instead of stopping at the moment of conversion.
export async function getLead(req:Request,res:Response){
  const lead=await Lead.findOne({_id:req.params.id,...accessScope(req)}).populate([...leadPop,{path:'channel',select:'name channelType'},{path:'lostReason',select:'name'},{path:'createdBy',select:'name avatar'}]);
  if(!lead)throw new ApiError(404,'Lead not found');
  const dealId=(lead.convertedOpportunity as any)?._id ?? lead.convertedOpportunity;
  const related=[{relatedModel:'Lead',relatedId:lead._id},...(dealId?[{relatedModel:'Opportunity',relatedId:dealId}]:[])];
  const activityMatch=[{lead:lead._id},...(dealId?[{opportunity:dealId}]:[])];
  const [timeline,activities,deal]=await Promise.all([
    TimelineEvent.find({$or:related}).populate('createdBy','name avatar').sort('-createdAt').limit(200),
    Activity.find({$or:activityMatch}).populate(activityPopulate).sort('dueDate'),
    dealId?Opportunity.findById(dealId).select('title expectedRevenue probability status stage expectedClosingDate').populate('stage','name color sequence probability isWon'):null,
  ]);
  res.json({...lead.toObject(),timeline,activities,deal});
}
export async function updateLead(req:Request,res:Response){const input=leadInput.partial().parse(req.body);if(input.status){const current=await Lead.findOne({_id:req.params.id,...accessScope(req)}).select('converted');if(current?.converted)throw new ApiError(409,'A converted lead cannot change status');}const doc=await Lead.findOneAndUpdate({_id:req.params.id,...accessScope(req)},{...input,updatedBy:req.user!._id},{new:true,runValidators:true});if(!doc)throw new ApiError(404,'Lead not found');res.json(doc);}
export async function deleteLead(req:Request,res:Response){const doc=await Lead.findOneAndDelete({_id:req.params.id,...accessScope(req)});if(!doc)throw new ApiError(404,'Lead not found');res.status(204).end();}
export async function convert(req:Request,res:Response){res.status(201).json(await convertLead(String(req.params.id),req.user!._id));}

export async function dashboard(_req:Request,res:Response){const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),tomorrow=new Date(today);tomorrow.setDate(today.getDate()+1);const [summary,pipeline,monthly,activities]=await Promise.all([Opportunity.aggregate([{$group:{_id:null,total:{$sum:1},expectedRevenue:{$sum:'$expectedRevenue'},wonRevenue:{$sum:{$cond:[{$eq:['$status','won']},'$expectedRevenue',0]}},won:{$sum:{$cond:[{$eq:['$status','won']},1,0]}},lost:{$sum:{$cond:[{$eq:['$status','lost']},1,0]}}}}]),Opportunity.aggregate([{$match:{status:'open'}},{$lookup:{from:'pipelinestages',localField:'stage',foreignField:'_id',as:'stage'}},{$unwind:'$stage'},{$group:{_id:'$stage.name',value:{$sum:'$expectedRevenue'},count:{$sum:1},sequence:{$first:'$stage.sequence'}}},{$sort:{sequence:1}}]),Opportunity.aggregate([{$match:{status:'won',wonAt:{$ne:null}}},{$group:{_id:{$dateToString:{format:'%Y-%m',date:'$wonAt'}},value:{$sum:'$expectedRevenue'}}},{$sort:{_id:1}},{$limit:12}]),Activity.aggregate([{$match:{status:'planned'}},{$facet:{today:[{$match:{dueDate:{$gte:today,$lt:tomorrow}}},{$count:'count'}],overdue:[{$match:{dueDate:{$lt:today}}},{$count:'count'}]}}])]);const s=summary[0]??{total:0,expectedRevenue:0,wonRevenue:0,won:0,lost:0};res.json({summary:{...s,conversionRate:s.won+s.lost?Math.round(s.won/(s.won+s.lost)*100):0,activitiesToday:activities[0]?.today[0]?.count??0,activitiesOverdue:activities[0]?.overdue[0]?.count??0},pipeline,monthly});}
export async function briefing(req:Request,res:Response){res.json(await getBriefing(req));}
export async function managerDashboard(req:Request,res:Response){res.json(await getManagerOverview(req));}
export async function report(req:Request,res:Response){const dimension=String(req.query.dimension??'stage');const measure=String(req.query.measure??'expectedRevenue');const allowed:any={stage:'stage',salesperson:'salesperson',salesTeam:'salesTeam',source:'source',campaign:'campaign',month:{$dateToString:{format:'%Y-%m',date:'$createdAt'}},lostReason:'lostReason'};if(!allowed[dimension])throw new ApiError(422,'Invalid dimension');const sum=measure==='count'?{$sum:1}:{$sum:measure==='proratedRevenue'?{$multiply:['$expectedRevenue',{$divide:['$probability',100]}]}:`$${['expectedRevenue','probability'].includes(measure)?measure:'expectedRevenue'}`};res.json(await Opportunity.aggregate([{$match:{}},{$group:{_id:allowed[dimension],value:sum,count:{$sum:1}}},{$sort:{value:-1}},{$limit:50}]));}

// Lead Source Attribution: for every source, how many leads it brought in, how many of those
// became paying customers (a won opportunity, which carries the source forward from the lead it
// converted from), and the ROI that buys - revenue from those wins against what the source costs
// to run (LeadSource.monthlySpend). This is the number that answers "where should we spend next
// month" - sourceAttribution.sort() below leaves that ranking to the client so it can also show
// sources with no spend recorded yet without them poisoning the sort.
export async function sourceAttribution(_req:Request,res:Response){
  const [sources,leadCounts,won]=await Promise.all([
    LeadSource.find({active:true}).sort('name'),
    Lead.aggregate([{$group:{_id:'$source',leads:{$sum:1}}}]),
    Opportunity.aggregate([{$match:{status:'won'}},{$group:{_id:'$source',customers:{$sum:1},revenue:{$sum:'$expectedRevenue'}}}]),
  ]);
  const leadsBySource=new Map(leadCounts.map(x=>[x._id?String(x._id):null,x.leads]));
  const wonBySource=new Map(won.map(x=>[x._id?String(x._id):null,{customers:x.customers,revenue:x.revenue}]));
  const rows=sources.map(source=>{
    const id=String(source._id);
    const leads=leadsBySource.get(id)??0;
    const w=wonBySource.get(id)??{customers:0,revenue:0};
    const spend=(source as any).monthlySpend??0;
    return {
      _id:source._id,name:source.name,leads,customers:w.customers,revenue:w.revenue,spend,
      conversionRate:leads?Math.round((w.customers/leads)*1000)/10:0,
      costPerCustomer:w.customers?Math.round(spend/w.customers):null,
      roi:spend>0?Math.round(((w.revenue-spend)/spend)*1000)/10:null,
    };
  });
  res.json(rows);
}

// The Activity Engine's write/read surface: creating an activity resolves and stores its full
// relationship web (see activity.service), and listing lets any screen - a lead, a contact, a
// company, a deal, a campaign report, a salesperson's day - filter down to just its own activities.
export async function createActivity(req:Request,res:Response){
  const input=activityInput.parse(req.body);
  const doc=await createActivityWithRelations({...input,assignedTo:input.assignedTo??req.user!._id,createdBy:req.user!._id});
  res.status(201).json(await doc.populate(activityPopulate));
}
export async function listActivities(req:Request,res:Response){
  const filter:Record<string,unknown>={};
  for(const key of ['lead','contact','company','opportunity','campaign','salesperson','assignedTo','status','relatedModel','activityType'] as const){
    const value=req.query[key];
    if(typeof value==='string'&&value) filter[key]=value;
  }
  res.json(await Activity.find(filter).populate(activityPopulate).sort('dueDate').limit(500));
}
export async function metadata(_req:Request,res:Response){const [stages,users,teams,tags,sources,campaigns,mediums,lostReasons,activityTypes]=await Promise.all([PipelineStage.find({active:true}).sort('sequence'),User.find({active:true}).select('name email avatar'),SalesTeam.find({active:true}),Tag.find({active:true}),LeadSource.find({active:true}),Campaign.find({active:true}),Medium.find({active:true}),LostReason.find({active:true}),ActivityType.find({active:true})]);res.json({stages,users,teams,tags,sources,campaigns,mediums,lostReasons,activityTypes});}
export async function genericList(model:any,req:Request,res:Response){res.json(await model.find({}).sort('name').limit(500));}
export const models:Record<string,any>={companies:Company,contacts:Contact,teams:SalesTeam,stages:PipelineStage,tags:Tag,sources:LeadSource,campaigns:Campaign,mediums:Medium,lostReasons:LostReason,activityTypes:ActivityType,activities:Activity,filters:SavedFilter,notifications:Notification};
