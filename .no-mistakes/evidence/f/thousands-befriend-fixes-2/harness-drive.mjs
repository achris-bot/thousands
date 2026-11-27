import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = new URL('.', import.meta.url).pathname, EV = process.argv[2];
const dirs = { head: join(root,'../dist'), base: join(root,'base/dist') };
const srv = http.createServer((req,res)=>{ const p=new URL(req.url,'http://x').pathname; const m=p.match(/^\/(head|base)\/module\.js$/);
  if(m){res.setHeader('content-type','text/javascript');return res.end(readFileSync(join(dirs[m[1]],'module.js')));}
  if(p==='/'){res.setHeader('content-type','text/html');return res.end(readFileSync(join(root,'host.html')));} res.statusCode=404;res.end();});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const port=srv.address().port, prof=mkdtempSync(join(tmpdir(),'th-'));
const chrome=spawn('chromium',['--headless=new','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${prof}`,'about:blank'],{stdio:['ignore','ignore','pipe'],detached:true});
const wsUrl=await new Promise((res,rej)=>{let s='';chrome.stderr.on('data',d=>{s+=d;const m=s.match(/ws:\/\/\S+/);if(m)res(m[0]);});chrome.on('exit',()=>rej(new Error(s)));setTimeout(()=>rej(new Error('timeout '+s)),30000);});
const ws=new WebSocket(wsUrl); await new Promise(r=>ws.onopen=r);
let n=0; const pend=new Map(), pageErrors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id){const p=pend.get(m.id);pend.delete(m.id);m.error?p[1](new Error(JSON.stringify(m.error))):p[0](m.result);} else if(m.method==='Runtime.exceptionThrown')pageErrors.push(m.params.exceptionDetails.exception?.description);};
const send=(method,params={},sessionId)=>new Promise((a,b)=>{const id=++n;pend.set(id,[a,b]);ws.send(JSON.stringify({id,method,params,sessionId}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId:S}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Runtime.enable',{},S); await send('Page.enable',{},S);
await send('Emulation.setDeviceMetricsOverride',{width:660,height:900,deviceScaleFactor:1,mobile:false},S);
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true},S);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception.description);return r.result.value;};
const wait=async x=>{for(let i=0;i<200;i++){if(await ev(x))return;await new Promise(r=>setTimeout(r,25));}throw new Error('wait failed: '+x);};
const open=async(build,gm=1)=>{await send('Page.navigate',{url:`http://127.0.0.1:${port}/?build=${build}&gm=${gm}`},S);await wait(`location.search==='?build=${build}&gm=${gm}' && window.H?.ready===true`);};
const shot=async name=>{const {cssContentSize:c}=await send('Page.getLayoutMetrics',{},S);const dlg=await ev(`!!document.querySelector('dialog')`);
  const {data}=await send('Page.captureScreenshot',dlg?{}:{captureBeyondViewport:true,clip:{x:0,y:0,width:660,height:Math.ceil(c.height),scale:1}},S);writeFileSync(join(EV,name),Buffer.from(data,'base64'));};
const click=async sel=>{const r=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:r[0],y:r[1],button:'left',clickCount:1},S);};
// run /befriend, fill the real dialog, submit; resolves with the newly posted chat message id
async function befriend(fields){const before=await ev('H.messages.length');await ev(`H.command('/befriend')`);await wait(`!!document.querySelector('dialog')`);
  for(const k of ['target','student','action','skill','dc','note']) if(k in fields) await ev(`(()=>{const e=document.querySelector('dialog [name=${k}]');e.value=${JSON.stringify(String(fields[k]))};if(e.value!==${JSON.stringify(String(fields[k]))})throw new Error('bad ${k}');e.dispatchEvent(new Event('change'))})()`);
  await click('dialog [data-action=submit]');await wait(`H.messages.length>${before}`);return 'm'+before;}
