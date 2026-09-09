export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(`/api${path}`,{credentials:'include',headers:{'Content-Type':'application/json',...options.headers},...options});if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(response.status,body.error??'Request failed')}if(response.status===204)return undefined as T;return response.json()}
export const money=(value=0)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
export const date=(value?:string)=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)):'—';
// Timeline entries are read as "how long ago", not as calendar dates, so the recent past gets a
// clock and a familiar word and anything older falls back to a plain date.
const midnight=(value:Date)=>new Date(value.getFullYear(),value.getMonth(),value.getDate()).getTime();
export const time=(value:string)=>new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function when(value?:string){if(!value)return'—';const at=new Date(value);const days=Math.round((midnight(at)-midnight(new Date()))/86400000);if(days===0)return`Today ${time(value)}`;if(days===-1)return`Yesterday ${time(value)}`;if(days===1)return`Tomorrow ${time(value)}`;if(days>1&&days<7)return`${new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(at)} ${time(value)}`;return date(value)}
export const initials=(name='?')=>name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
