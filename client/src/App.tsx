import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/Auth';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import Login from './pages/Login';
import { routeChunk } from './lib/routes';

// Every route below is fetched on demand. recharts (Dashboard, Pipeline, Reporting),
// @dnd-kit (Pipeline) and @tanstack/react-table (Leads) are most of the bundle, and
// none of them are needed to paint the login screen. Login itself stays eager: it is
// the first thing an unauthenticated visitor sees, so splitting it would only add a
// round trip before anything renders. Shell warms these same chunks on hover, so a
// navigation rarely waits on the download.
const Signup=lazy(()=>import('./pages/Signup'));
const AcceptInvite=lazy(()=>import('./pages/AcceptInvite'));
const Dashboard=lazy(routeChunk['/']);
const Pipeline=lazy(routeChunk['/pipeline']);
const Leads=lazy(routeChunk['/leads']);
const OpportunityDetail=lazy(()=>import('./pages/OpportunityDetail'));
const Activities=lazy(()=>routeChunk['/activities']().then(m=>({default:m.Activities})));
const Calendar=lazy(()=>routeChunk['/calendar']().then(m=>({default:m.Calendar})));
const Contacts=lazy(()=>routeChunk['/contacts']().then(m=>({default:m.Contacts})));
const Reporting=lazy(routeChunk['/reporting']);
const Configuration=lazy(routeChunk['/configuration']);
const Notifications=lazy(routeChunk['/notifications']);

export default function App(){
  const {user,loading}=useAuth();
  if(loading)return <Loading/>;
  if(!user)return <Suspense fallback={<Loading/>}><Routes><Route path="/login" element={<Login/>}/><Route path="/signup" element={<Signup/>}/><Route path="/accept-invite" element={<AcceptInvite/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes></Suspense>;
  return <Shell><Suspense fallback={<Loading/>}><Routes><Route path="/" element={<Dashboard/>}/><Route path="/pipeline" element={<Pipeline/>}/><Route path="/leads" element={<Leads/>}/><Route path="/opportunities/:id" element={<OpportunityDetail/>}/><Route path="/activities" element={<Activities/>}/><Route path="/calendar" element={<Calendar/>}/><Route path="/contacts" element={<Contacts/>}/><Route path="/reporting" element={<Reporting/>}/><Route path="/configuration" element={['Administrator','Sales Manager'].includes(user.role.name)?<Configuration/>:<Navigate to="/"/>}/><Route path="/notifications" element={<Notifications/>}/><Route path="/login" element={<Navigate to="/" replace/>}/><Route path="/signup" element={<Navigate to="/" replace/>}/><Route path="/accept-invite" element={<Navigate to="/" replace/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></Suspense></Shell>;
}
