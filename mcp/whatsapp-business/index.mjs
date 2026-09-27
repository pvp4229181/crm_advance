#!/usr/bin/env node
// MCP server for the Meta WhatsApp Cloud API. It reads the same WHATSAPP_* credentials as the CRM
// (server/.env), so it talks to the business number the CRM already uses. Talks over stdio.
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

// Variables already set in the environment (e.g. from .mcp.json "env") win over server/.env.
try{process.loadEnvFile(fileURLToPath(new URL('../../server/.env',import.meta.url)))}catch{}

const env=name=>process.env[name]?.trim()||undefined;
const graphUrl=path=>`https://graph.facebook.com/${env('WHATSAPP_GRAPH_VERSION')||'v23.0'}/${path}`;

async function graph(path,{method='GET',body}={}){
  const token=env('WHATSAPP_ACCESS_TOKEN');
  if(!token)throw new Error('WHATSAPP_ACCESS_TOKEN is not set. Add it to server/.env.');
  const response=await fetch(graphUrl(path),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const error=result?.error;throw new Error(error?.error_user_msg||error?.error_data?.details||error?.message||`Meta returned HTTP ${response.status}`)}
  return result;
}

const required=name=>{const value=env(name);if(!value)throw new Error(`${name} is not set. Add it to server/.env.`);return value};

async function sendMessage(to,message){
  const recipient=to.replace(/\D/g,'');
  if(recipient.length<8)throw new Error('Use a full international phone number, e.g. 919876543210');
  const result=await graph(`${required('WHATSAPP_PHONE_NUMBER_ID')}/messages`,{method:'POST',body:{messaging_product:'whatsapp',recipient_type:'individual',to:recipient,...message}});
  return{to:result?.contacts?.[0]?.wa_id??recipient,messageId:result?.messages?.[0]?.id??null,status:result?.messages?.[0]?.message_status??'accepted'};
}

// Every tool returns JSON text; failures come back as tool errors so the model sees Meta's reason.
const tool=handler=>async args=>{
  try{return{content:[{type:'text',text:JSON.stringify(await handler(args),null,2)}]}}
  catch(error){return{isError:true,content:[{type:'text',text:error instanceof Error?error.message:String(error)}]}}
};

const phone=z.string().describe('Recipient phone number in international format, digits only or with +, e.g. 919876543210');
const readOnly={readOnlyHint:true,openWorldHint:true};
const sends={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true};

const server=new McpServer({name:'whatsapp-business',version:'1.0.0'});

server.registerTool('whatsapp_get_business_profile',{
  title:'Get WhatsApp business profile',
  description:'Shows the connected business phone number (display number, verified name, quality rating, messaging tier) and its public business profile.',
  inputSchema:{},annotations:readOnly,
},tool(async()=>{
  const id=required('WHATSAPP_PHONE_NUMBER_ID');
  const [number,profile]=await Promise.all([
    graph(`${id}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,messaging_limit_tier,platform_type,throughput`),
    graph(`${id}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical,profile_picture_url`),
  ]);
  return{phoneNumber:number,profile:profile?.data?.[0]??null};
}));

server.registerTool('whatsapp_list_phone_numbers',{
  title:'List business phone numbers',
  description:'Lists every phone number registered on the WhatsApp Business Account.',
  inputSchema:{},annotations:readOnly,
},tool(async()=>(await graph(`${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`)).data??[]));

server.registerTool('whatsapp_list_templates',{
  title:'List message templates',
  description:'Lists message templates on the WhatsApp Business Account with their status, category, language and components. Only APPROVED templates can be sent.',
  inputSchema:{
    status:z.enum(['APPROVED','PENDING','REJECTED','PAUSED','DISABLED']).optional().describe('Only return templates with this status'),
    name:z.string().optional().describe('Only return templates whose name contains this text'),
  },
  annotations:readOnly,
},tool(async({status,name})=>{
  const params=new URLSearchParams({fields:'id,name,language,status,category,components,rejected_reason',limit:'100'});
  if(status)params.set('status',status);
  if(name)params.set('name',name);
  const templates=[];
  let path=`${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/message_templates?${params}`;
  // Follow Meta's cursor paging; the "next" link is absolute, so strip it back to a Graph path.
  while(path){
    const page=await graph(path);templates.push(...(page.data??[]));
    path=page.paging?.next?page.paging.next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//,''):null;
  }
  return templates;
}));

server.registerTool('whatsapp_send_text',{
  title:'Send WhatsApp text',
  description:'Sends a free-form text message. Meta only delivers these within 24 hours of the customer\'s last message to the business; outside that window send an approved template instead.',
  inputSchema:{
    to:phone,
    body:z.string().min(1).max(4096).describe('Message text'),
    previewUrl:z.boolean().optional().describe('Render a link preview for the first URL in the text'),
  },
  annotations:sends,
},tool(({to,body,previewUrl})=>sendMessage(to,{type:'text',text:{preview_url:Boolean(previewUrl),body}})));

server.registerTool('whatsapp_send_template',{
  title:'Send WhatsApp template',
  description:'Sends an approved message template, which works outside the 24-hour window. Pass one value per {{n}} placeholder, in order.',
  inputSchema:{
    to:phone,
    name:z.string().describe('Template name exactly as in Meta, e.g. hello_world'),
    language:z.string().default('en_US').describe('Template language code, e.g. en_US or en'),
    bodyParameters:z.array(z.string()).optional().describe('Values for the body {{1}}, {{2}}, ... placeholders, in order'),
    headerParameters:z.array(z.string()).optional().describe('Values for text header placeholders, in order'),
  },
  annotations:sends,
},tool(({to,name,language,bodyParameters=[],headerParameters=[]})=>{
  const text=values=>values.map(value=>({type:'text',text:value}));
  const components=[
    ...(headerParameters.length?[{type:'header',parameters:text(headerParameters)}]:[]),
    ...(bodyParameters.length?[{type:'body',parameters:text(bodyParameters)}]:[]),
  ];
  return sendMessage(to,{type:'template',template:{name,language:{code:language},...(components.length?{components}:{})}});
}));

server.registerTool('whatsapp_send_media',{
  title:'Send WhatsApp media',
  description:'Sends an image, document, video or audio file from a public HTTPS link. Like text, this needs the 24-hour window to be open.',
  inputSchema:{
    to:phone,
    type:z.enum(['image','document','video','audio']),
    link:z.url().describe('Public HTTPS URL of the file'),
    caption:z.string().max(1024).optional().describe('Caption (not supported for audio)'),
    filename:z.string().optional().describe('File name shown for documents'),
  },
  annotations:sends,
},tool(({to,type,link,caption,filename})=>sendMessage(to,{type,[type]:{link,...(caption&&type!=='audio'?{caption}:{}),...(filename&&type==='document'?{filename}:{})}})));

await server.connect(new StdioServerTransport());
