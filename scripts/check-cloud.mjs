import fs from 'node:fs';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const base=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_ANON_KEY;
if(!base||!key)throw new Error('Koneksi publik belum lengkap.');
for(const path of ['/rest/v1/orders?select=local_id&limit=0','/rest/v1/cloud_memberships?select=device_id&limit=0']){
 try{const r=await fetch(base+path,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});const data=await r.json();console.log(JSON.stringify({table:path.includes('memberships')?'cloud_memberships':'orders',status:r.status,errorCode:Array.isArray(data)?null:data.code,anonymousReadAccepted:r.ok}));}
 catch(e){console.log(JSON.stringify({status:'unreachable',reason:e.cause?.code??e.name}));}
}
