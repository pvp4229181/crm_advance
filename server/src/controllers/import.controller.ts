import type { Request,Response } from 'express';
import { Lead,TimelineEvent } from '../models/index.js';
import { accessScope } from '../middleware/auth.js';
import { ApiError,escapeRegex } from '../utils/http.js';
import { runWorkflows } from '../services/workflow.service.js';

const allowed=['title','contactName','companyName','email','phone','expectedRevenue','priority','notes'] as const;
type Field=typeof allowed[number];
type ImportRow={row:number;data:Record<string,string>;errors:string[];duplicate?:{_id?:unknown;title:string}};
export async function importLeads(req:Request,res:Response){
  const {rows,mapping,confirm=false}=req.body as {rows?:Record<string,unknown>[];mapping?:Record<string,string>;confirm?:boolean};
  if(!Array.isArray(rows)||!mapping||typeof mapping!=='object')throw new ApiError(422,'Rows and column mapping are required');
  if(rows.length>2000)throw new ApiError(422,'Import is limited to 2,000 rows at a time');
  const mapped=Object.entries(mapping).filter(([,field])=>allowed.includes(field as Field));
  if(!mapped.some(([,field])=>field==='title'))throw new ApiError(422,'Map one CSV column to Lead title');
  const reviewed:ImportRow[]=[];const seenEmails=new Set<string>();const seenPhones=new Set<string>();
  for(let index=0;index<rows.length;index++){
    const data:Record<string,string>={};for(const[column,field]of mapped)data[field]=String(rows[index]?.[column]??'').trim();
    const errors:string[]=[];if(!data.title||data.title.length<2)errors.push('Lead title is required');if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))errors.push('Invalid email');if(data.expectedRevenue&&(!Number.isFinite(Number(data.expectedRevenue))||Number(data.expectedRevenue)<0))errors.push('Invalid deal value');if(data.priority&&!['0','1','2','3'].includes(data.priority))errors.push('Priority must be 0, 1, 2, or 3');
    const normalizedEmail=data.email?.toLowerCase();const digits=data.phone?.replace(/\D/g,'')??'';const duplicateInFile=Boolean((normalizedEmail&&seenEmails.has(normalizedEmail))||(digits.length>=7&&seenPhones.has(digits)));const duplicateConditions:any[]=[];if(normalizedEmail)duplicateConditions.push({email:normalizedEmail});if(digits.length>=7)duplicateConditions.push({phone:new RegExp(digits.slice(-7).split('').map(escapeRegex).join('\\D*')+'$')});const databaseDuplicate=duplicateConditions.length?await Lead.findOne({...accessScope(req),$or:duplicateConditions}).select('title').lean():null;const duplicate=databaseDuplicate??(duplicateInFile?{title:'Another row in this CSV'}:null);if(normalizedEmail)seenEmails.add(normalizedEmail);if(digits.length>=7)seenPhones.add(digits);
    reviewed.push({row:index+2,data,errors,...(duplicate?{duplicate:{...('_id'in duplicate?{_id:duplicate._id}:{}),title:duplicate.title}}:{})});
  }
  const valid=reviewed.filter(row=>!row.errors.length&&!row.duplicate);
  if(!confirm)return res.json({total:reviewed.length,valid:valid.length,duplicates:reviewed.filter(x=>x.duplicate).length,invalid:reviewed.filter(x=>x.errors.length).length,rows:reviewed});
  const created=await Lead.insertMany(valid.map(row=>({...row.data,email:row.data.email?.toLowerCase()||undefined,expectedRevenue:Number(row.data.expectedRevenue||0),priority:Math.min(3,Math.max(0,Number(row.data.priority||1))),createdBy:req.user!._id,updatedBy:req.user!._id})),{ordered:false});
  if(created.length)await TimelineEvent.insertMany(created.map(lead=>({createdBy:req.user!._id,relatedModel:'Lead',relatedId:lead._id,eventType:'lead_imported',message:'Lead imported from CSV'})));
  await runWorkflows('lead_created',created.map(lead=>lead.toObject()),req.user!._id);
  res.status(201).json({total:reviewed.length,valid:valid.length,imported:created.length,skipped:reviewed.length-created.length,duplicates:reviewed.filter(x=>x.duplicate).length,invalid:reviewed.filter(x=>x.errors.length).length,rows:reviewed});
}
