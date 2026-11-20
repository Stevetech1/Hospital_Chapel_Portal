const CACHE='hospital-chapel-static-v2';
const PRECACHE=['/','/media/hospital-chapel-logo.jpeg','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 if(/^\/(admin|member-portal|parent-portal|student-portal|teacher-portal)(\/|$)/.test(url.pathname))return;
 if(url.pathname.startsWith('/api/'))return;
 if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/media/')||url.pathname==='/manifest.webmanifest'){
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return res;})));
  return;
 }
 if(req.mode==='navigate')event.respondWith(fetch(req).catch(()=>caches.match('/')));
});
