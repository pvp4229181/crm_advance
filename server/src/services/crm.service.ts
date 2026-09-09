// @ts-nocheck -- Mongoose cannot narrow transaction create overloads with optional refs.
import mongoose from'mongoose';import{Activity,ActivityType,Company,Contact,Lead,Notification,Opportunity,PipelineStage,TimelineEvent}from'../models/index.js';import{ApiError}from'../utils/http.js';
import{accessScope}from'../middleware/auth.js';
export async function convertLead(leadId:string,userId:mongoose.Types.ObjectId){const session=await mongoose.startSession();try{return await session.withTransaction(async()=>{const lead=await Lead.findOne({_id:leadId,converted:false}).session(session);if(!lead)throw new ApiError(409,'Lead was already converted or does not exist');let company=lead.companyName?await Company.findOne({name:lead.companyName}).session(session):null;if(!company&&lead.companyName)[company]=await Company.create([{name:lead.companyName,email:lead.email,phone:lead.phone,salesperson:lead.salesperson}],{session});let contact=lead.email?await Contact.findOne({email:lead.email}).session(session):null;if(!contact&&lead.contactName)[contact]=await Contact.create([{name:lead.contactName,company:company?._id,email:lead.email,phone:lead.phone,salesperson:lead.salesperson}],{session});const stage=await PipelineStage.findOne({active:true}).sort('sequence').session(session);if(!stage)throw new ApiError(422,'Configure a pipeline stage before converting leads');const[opportunity]=await Opportunity.create([{title:lead.title,company:company?._id,contact:contact?._id,email:lead.email,phone:lead.phone,expectedRevenue:lead.expectedRevenue,priority:lead.priority,salesperson:lead.salesperson,salesTeam:lead.salesTeam,tags:lead.tags,source:lead.source,medium:lead.medium,campaign:lead.campaign,stage:stage._id,createdBy:userId,updatedBy:userId}],{session});lead.converted=true;lead.status='converted';lead.convertedOpportunity=opportunity!._id;lead.updatedBy=userId;await lead.save({session});await TimelineEvent.create([{createdBy:userId,relatedModel:'Opportunity',relatedId:opportunity!._id,eventType:'opportunity_created',message:`Converted from lead “${lead.title}”`}],{session});if(lead.salesperson)await Notification.create([{user:lead.salesperson,title:'Opportunity assigned',message:lead.title,type:'assignment',link:`/opportunities/${opportunity!._id}`}],{session});return opportunity;});}finally{await session.endSession();}}
export async function moveOpportunity(id:string,stageId:string,orderedIds:string[],userId:mongoose.Types.ObjectId){const before=await Opportunity.findById(id);if(!before)throw new ApiError(404,'Opportunity not found');const stage=await PipelineStage.findById(stageId);if(!stage)throw new ApiError(404,'Stage not found');const changedStage=String(before.stage)!==stageId;await Opportunity.bulkWrite(orderedIds.map((opportunityId,index)=>({updateOne:{filter:{_id:opportunityId},update:opportunityId===id&&changedStage?{stage:stageId,kanbanOrder:index,updatedBy:userId,stageEnteredAt:new Date(),$unset:{staleNotifiedAt:1}}:{stage:stageId,kanbanOrder:index,updatedBy:userId}}})));if(changedStage)await TimelineEvent.create({createdBy:userId,relatedModel:'Opportunity',relatedId:id,eventType:'stage_changed',message:`Stage changed to ${stage.name}`});}

// Powers the "AI Sales Assistant" morning brief on the dashboard: today's numbers plus a ranked
// worklist of the deals that most need attention right now. Everything is scoped to the caller
// (accessScope) so a salesperson sees their own day while a manager/admin sees their team's/everyone's.
// Ranking is a plain weighted score, not a model call - "AI" here means "the CRM decided for you",
// not an LLM in the loop.
const DAY_MS=86400000;
export async function getBriefing(req:any){
  const scope=accessScope(req);
  const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const tomorrow=new Date(today);tomorrow.setDate(today.getDate()+1);
  const meetingType=await ActivityType.findOne({name:'Meeting'}).select('_id');
  const [hotLeads,overdueFollowUps,meetingsToday,pipeline,openOpps]=await Promise.all([
    Lead.countDocuments({...scope,hot:true,status:{$in:['new','qualified']}}),
    Activity.countDocuments({...scope,status:'planned',dueDate:{$lt:now}}),
    meetingType?Activity.countDocuments({...scope,status:'planned',activityType:meetingType._id,dueDate:{$gte:today,$lt:tomorrow}}):Promise.resolve(0),
    Opportunity.aggregate([{$match:{...scope,status:'open'}},{$group:{_id:null,value:{$sum:'$expectedRevenue'}}}]),
    Opportunity.find({...scope,status:'open'}).select('title expectedRevenue probability stageEnteredAt company').populate('company','name').sort({expectedRevenue:-1}).limit(30),
  ]);
  const oppIds=openOpps.map((o:any)=>o._id);
  const nextActivity=oppIds.length?await Activity.find({relatedModel:'Opportunity',relatedId:{$in:oppIds},status:'planned'}).select('relatedId dueDate').sort({dueDate:1}):[];
  const nextByOpp=new Map<string,Date>();
  for(const a of nextActivity)if(!nextByOpp.has(String(a.relatedId)))nextByOpp.set(String(a.relatedId),a.dueDate);
  const priorities=openOpps.map((o:any)=>{
    const next=nextByOpp.get(String(o._id));
    const overdueDays=next&&next<now?Math.max(1,Math.round((now.getTime()-next.getTime())/DAY_MS)):0;
    const daysStuck=o.stageEnteredAt?Math.floor((now.getTime()-o.stageEnteredAt.getTime())/DAY_MS):0;
    const reason=overdueDays>0?`Follow-up overdue by ${overdueDays} day${overdueDays>1?'s':''}`:daysStuck>=7?`Deal has been stuck for ${daysStuck} days`:o.probability>=70?'High win probability — follow up today':'No activity scheduled — reach out';
    const score=o.probability*0.6+overdueDays*15+Math.max(0,daysStuck-5)*4+o.expectedRevenue/50000;
    return{_id:o._id,title:o.title,company:o.company?.name,probability:o.probability,expectedRevenue:o.expectedRevenue,overdueDays,daysStuck,reason,score};
  }).sort((a:any,b:any)=>b.score-a.score).slice(0,5).map(({score,...rest}:any)=>rest);
  return{hotLeads,overdueFollowUps,meetingsToday,pipelineValue:pipeline[0]?.value??0,priorities};
}

