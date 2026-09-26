export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(`/api${path}`,{credentials:'include',headers:{'Content-Type':'application/json',...options.headers},...options});if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(response.status,body.error??'Request failed')}if(response.status===204)return undefined as T;return response.json()}
export const money=(value=0)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
// Short Indian units for tight spaces: 3,60,000 -> ₹3.6L, 1,25,00,000 -> ₹1.25Cr.
export const moneyShort=(value=0)=>{const abs=Math.abs(value);const [unit,size,digits]=abs>=1e7?['Cr',1e7,2]:abs>=1e5?['L',1e5,1]:abs>=1e3?['K',1e3,1]:['',1,0];return `${value<0?'-':''}₹${new Intl.NumberFormat('en-IN',{maximumFractionDigits:digits}).format(abs/size)}${unit}`;};
export const date=(value?:string)=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)):'—';
export const initials=(name='?')=>name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
