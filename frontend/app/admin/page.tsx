'use client';
import ImageCarousel from '../../components/ImageCarousel';
import { useCallback, useEffect, useState } from 'react';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000';
const modules=[
 {title:'User & Access Management',href:'/admin/users',desc:'Create accounts, roles, access and account status.',scope:'CHURCH'},
 {title:'Leadership',href:'/admin/leadership',desc:'Pastors, secretaries, board and leadership profiles.',scope:'CHURCH'},
 {title:'Departments & Committees',href:'/admin/departments',desc:'Ministries, committee terms and assigned leaders.',scope:'CHURCH'},
 {title:'Family Units',href:'/admin/family-units',desc:'Twelve family units, leaders, members and activities.',scope:'CHURCH'},
 {title:'Prophetic Themes',href:'/admin/themes',desc:'Annual themes, monthly subtopics and Bible references.',scope:'CHURCH'},
 {title:'Events & Programmes',href:'/admin/events',desc:'Calendar, services and special programmes.',scope:'CHURCH'},
 {title:'Sermons & Media',href:'/admin/sermons',desc:'Sermon metadata and approved media links.',scope:'CHURCH'},
 {title:'Church Projects',href:'/admin/projects',desc:'Project records, milestones and reports.',scope:'CHURCH'},
 {title:'Outreach',href:'/admin/outreach',desc:'Community outreach and aggregate impact reporting.',scope:'CHURCH'},
 {title:'Prayer Requests',href:'/admin/prayer-requests',desc:'Private prayer queue and pastoral follow-up.',scope:'CHURCH'},
 {title:'Testimonies',href:'/admin/testimonies',desc:'Review and approve testimony submissions.',scope:'CHURCH'},
 {title:'Finance & Donations',href:'/admin/finance',desc:'Donation reconciliation and finance summary.',scope:'CHURCH'},
 {title:'Reports',href:'/admin/reports',desc:'Institutional aggregate reports.',scope:'ALL'},
 {title:'Documents & Media',href:'/admin/media',desc:'Secure files and content repository.',scope:'CHURCH'},
 {title:'Platform Configuration',href:'/admin/settings',desc:'Configuration checklist, social URLs, email and payment setup.',scope:'SYSTEM'},
 {title:'Website Content',href:'/admin/content-pages',desc:'Public content pages and announcements.',scope:'CHURCH'},
 {title:'Academy Administration',href:'/admin/workspace',desc:'Academy users, classes, students, guardians and academic records.',scope:'ACADEMY'},
];
export default function AdminHome(){const [user,setUser]=useState<any>(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const api=useCallback(async(path:string,init:RequestInit={})=>{const r=await fetch(`${API}${path}`,{...init,credentials:'include',headers:{'Content-Type':'application/json',...(init.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;},[]);
 const check=useCallback(async()=>{try{const d=await api('/api/auth/me');setUser(d)}catch{setUser(null)}},[api]);useEffect(()=>{check()},[check]);
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('Signing in…');try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});setPassword('');await check();setMessage('Signed in successfully.')}catch(err){setMessage(err instanceof Error?err.message:'Unable to sign in.')}finally{setBusy(false)}}
 async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch{}setUser(null);setMessage('You have signed out.')} 
 if(!user)return <main className="admin-shell"><ImageCarousel compact/><div className="admin-brand"><img src="/media/hospital-chapel-logo.jpeg" alt="Hospital Chapel logo"/><div><b>HOSPITAL CHAPEL UATH</b><small>Secure administration portal</small></div></div><section className="login-card"><span className="eyebrow">AUTHORIZED PERSONNEL ONLY</span><h1>Administrator sign in</h1><p>Use the account provided by the authorized platform administrator. Public registration is disabled.</p><form onSubmit={login}><label>Email address<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in securely'}</button></form><p><a href="/forgot-password">Forgot your password?</a></p><p className="status-msg">{message}</p><a href="/">← Return to public website</a></section></main>;
 const visible=modules.filter(m=>m.scope==='ALL'||(user.scope==='SYSTEM')||(m.scope==='ACADEMY'&&user.scope==='ACADEMY')||(m.scope==='CHURCH'&&user.scope==='CHURCH'));
 return <main className="admin-home"><header className="admin-home-header"><div className="admin-brand"><img src="/media/hospital-chapel-logo.jpeg" alt="Hospital Chapel logo"/><div><b>HOSPITAL CHAPEL UATH</b><small>Administration Control Centre</small></div></div><div className="admin-user"><span>{user.fullName}<small>{user.role} · {user.scope}</small></span><button className="outline" onClick={logout}>Sign out</button></div></header><ImageCarousel compact/><section className="admin-home-welcome"><span className="eyebrow">{user.scope==='SYSTEM'?'PLATFORM SUPER ADMINISTRATION':user.scope==='ACADEMY'?'ACADEMY ADMINISTRATION':'CHURCH ADMINISTRATION'}</span><h1>Welcome, {user.fullName}</h1><p>Choose a dedicated module below. Each section has its own page, workflow and access controls.</p></section><section className="admin-module-grid">{visible.map(m=><a className="admin-module-card" href={m.href} key={m.href}><span>OPEN MODULE ↗</span><h2>{m.title}</h2><p>{m.desc}</p></a>)}</section><section className="admin-home-tools"><a href="/admin/workspace">Open full administration workspace ↗</a><a href="/">View public website ↗</a><a href="/forgot-password">Password recovery ↗</a></section><p className="admin-home-note">System-wide access is reserved for Super Administrators. All privileged actions are subject to server-side authorization and audit logging.</p></main>;
}
