export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(`/api${path}`,{credentials:'include',headers:{'Content-Type':'application/json',...options.headers},...options});if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(response.status,body.error??'Request failed')}if(response.status===204)return undefined as T;return response.json()}
export const money=(value=0)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
export const date=(value?:string)=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)):'—';
export const initials=(name='?')=>name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
