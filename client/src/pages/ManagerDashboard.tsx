import{useQuery}from'@tanstack/react-query';import{api,money}from'../lib/api';import{PageHeader}from'../components/Shell';import{Loading}from'../components/ui';import{Bar,BarChart,CartesianGrid,Cell,ResponsiveContainer,Tooltip,XAxis,YAxis}from'recharts';import{BadgeDollarSign,CheckCircle2,Funnel,Sparkles,Target,TrendingUp}from'lucide-react';
type Overview={revenue:number;pipeline:number;won:number;conversionRate:number;avgDeal:number};
type TeamRow={salesperson:string;revenue:number};
type FunnelRow={name:string;count:number};
type Data={overview:Overview;team:TeamRow[];funnel:FunnelRow[];insight:string};
const COLORS=['#0284c7','#38bdf8','#3b82f6','#6366f1','#8b5cf6','#a855f7','#c084fc','#e879f9'];
export default function ManagerDashboard(){
  const{data,isLoading}=useQuery({queryKey:['dashboard','manager'],queryFn:()=>api<Data>('/dashboard/manager')});
  if(isLoading)return <Loading/>;
  const o=data!.overview;
  const cards=[['Revenue',money(o.revenue),TrendingUp],['Pipeline',money(o.pipeline),Funnel],['Won',money(o.won),CheckCircle2],['Conversion',`${o.conversionRate}%`,Target],['Avg Deal',money(o.avgDeal),BadgeDollarSign]] as const;
  const maxFunnel=Math.max(1,...data!.funnel.map(f=>f.count));
  return <><PageHeader title="Manager Dashboard" subtitle="Team performance and pipeline health"/><div className="p-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{cards.map(([label,value,Icon])=><div className="panel p-3" key={label}><div className="flex items-center justify-between text-xs text-slate-500"><span>{label}</span><Icon size={16}/></div><div className="mt-2 text-xl font-semibold">{value}</div></div>)}</div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="panel p-4"><h2 className="mb-3 text-sm font-semibold">Team performance</h2>{data!.team.length===0?<p className="text-sm text-slate-500">No won deals yet.</p>:<ResponsiveContainer width="100%" height={Math.max(180,data!.team.length*44)}><BarChart data={data!.team} layout="vertical" margin={{left:8,right:24}}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" fontSize={11} tickFormatter={v=>money(Number(v))}/><YAxis type="category" dataKey="salesperson" fontSize={12} width={90}/><Tooltip formatter={v=>money(Number(v))}/><Bar dataKey="revenue" radius={[0,4,4,0]}>{data!.team.map((_,i)=><Cell fill={COLORS[i%COLORS.length]} key={i}/>)}</Bar></BarChart></ResponsiveContainer>}</section>
      <section className="panel p-4"><h2 className="mb-3 text-sm font-semibold">Pipeline</h2><div className="space-y-2">{data!.funnel.map(f=><div key={f.name} className="flex items-center gap-3"><span className="w-24 shrink-0 truncate text-xs text-slate-500">{f.name}</span><div className="h-5 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-sky-500" style={{width:`${Math.max(4,f.count/maxFunnel*100)}%`}}/></div><span className="w-10 shrink-0 text-right text-sm font-medium">{f.count}</span></div>)}</div></section>
    </div>
    <section className="panel mt-4 overflow-hidden bg-gradient-to-br from-sky-600 to-indigo-700 p-5 text-white">
      <div className="flex items-center gap-2 text-sm font-medium text-sky-100"><Sparkles size={16}/><span>AI Insights</span></div>
      <p className="mt-2 text-lg font-medium">“{data!.insight}”</p>
    </section>
  </div></>;
}
