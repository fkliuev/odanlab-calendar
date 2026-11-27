'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const clock=m=>pad(Math.floor(m/60))+':'+pad(m%60);
const span=(a,b)=>clock(a)+'–'+clock(b);
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const add=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const fmt=(d,options)=>new Date(d+'T12:00:00Z').toLocaleDateString('ru-RU',options);
const statuses={pending:'Ждём ответа',confirmed:'Подтверждено',reschedule:'Нужен перенос',accepted:'Подтвердил',declined:'Не сможет'};
let session=sessionStorage.getItem('olab.session')||'', day=today(), picked=[], state, first,last, sequence=0,drag=null,submitting=false;
const dialog=$('#dialog');
const who=id=>state?.members.find(m=>m.id===id)?.name||id;
function tell(msg){$('#notice').textContent=msg}
function modal(title,html){$('#dialog-title').textContent=title;$('#contents').innerHTML=html;$('#error').textContent='';if(!dialog.open)dialog.showModal()}
function close(){dialog.close()}
$('#close').onclick=close;
async function api(path,method='GET',data){
 const res=await fetch(window.CALENDAR_API+'/api/'+path,{method,credentials:'omit',headers:{...(session?{Authorization:'Bearer '+session}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 const out=await res.json();
 if(!res.ok){
   if(res.status===401&&session){session='';sessionStorage.removeItem('olab.session');if(dialog.open)close();$('#workspace').hidden=true;$('#signin').hidden=false}
   throw Error(out.error||'Не удалось выполнить запрос.');
 }
 return out;
}
async function load(){
 if(!session)return;
 const order=++sequence;
 const data=await api('week?'+new URLSearchParams({date:day,people:picked.join(',')}));
 if(order!==sequence)return;
 state=data;$('#workspace').hidden=false;$('#signin').hidden=true;render();
}
function safely(fn){return async(...args)=>{try{await fn(...args)}catch(err){(dialog.open?$('#error'):$('#notice')).textContent=err.message}}}
async function save(path,method,data){
 if(submitting)return;
 submitting=true;
 try{await api(path,method,data);close();await load();tell('Сохранено.')}finally{submitting=false}
}
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
$('#sso-login').onclick=safely(async()=>{
 const proof=base64url(crypto.getRandomValues(new Uint8Array(40)));
 const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof))));
 sessionStorage.setItem('olab.proof',proof);
 location.assign(window.CALENDAR_API+'/api/odan/start?challenge='+challenge);
});
async function signinStatus(){
 const cfg=await api('auth/status');
 $('#sso-login').disabled=!cfg.ready;
 $('#auth-status').textContent=cfg.ready?'Пароль вводится на странице авторизации OdanLab.':'Вход станет доступен после регистрации календаря в SSO OdanLab.';
}
$('#logout').onclick=safely(async()=>{await api('logout','POST',{});sessionStorage.removeItem('olab.session');location.reload()});
const selectors=()=>picked.length?picked:state.members.map(m=>m.id);
function position(a,b){return 'top:'+100*(a-first)/(last-first)+'%;height:calc('+100*(b-a)/(last-first)+'% - 1px);'}
const handles='<i class="edge top" data-edge="start"></i><i class="edge bottom" data-edge="end"></i>';
function eventButton(e){
 const label=e.kind==='presence'?(e.owner===state.me?'Я в лабе':who(e.owner)):e.title||'Занято';
 return '<b>'+esc(label)+'</b><small>'+span(e.a,e.b)+'</small>'+(e.editable?handles:'');
}
function gridCol(d){
 const shown=selectors();
 const present=state.events.filter(e=>e.day===d&&e.kind==='presence'&&(e.owner===state.me?shown.includes(e.owner):picked.length===1&&picked[0]===e.owner));
 const records=state.events.filter(e=>e.day===d&&e.kind!=='presence'&&(e.kind==='seminar'||(picked.length?e.people.some(id=>picked.includes(id)):e.owner===state.me||e.people.includes(state.me)||e.kind==='meeting'&&e.title!=='Занято')));
 const attr=e=>' data-id="'+esc(e.id)+'" data-day="'+d+'" '+(e.editable?'data-edit="1" ':'')+'aria-label="'+esc((e.title|| (e.kind==='presence'?'Присутствие':'Занято'))+' '+span(e.a,e.b))+'"';
 let html=present.map(e=>'<button class="mark presence" '+attr(e)+' style="'+position(e.a,e.b)+'">'+eventButton(e)+'</button>').join('');
 html+=(state.windows[d]||[]).map(([a,b])=>'<button class="mark slot" data-slot="'+a+','+b+'" style="'+position(a,b)+'">'+span(a,b)+'</button>').join('');
 const waiting=records.slice().sort((a,b)=>a.a-b.a||b.b-a.b);
 for(let i=0;i<waiting.length;){
   let end=waiting[i].b,j=i+1;
   while(j<waiting.length&&waiting[j].a<end){end=Math.max(end,waiting[j].b);j++}
   const lanes=[],cluster=waiting.slice(i,j).map(e=>{let l=lanes.findIndex(b=>b<=e.a);if(l<0)l=lanes.length;lanes[l]=e.b;return {e,l}});
   for(const {e,l} of cluster){
     const kind=['pending','reschedule'].includes(e.status)&&e.kind==='meeting'?e.status:e.kind;
     html+='<button class="mark event '+kind+'" '+attr(e)+' style="'+position(e.a,e.b)+'left:calc('+100*l/lanes.length+'% + 12px);width:calc('+100/lanes.length+'% - 15px)">'+eventButton(e)+'</button>';
   }
   i=j;
 }
 return '<div class="col '+(d===day?'active ':'')+(picked.length>1?'group':'')+'" data-col="'+d+'">'+html+'</div>';
}
function render(){
 const {members,events,days,me}=state;
 first=Math.min(540,...events.map(e=>60*Math.floor(e.a/60)));last=Math.max(1080,...events.map(e=>60*Math.ceil(e.b/60)));
 document.documentElement.style.setProperty('--hours',(last-first)/60);
 $('#scope').textContent=picked.length?picked.map(who).join(', '):'Вся лаборатория';
 $('#identity').textContent=who(me);$('#all').hidden=!picked.length;
 $('#seminar').hidden=members.find(m=>m.id===me).role==='member';
 $('#week').textContent=fmt(days[0],{day:'numeric',month:'short'})+' – '+fmt(days[6],{day:'numeric',month:'short',year:'numeric'});
 const shifts=d=>events.filter(e=>e.kind==='presence'&&e.day===d&&selectors().includes(e.owner));
 $('#dates').innerHTML='<span></span>'+days.map(d=>'<button data-date="'+d+'" class="'+(d===day?'active':'')+'">'+fmt(d,{weekday:'short'})+'<b>'+Number(d.slice(8))+'</b><small>'+new Set(shifts(d).map(e=>e.owner)).size+' в лабе</small></button>').join('');
 const ticks=[];for(let m=first;m<=last;m+=60)ticks.push('<span style="top:'+100*(m-first)/(last-first)+'%">'+clock(m)+'</span>');
 $('#grid').innerHTML='<div class="axis">'+ticks.join('')+'</div>'+days.map(gridCol).join('');
 const rows=shifts(day), owners=[...new Set(rows.sort((a,b)=>a.a-b.a).map(e=>e.owner))];
 $('#roster').innerHTML='<h3>'+fmt(day,{weekday:'long',day:'numeric',month:'long'})+'</h3>'+(owners.length?'<ul>'+owners.map(id=>'<li>'+esc(who(id))+'<small>'+rows.filter(e=>e.owner===id).map(e=>span(e.a,e.b)).join(', ')+'</small></li>').join('')+'</ul>':'<p class="sub">Пока никто не указал часы присутствия.</p>');
 $('#sync').textContent=state.unavailable.length?'Ожидаем данные Google · '+state.unavailable.map(who).join(', '):'';
}
function peopleDialog(){
 const choices=new Set(picked);
 modal('Выбрать участников','<input id="search" type="search" aria-label="Найти участника" placeholder="Имя или почта"><div class="list" id="choices"></div><button id="apply" class="primary">Показать неделю</button>');
 const draw=()=>{$('#choices').innerHTML=state.members.filter(m=>(m.name+' '+m.email).toLowerCase().includes($('#search').value.trim().toLowerCase())).map(m=>'<label class="row"><input type="checkbox" data-person="'+esc(m.id)+'" '+(choices.has(m.id)?'checked':'')+'>'+esc(m.name)+'</label>').join('')};
 draw();$('#search').oninput=draw;$('#choices').onchange=e=>e.target.checked?choices.add(e.target.dataset.person):choices.delete(e.target.dataset.person);
 $('#apply').onclick=safely(async()=>{picked=[...choices];close();await load()});
}
function button(label,action,primary=false){return '<button type="button" '+(primary?'class="primary" ':'')+'data-act="'+action+'">'+label+'</button>'}
const options=(list,value)=>list.map(([k,label])=>'<option value="'+esc(k)+'" '+(k===value?'selected':'')+'>'+esc(label)+'</option>').join('');
function editor(kind,record={},move=false){
 const existing=!!record.id,personal=['presence','busy'].includes(kind);
 const d=record.day||day,a=record.a??600,b=record.b??(kind==='meeting'?a+30:660);
 const dateTime='<label class="line">Дата<input type="date" id="ed" required value="'+d+'"></label><div class="times"><label class="line">Начало, МСК<input type="time" id="ea" required value="'+clock(a)+'"></label><label class="line">Конец, МСК<input type="time" id="eb" required value="'+clock(b%1440)+'"></label></div>';
 const titles={presence:'Буду в лаборатории',busy:'Занято',meeting:move?'Перенести встречу':'Предложить встречу',seminar:'Семинар лаборатории'};
 let fields=dateTime;
 if(personal&&!existing)fields='<label class="line">Как отметить<select id="kind">'+options([['presence',titles.presence],['busy',titles.busy]],kind)+'</select></label>'+fields;
 if(kind==='presence'&&!existing)fields+='<label class="line">Повторять ежедневно до<input type="date" id="until" value="'+d+'"></label>';
 if(!move&&kind!=='presence')fields+='<label class="line">'+(kind==='busy'?'Заметка для себя':'Тема')+'<input id="topic" maxlength="160" value="'+esc(record.title||'')+'" '+(kind!=='busy'?'required':'')+'></label>';
 if(kind==='meeting'&&!existing){
   fields+='<h3>Участники встречи</h3><div class="list">'+state.members.filter(m=>m.id!==state.me).map(m=>'<label class="row">'+esc(m.name)+' <select data-guest="'+esc(m.id)+'">'+options([['','Не приглашён'],['yes','Обязательный'],['optional','По желанию']],picked.includes(m.id)?'yes':'')+'</select></label>').join('')+'</div>';
 }
 if(kind==='seminar')fields+='<label class="line">Докладчик<select id="speaker">'+options(state.members.map(m=>[m.id,m.name]),state.me)+'</select></label>';
 modal(titles[kind],'<form id="editform">'+fields+'<div class="actions"><button class="primary">'+(kind==='meeting'&&!existing?'Предложить':'Сохранить')+'</button>'+(existing?button('Удалить','delete'):'')+'</div></form>');
 const values=()=>({day:$('#ed').value,a:minutes($('#ea').value),b:minutes($('#eb').value)||1440});
 if($('#kind'))$('#kind').onchange=e=>editor(e.target.value,{...values()});
 if($('#until'))$('#ed').onchange=()=>{if($('#until').value<$('#ed').value)$('#until').value=$('#ed').value};
 $('#editform').onsubmit=safely(async ev=>{
   ev.preventDefault();let data={...values(),kind,rev:record.rev,title:$('#topic')?.value??record.title??''};
   if($('#until'))data.through=$('#until').value;
   if($('#speaker'))data.speaker=$('#speaker').value;
   if(kind==='meeting'&&!existing){data.guests=Object.fromEntries([...document.querySelectorAll('[data-guest]')].filter(el=>el.value).map(el=>[el.dataset.guest,el.value==='yes']))}
   await save(existing?'items/'+record.id:'items',existing?'PATCH':'POST',data);
 });
 if(existing)document.querySelector('[data-act=delete]').onclick=safely(()=>save('items/'+record.id,'DELETE',{rev:record.rev}));
}
function detail(e){
 if(e.editable){editor(e.kind,e);return}
 let html='<p>'+fmt(e.day,{weekday:'short',day:'numeric',month:'long'})+' · '+span(e.a,e.b)+' МСК</p>';
 if(e.kind==='google'){
   html+='<p class="sub">Google Календарь · '+esc(who(e.owner))+'</p>'+esc((e.attendees||[]).join(', '));
   if(e.owner===state.me)html+='<label class="row"><input id="mask" type="checkbox" '+(e.hidden?'checked':'')+'> Показывать коллегам как «Занято»</label>';
 }else if(e.kind==='meeting'){
   html+='<p>'+esc(statuses[e.status])+'</p><ul>'+e.guests.map(g=>'<li>'+esc(who(g.person))+' · '+(g.required?'обязательный':'по желанию')+' · '+esc(statuses[g.reply])+'</li>').join('')+'</ul>';
   if(e.owner===state.me)html+='<div class="actions">'+button('Перенести','move')+button('Отменить встречу','delete')+'</div>';
   else if(e.guests.some(g=>g.person===state.me))html+='<div class="actions">'+button('Могу встретиться','accepted',true)+button('Не смогу','declined')+'</div>';
 }else if(e.kind==='seminar'){
   html+='<p>Докладчик · '+esc(who(e.speaker))+'</p>';
   if(e.owner===state.me){
     html+='<label class="line">Докладчик<select id="speaker">'+options(state.members.map(m=>[m.id,m.name]),e.speaker)+'</select></label>';
     const ended=Date.now()>=Date.parse(e.day+'T00:00:00+03:00')+e.b*60000;
     if(ended)html+='<h3>Кто был</h3><div class="list" id="attendance">'+e.guests.map(g=>'<label class="row"><input type="checkbox" data-att="'+esc(g.person)+'" '+(g.attended?'checked':'')+'>'+esc(who(g.person))+'</label>').join('')+'</div>';
     html+='<div class="actions">'+button('Сохранить','seminar',true)+button('Отменить семинар','delete')+'</div>';
   }
 }
 modal(e.title||'Занято',html);
 if($('#mask'))$('#mask').onchange=safely(ev=>save('google/private','POST',{key:e.id,hidden:ev.target.checked}));
 for(const btn of document.querySelectorAll('#contents [data-act]'))btn.onclick=safely(()=>{
   const act=btn.dataset.act,path='items/'+e.id;
   if(act==='move')return editor('meeting',e,true);
   if(act==='delete')return save(path,'DELETE',{rev:e.rev});
   if(act==='seminar')return save(path,'PATCH',{rev:e.rev,speaker:$('#speaker').value,...($('#attendance')?{attended:[...document.querySelectorAll('[data-att]:checked')].map(el=>el.dataset.att)}:{})});
   return save(path,'PATCH',{rev:e.rev,reply:act});
 });
}
function googlePanel(){
 const g=state.google;
 let html=!g.configured?'<p>Подключение Google ещё не настроено администратором. Расписание и приглашения доступны в OdanLab.</p>':!g.connected?'<p>Учитывать занятость основного календаря. После подтверждения встречи OdanLab добавит её в ваш Google Календарь. По умолчанию коллеги видят только «Занято».</p><div class="actions">'+button('Подключить Google Календарь','connect',true)+'</div>':'<p>Подключён основной календарь.</p><p class="sub">'+(g.pending?'Ожидают синхронизации · '+g.pending:'Подтверждённые встречи записываются в Google.')+'</p><h3>Кому открыть тему и участников</h3><div class="list">'+state.members.filter(m=>m.id!==state.me).map(m=>'<label class="row"><input data-reader="'+esc(m.id)+'" type="checkbox" '+(g.readers.includes(m.id)?'checked':'')+'>'+esc(m.name)+'</label>').join('')+'</div><div class="actions">'+button('Сохранить доступ','readers',true)+button('Отключить','disconnect')+'</div>';
 modal('Мой Google Календарь',html);
 for(const b of document.querySelectorAll('#contents [data-act]'))b.onclick=safely(async()=>{
   if(b.dataset.act==='connect'){const res=await api('google/start','POST',{});location.assign(res.url)}
   if(b.dataset.act==='disconnect')await save('google/stop','POST',{});
   if(b.dataset.act==='readers')await save('google/readers','POST',{people:[...document.querySelectorAll('[data-reader]:checked')].map(x=>x.dataset.reader)});
 });
}
const grid=$('#grid');
const bounded=(m,a,b)=>Math.max(a,Math.min(m,b));
const atMinute=(col,y)=>{const r=col.getBoundingClientRect();return bounded(first+15*Math.round((y-r.top)*(last-first)/r.height/15),first,last)};
let skipClick=false;
function clearDrag(){
 if(drag?.el.hasPointerCapture(drag.id))drag.el.releasePointerCapture(drag.id);
 drag=null;grid.querySelector('.ghost')?.remove();
}
function rangeAt(ev){
 const {col,from,y,e,edge}=drag;
 if(!e){const t=atMinute(col,ev.clientY);let a=Math.min(from,t),b=Math.max(from,t);if(a===b){a=Math.min(a,last-15);b=a+15}return {day:col.dataset.col,a,b}}
 const delta=15*Math.round((ev.clientY-y)*(last-first)/col.getBoundingClientRect().height/15);
 const min=Math.min(15,e.b-e.a);
 if(edge==='start')return {day:e.day,a:bounded(e.a+delta,first,e.b-min),b:e.b};
 if(edge==='end')return {day:e.day,a:e.a,b:bounded(e.b+delta,e.a+min,last)};
 const dest=[...grid.querySelectorAll('.col')].find(n=>{const r=n.getBoundingClientRect();return r.width&&r.left<=ev.clientX&&ev.clientX<r.right&&r.top-1<=ev.clientY&&ev.clientY<=r.bottom+1});
 if(!dest)return null;
 const a=bounded(e.a+delta,first,last-(e.b-e.a));return {day:dest.dataset.col,a,b:a+e.b-e.a};
}
grid.onpointerdown=ev=>{
 skipClick=false;if(ev.button||ev.pointerType==='touch'||!ev.isPrimary||drag)return;
 const col=ev.target.closest('.col');if(!col)return;
 const el=ev.target.closest('button')||col;
 const e=ev.shiftKey||!el.hasAttribute('data-edit')?null:state.events.find(e=>e.id===el.dataset.id);
 drag={el,col,id:ev.pointerId,x:ev.clientX,y:ev.clientY,from:atMinute(col,ev.clientY),e,edge:ev.target.dataset.edge,moved:false};
 el.setPointerCapture(ev.pointerId);
};
grid.onpointermove=ev=>{
 if(drag?.id!==ev.pointerId)return;
 if(!drag.moved&&Math.max(Math.abs(ev.clientY-drag.y),drag.e?Math.abs(ev.clientX-drag.x):0)<5)return;
 drag.moved=true;
 const v=rangeAt(ev);let ghost=grid.querySelector('.ghost');
 if(!v){ghost?.remove();return}
 const col=grid.querySelector('[data-col="'+v.day+'"]');
 if(!ghost){ghost=document.createElement('span');ghost.className='ghost'}
 if(ghost.parentNode!==col)col.append(ghost);
 ghost.style.cssText=position(v.a,v.b);ghost.textContent=span(v.a,v.b);
};
grid.onpointerup=safely(async ev=>{
 if(drag?.id!==ev.pointerId)return;
 const {e,moved}=drag,v=rangeAt(ev);clearDrag();if(!moved)return;
 skipClick=true;if(!v)return;
 if(!e){editor('presence',v);return}
 if(e.a===v.a&&e.b===v.b&&e.day===v.day)return;
 try{await api('items/'+e.id,'PATCH',{...v,rev:e.rev});day=v.day;await load();tell('Новое время · '+span(v.a,v.b))}
 catch(err){await load();throw err}
});
grid.onpointercancel=clearDrag;
grid.onlostpointercapture=ev=>{if(drag?.id===ev.pointerId)clearDrag()};
window.addEventListener('blur',()=>{if(drag)clearDrag()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){skipClick=true;clearDrag()}});
grid.onclick=ev=>{
 if(skipClick&&ev.detail){skipClick=false;return}
 const b=ev.target.closest('button');if(!b)return;
 if(b.dataset.slot){const [a]=b.dataset.slot.split(',').map(Number);editor('meeting',{day:b.closest('.col').dataset.col,a,b:a+30});return}
 const e=state.events.find(e=>e.id===b.dataset.id&&e.day===b.dataset.day);if(e)detail(e);
};
document.addEventListener('click',safely(async ev=>{
 const b=ev.target.closest('button');if(!b||dialog.open)return;
 if(b.hasAttribute('data-nav')){day=+b.dataset.nav?add(day,7*Number(b.dataset.nav)):today();await load()}
 if(b.hasAttribute('data-date')){day=b.dataset.date;render()}
 if(b.dataset.new)editor(b.dataset.new);
}));
$('#people').onclick=peopleDialog;$('#all').onclick=safely(async()=>{picked=[];await load()});$('#google').onclick=googlePanel;
safely(async()=>{
 const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');
 if(ticket){
   history.replaceState(null,'',location.pathname);
   const proof=sessionStorage.getItem('olab.proof');sessionStorage.removeItem('olab.proof');
   const result=await api('odan/exchange','POST',{ticket,proof});
   session=result.session;sessionStorage.setItem('olab.session',session);
 }
 if(session)await load();else await signinStatus();
})();
setInterval(()=>{if(session&&!dialog.open&&!drag&&!document.hidden)safely(load)()},45000);
