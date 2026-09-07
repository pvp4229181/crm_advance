import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Named } from '../lib/types';
import { Loading } from '../components/ui';
import { Brand } from './Login';

type InviteDetails = { name:string; email:string; role:Named; expiresAt:string };

export default function AcceptInvite(){
  const [params]=useSearchParams(); const token=params.get('token')||'';
  const [password,setPassword]=useState(''); const [confirmPassword,setConfirmPassword]=useState(''); const [show,setShow]=useState(false); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [complete,setComplete]=useState(false);
  const invite=useQuery({queryKey:['invitation',token],queryFn:()=>api<InviteDetails>(`/auth/invitations/${encodeURIComponent(token)}`),enabled:Boolean(token),retry:false});
  async function submit(event:React.FormEvent){event.preventDefault();setError('');if(password!==confirmPassword){setError('Passwords do not match');return}setBusy(true);try{await api(`/auth/invitations/${encodeURIComponent(token)}/accept`,{method:'POST',body:JSON.stringify({password,confirmPassword})});setComplete(true)}catch(cause){setError(cause instanceof Error?cause.message:'Unable to accept invitation')}finally{setBusy(false)}}
  if(invite.isLoading)return <div className="flex min-h-screen items-center justify-center bg-[#f0f9ff]"><Loading/></div>;
  return <div className="flex min-h-screen items-center justify-center bg-[#f0f9ff] p-4"><div className="w-full max-w-md rounded border bg-white p-7 shadow"><Brand/>{complete?<div className="text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={42}/><h2 className="mt-3 font-semibold">Your account is ready</h2><p className="mt-1 text-sm text-slate-500">You can now sign in to Lead CRM.</p><Link className="btn btn-primary mt-5 w-full" to="/login">Continue to sign in</Link></div>:invite.isError||!token?<div className="text-center"><h2 className="font-semibold text-red-700">Invitation unavailable</h2><p className="mt-2 text-sm text-slate-500">{invite.error instanceof Error?invite.error.message:'The invitation link is missing, invalid, or expired.'}</p><Link className="btn mt-5" to="/login">Return to sign in</Link></div>:<form onSubmit={submit}><div className="mb-5 flex items-start gap-3 rounded border border-sky-100 bg-sky-50 p-3"><ShieldCheck className="mt-0.5 shrink-0 text-[#0284c7]" size={18}/><div className="text-xs"><b>{invite.data!.name}</b><p className="mt-1 text-slate-600">You were invited as <strong>{invite.data!.role.name}</strong> using {invite.data!.email}.</p></div></div><Password label="Create password" value={password} set={setPassword} show={show} toggle={()=>setShow(value=>!value)}/><div className="mt-4"><Password label="Confirm password" value={confirmPassword} set={setConfirmPassword} show={show} toggle={()=>setShow(value=>!value)}/></div><p className="mt-2 text-[11px] text-slate-400">At least 8 characters with upper-case, lower-case, and numeric characters.</p>{error&&<p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}<button className="btn btn-primary mt-5 w-full" disabled={busy}>{busy?'Creating account…':'Accept invitation'}</button></form>}</div></div>;
}

function Password({label,value,set,show,toggle}:{label:string;value:string;set:(value:string)=>void;show:boolean;toggle:()=>void}){return <label><span className="label">{label}</span><div className="relative"><input className="field pr-10" type={show?'text':'password'} value={value} onChange={event=>set(event.target.value)} autoComplete="new-password" minLength={8} required/><button type="button" className="absolute right-0 top-0 flex h-9 w-10 items-center justify-center text-slate-500" onClick={toggle} aria-label={show?'Hide password':'Show password'}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label>}