// Powers the Manager Dashboard: team-wide totals, per-rep won revenue, a stage-by-stage funnel and a
// plain-English "biggest bottleneck" line. The bottleneck isn't a model call either — it compares how
// many deals moved from one stage into the next this month against last month (via the stage_changed/
// opportunity_created TimelineEvent trail) and surfaces whichever adjacent pair dropped the most.
export async function getManagerOverview(req:any){
  const scope=accessScope(req);
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
  const lastMonthStart=new Date(now.getFullYear(),now.getMonth()-1,1);
  const lastMonthEnd=monthStart;
  const [totals,team,stages,scopedOpps]=await Promise.all([
    Opportunity.aggregate([
      {$match:scope},
      {$group:{_id:null,
        pipelineValue:{$sum:{$cond:[{$eq:['$status','open']},'$expectedRevenue',0]}},
        wonRevenue:{$sum:{$cond:[{$eq:['$status','won']},'$expectedRevenue',0]}},
        monthRevenue:{$sum:{$cond:[{$and:[{$eq:['$status','won']},{$gte:['$wonAt',monthStart]}]},'$expectedRevenue',0]}},
        won:{$sum:{$cond:[{$eq:['$status','won']},1,0]}},
        lost:{$sum:{$cond:[{$eq:['$status','lost']},1,0]}}}}
    ]),
    Opportunity.aggregate([
      {$match:{...scope,status:'won',salesperson:{$ne:null}}},
      {$group:{_id:'$salesperson',revenue:{$sum:'$expectedRevenue'}}},
      {$sort:{revenue:-1}},{$limit:8},
      {$lookup:{from:'users',localField:'_id',foreignField:'_id',as:'user'}},{$unwind:'$user'},
      {$project:{_id:0,salesperson:'$user.name',revenue:1}}
    ]),
    PipelineStage.find({active:true}).sort('sequence').select('name sequence isWon'),
    Opportunity.find(scope).select('_id').lean(),
  ]);
  const stageCounts=await Promise.all(stages.map((stage:any)=>stage.isWon
    ?Opportunity.countDocuments({...scope,status:'won'})
    :Opportunity.countDocuments({...scope,status:'open',stage:stage._id})));
  const funnel=stages.map((stage:any,i:number)=>({name:stage.name,count:stageCounts[i]}));
  const t=totals[0]??{pipelineValue:0,wonRevenue:0,monthRevenue:0,won:0,lost:0};
  const conversionRate=t.won+t.lost?Math.round((t.won/(t.won+t.lost))*1000)/10:0;
  const avgDeal=t.won?Math.round(t.wonRevenue/t.won):0;
  const insight=await bottleneckInsight(scopedOpps.map((o:any)=>o._id),stages,lastMonthStart,lastMonthEnd,monthStart,now);
  return{overview:{revenue:t.monthRevenue,pipeline:t.pipelineValue,won:t.wonRevenue,conversionRate,avgDeal},team,funnel,insight};
}
async function bottleneckInsight(oppIds:mongoose.Types.ObjectId[],stages:any[],lastMonthStart:Date,lastMonthEnd:Date,monthStart:Date,now:Date){
  const openStages=stages.filter(s=>!s.isWon).sort((a,b)=>a.sequence-b.sequence);
  if(openStages.length<2||oppIds.length===0)return'Not enough pipeline movement yet to spot a bottleneck.';
  const events=await TimelineEvent.find({relatedModel:'Opportunity',relatedId:{$in:oppIds},eventType:{$in:['opportunity_created','stage_changed']},createdAt:{$gte:lastMonthStart}}).select('eventType message createdAt').lean();
  const entries=(stageName:string,isFirst:boolean,from:Date,to:Date)=>events.filter((e:any)=>e.createdAt>=from&&e.createdAt<to&&(isFirst?e.eventType==='opportunity_created':e.eventType==='stage_changed'&&e.message===`Stage changed to ${stageName}`)).length;
  let worst:{from:string;to:string;delta:number}|null=null;
  for(let i=0;i<openStages.length-1;i++){
    const a=openStages[i],b=openStages[i+1];
    const thisA=entries(a.name,i===0,monthStart,now),thisB=entries(b.name,false,monthStart,now);
    const lastA=entries(a.name,i===0,lastMonthStart,lastMonthEnd),lastB=entries(b.name,false,lastMonthStart,lastMonthEnd);
    if(thisA<3||lastA<3)continue;
    const delta=(thisB/thisA-lastB/lastA)*100;
    if(!worst||delta<worst.delta)worst={from:a.name,to:b.name,delta};
  }
  if(!worst||worst.delta>=-1)return'Pipeline conversion is steady across stages this month — no significant bottleneck detected.';
  return`Your biggest pipeline bottleneck is ${worst.from} → ${worst.to}. Conversion has dropped ${Math.abs(Math.round(worst.delta))}% this month.`;
}
