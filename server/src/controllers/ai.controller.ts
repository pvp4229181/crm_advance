import type { Request, Response } from 'express';
import { Activity, Lead, Opportunity } from '../models/index.js';
import { accessScope } from '../middleware/auth.js';
import { aiConfig, generateGroundedJson } from '../services/ai.service.js';
import { ApiError } from '../utils/http.js';

export function status(_req:Request,res:Response){res.json(aiConfig());}

export async function actionPlan(req:Request,res:Response){
  const scope=accessScope(req);const activityScope=(req.user!.role as any).name==='Administrator'?{}:{assignedTo:req.user!._id};
  const now=new Date();
  const[leads,deals,tasks]=await Promise.all([
    Lead.find({...scope,status:{$in:['new','qualified']}}).select('title contactName companyName expectedRevenue priority status updatedAt').sort({priority:-1,expectedRevenue:-1}).limit(12).lean(),
    Opportunity.find({...scope,status:'open'}).select('title expectedRevenue probability expectedClosingDate priority updatedAt').populate('stage','name').sort({expectedRevenue:-1}).limit(12).lean(),
    Activity.find({...activityScope,status:'planned'}).select('summary dueDate relatedModel').sort('dueDate').limit(12).lean(),
  ]);
  let result:any,provider='openrouter';
  try{
    result=await generateGroundedJson('Create a concise sales action plan. Return {"overview":string,"priorities":[{"title":string,"reason":string,"action":string,"urgency":"high"|"medium"|"low"}]}. Maximum 5 priorities.',{generatedAt:now.toISOString(),leads,deals,tasks},result=>typeof result?.overview==='string'&&Array.isArray(result?.priorities));
    if(typeof result?.overview!=='string'||!Array.isArray(result?.priorities))throw new ApiError(502,'OpenRouter returned an invalid action plan');
    result.priorities=result.priorities.filter((item:any)=>item&&typeof item.title==='string'&&typeof item.reason==='string'&&typeof item.action==='string'&&['high','medium','low'].includes(item.urgency)).slice(0,5);
  }catch(error){
    if(!(error instanceof ApiError)||![429,502,504].includes(error.status))throw error;
    provider='crm-rules';result=localActionPlan({leads,deals,tasks},now);
  }
  res.json({...result,provider,generatedAt:now.toISOString()});
}

function localActionPlan({leads,deals,tasks}:{leads:any[];deals:any[];tasks:any[]},now:Date){
  const priorities:any[]=[];
  for(const task of tasks){const overdue=new Date(task.dueDate)<now;priorities.push({title:task.summary,reason:`${overdue?'Overdue':'Due'} ${new Date(task.dueDate).toLocaleDateString('en-IN')}`,action:overdue?'Complete or reschedule this task today.':'Prepare for this scheduled follow-up.',urgency:overdue?'high':'medium'});if(priorities.length===5)break}
  for(const deal of deals){if(priorities.length===5)break;priorities.push({title:deal.title,reason:`Open ${deal.stage?.name??'pipeline'} opportunity worth ${deal.expectedRevenue??0}.`,action:'Review the latest activity and schedule the next customer follow-up.',urgency:deal.priority>=3?'high':deal.priority>=2?'medium':'low'});}
  for(const lead of leads){if(priorities.length===5)break;priorities.push({title:lead.contactName||lead.title,reason:`${lead.status} lead${lead.expectedRevenue?` worth ${lead.expectedRevenue}`:''}.`,action:'Review the lead and record the next sales action.',urgency:lead.priority>=3?'high':lead.priority>=2?'medium':'low'});}
  return{overview:priorities.length?`You have ${tasks.length} planned tasks, ${deals.length} open opportunities, and ${leads.length} active leads to review.`:'No urgent CRM work was found. Add follow-ups to build today’s plan.',priorities};
}