const card=id=>ev(`document.querySelector('#${id} .thousands-befriend p')?.textContent`);
const content=id=>ev(`document.querySelector('#${id} .message-content').innerText`);
const hasApply=id=>ev(`!!document.querySelector('#${id} .thousands-befriend button')`);
async function apply(id){if(!(await hasApply(id)))console.log('NOAPPLY',id,await ev(`document.querySelector('#${id}').outerHTML`),await ev('JSON.stringify(H.messages.at(-1).flags)'));const before=await card(id);await click(`#${id} .thousands-befriend button`);await wait(`!document.querySelector('#${id} .thousands-befriend button')`);return card(id);}
const state=()=>ev(`H.actors.map(a=>({name:a.name,feats:a.items.map(i=>i.name),befriend:a.getFlag('thousands','befriend')?.students}))`);

const FORBIDDEN=/classroom advantage|unlocks|rhythm bone|verminous lure|impeccable flow|airburst|forgetful ink|lesson of calamity|stumbling curse|grave impressions|mind games|friendfetch/i;
const checks=[]; const check=(s,name,ok,detail)=>{checks.push({s,name,ok:!!ok,detail});};
const log={};
for(const build of ['base','head']){
  const L=log[build]={};
  // S1/S2: player rolls, GM applies
  await open(build,0);
  const r=await befriend({student:'mariama-keitana',skill:'diplomacy',dc:18,note:'Shared notes'});
  L.playerRoll={args:await ev('H.rolls[0]'),tags:await ev(`[...document.querySelectorAll('#${r} .tags span')].map(e=>e.textContent)`),options:await ev(`H.messages[0].flags.pf2e.context.options`),preview:await card(r),playerHasApply:await hasApply(r)};
  await shot(`${build}-player-roll.png`);
  // GM view: roll with each degree, from the GM dialog
  await open(build,1);
  const degrees={criticalSuccess:'Helpful',success:'Friendly',failure:'Indifferent',criticalFailure:'Unfriendly'}; const students=['mariama-keitana','noxolo','chizire','tzeniwe'];
  L.degrees=[];let i=0;
  for(const [deg,exp] of Object.entries(degrees)){await ev(`H.nextOutcome='${deg}'`);const id=await befriend({target:'0',student:students[i++],action:'roll',skill:'arcana',dc:15});
    const preview=await card(id), applied=await apply(id);L.degrees.push({deg,exp,preview,applied,args:await ev(`H.rolls.at(-1)`)});}
  L.degreeState=await state(); await shot(`${build}-gm-rolls-applied.png`);
  // S3: reroll replaces a befriending result (crit success -> failure) removes feat
  await open(build,1); await ev(`H.nextOutcome='criticalSuccess'`);
  const rr=await befriend({target:'0',student:'mariama-keitana',action:'roll'}); const a1=await apply(rr); const s1=await state();
  await ev(`H.messages[0].update({'flags.pf2e.context.outcome':'failure'})`); const p2=await card(rr); const a2=await apply(rr);
  L.reroll={first:a1,firstState:s1[0],replacePreview:p2,second:a2,secondState:(await state())[0]};
  // S4: direct GM updates, party, grant + remove
  await open(build,1); L.direct=[];
  for(const [label,f] of [['single grant',{target:'0',student:'mariama-keitana',action:'set:helpful'}],['single drop',{target:'0',student:'mariama-keitana',action:'delta:-1'}],['party grant',{target:'party',student:'noxolo',action:'delta:2',note:'Found the chicken'}],['party drop',{target:'party',student:'noxolo',action:'set:indifferent'}]]){
    const id=await befriend(f);const preview=await card(id),body=await content(id);await shot(`${build}-direct-${label.replace(' ','-')}-preview.png`);const applied=await apply(id);L.direct.push({label,body,preview,applied,state:await state()});}
  await shot(`${build}-gm-direct-chat.png`);
  // S5: every student, both thresholds, grant and remove: scan all chat text
  L.sweep={};
  for(const th of ['helpful','friendly']){await open(build,1);await ev(`H.overrides.befriendThreshold='${th}'`);const texts=[];let granted=0,removed=0;
    for(const stu of ['anchor-root','chizire','esi-djana','haibram-thodja','ignaci-canterells','mariama-keitana','noxolo','okoro-obiyo','tzeniwe']) for(const target of ['0','party']){
      if(target==='party') {} 
      for(const [action,kind] of [[`set:${th}`,'g'],['set:hostile','r']]){const id=await befriend({target,student:stu,action});texts.push(await content(id));
        const had=(await state())[0].feats.length;await apply(id);texts.push(await content(id));const has=(await state())[0].feats.length;if(has>had)granted++;if(has<had)removed++;}}
    L.sweep[th]={messages:await ev('H.messages.length'),granted,removed,leaks:texts.filter(t=>FORBIDDEN.test(t)),sample:texts.slice(0,4)};}
}
const H_=log.head;
check('roll','player roll args have no downtime',!JSON.stringify(H_.playerRoll.args).includes('downtime')&&H_.playerRoll.args.traits.length===0,H_.playerRoll.args);
check('roll','card tags/options no downtime',H_.playerRoll.tags.length===0&&!H_.playerRoll.options.includes('downtime'));
check('roll','gm rolls no downtime',H_.degrees.every(d=>!JSON.stringify(d.args).includes('downtime')));
check('apply','degrees apply',H_.degrees.every(d=>d.applied.includes(d.exp)),H_.degrees);
check('chat','degree texts clean',H_.degrees.every(d=>!FORBIDDEN.test(d.preview+d.applied)));
check('reroll','replace removes feat',H_.reroll.firstState.feats.length===1&&H_.reroll.secondState.feats.length===0&&H_.reroll.second.includes('Indifferent'),H_.reroll);
check('direct','direct texts clean',H_.direct.every(d=>!FORBIDDEN.test(d.body+d.preview+d.applied)));
check('direct','single grant',H_.direct[0].preview.includes('now befriended')&&H_.direct[0].applied.includes('now befriended')&&H_.direct[0].state[0].feats.length===1);
check('direct','single drop',H_.direct[1].preview.includes('no longer befriended')&&H_.direct[1].applied.includes('no longer befriended')&&H_.direct[1].state[0].feats.length===0);
check('direct','party feats',H_.direct[2].state.every(a=>a.feats.length===1)&&H_.direct[3].state.every(a=>a.feats.length===0));
for(const [th,s] of Object.entries(H_.sweep))check('sweep',th,s.leaks.length===0&&s.granted>=9&&s.removed>=9,{...s,leaks:s.leaks.length});
check('control','base shows old behaviour',log.base.playerRoll.tags.includes('downtime')&&log.base.sweep.helpful.leaks.length>0);
check('errors','no page errors',pageErrors.length===0,pageErrors);
writeFileSync(join(EV,'transcript.json'),JSON.stringify({log,checks,pageErrors},null,2));
for(const c of checks)console.log(c.ok?'PASS':'FAIL',c.s,c.name);
for(const b of ['base','head']){const l=log[b];console.log('\n==',b,JSON.stringify({roll:l.playerRoll,reroll:[l.reroll.first,l.reroll.replacePreview,l.reroll.second],degrees:l.degrees.map(d=>[d.deg,d.preview,d.applied]),direct:l.direct.map(d=>[d.label,d.body,d.preview,d.applied]),sweep:Object.fromEntries(Object.entries(l.sweep).map(([k,v])=>[k,[v.messages,v.granted,v.removed,v.leaks.length]]))},null,1));}
ws.close(); process.kill(-chrome.pid,'SIGKILL'); await new Promise(r=>chrome.exitCode!==null||chrome.signalCode?r():chrome.on('exit',r)); srv.close();
await new Promise(r=>setTimeout(r,500)); rmSync(prof,{recursive:true,force:true,maxRetries:5});
process.exit(checks.every(c=>c.ok)?0:1);
