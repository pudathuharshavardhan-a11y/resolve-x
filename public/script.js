/* Resolve-X real-time client */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const sevOrder=["Low","Medium","High","Critical"];
let incidents=[], answers={}, step=0, selectedIncident=null, socket=null;
const DEVICE_KEY="resolvex_device_id";
const ADMIN_KEY_STORAGE="resolvex_admin_key";
const deviceId=localStorage.getItem(DEVICE_KEY)||crypto.randomUUID();
localStorage.setItem(DEVICE_KEY,deviceId);

function escapeHTML(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showToast(t){const el=$("#toast");if(!el)return;el.textContent=t;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function dateLabel(d){return new Date(d).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
function badge(s,type){return `<span class="${type}-badge ${escapeHTML(s)}">${escapeHTML(s)}</span>`}

function navigate(view){
  $$(".page").forEach(p=>p.classList.toggle("active",p.id===`view-${view}`));
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const labels={overview:"Overview",assistant:"Incident reporter",livechat:"Live chat",incidents:"Incidents",analytics:"Analytics",reports:"Reports",playbook:"Resolution playbook"};
  $("#crumb").textContent=labels[view]||"Overview";
  $("#sidebar").classList.remove("open");
  if(view==="overview"||view==="incidents"||view==="analytics"||view==="livechat") renderAll();
  if(view==="assistant"&&!$("#chatMessages").children.length) startChat();
  if(view==="livechat") renderRooms();
}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
$("#menuBtn")?.addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
$("#themeBtn")?.addEventListener("click",()=>{document.body.classList.toggle("light");localStorage.setItem("resolvex_theme",document.body.classList.contains("light")?"light":"dark")});
if(localStorage.getItem("resolvex_theme")==="light")document.body.classList.add("light");

function setConnection(online){
  const s=$("#systemStatus");
  if(!s)return;
  s.innerHTML=`<i style="background:${online?"var(--green)":"var(--red)"}"></i> ${online?"Connected":"Offline"}`;
}

async function api(path,options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(adminKey) headers["x-admin-key"]=adminKey;
  const r=await fetch(path,{headers,...options});
  if(!r.ok) throw new Error(await r.text()||`Request failed (${r.status})`);
  return r.status===204?null:r.json();
}
async function loadIncidents(){
  try { incidents=await api("/api/incidents"); renderAll(); }
  catch(e){ console.error(e); showToast("Could not load live incidents"); }
}

function renderActivity(){
  const chart=$("#activityChart"); if(!chart)return; chart.innerHTML="";
  const months=[];const now=new Date();
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:`${d.getFullYear()}-${d.getMonth()}`,label:d.toLocaleDateString(undefined,{month:"short"})})}
  const vals=months.map(m=>incidents.filter(x=>{const d=new Date(x.created);return `${d.getFullYear()}-${d.getMonth()}`===m.key}).length);
  const max=Math.max(4,...vals);
  months.forEach((m,i)=>{const g=document.createElement("div");g.className="bar-group";g.innerHTML=`<div class="bar" style="height:${Math.max(2,vals[i]/max*100)}%" title="${vals[i]} incidents"></div><span class="bar-label">${m.label}</span>`;chart.appendChild(g)});
}
function renderDonut(){
  const ids=["criticalCount","highCount","mediumCount","lowCount"];
  const counts=Object.fromEntries(sevOrder.map(s=>[s,incidents.filter(x=>x.severity===s).length]));
  $("#donutTotal").textContent=incidents.length;
  ids.forEach((id,i)=>$("#"+id).textContent=counts[sevOrder[3-i]]);
  const colors={Critical:"#ff7185",High:"#f5a75b",Medium:"#8d7bfa",Low:"#49cfa0"};
  let angle=0;const parts=sevOrder.filter(s=>counts[s]).map(s=>{const start=angle;angle+=counts[s]/Math.max(incidents.length,1)*360;return `${colors[s]} ${start}deg ${angle}deg`});
  $("#severityDonut").style.background=parts.length?`conic-gradient(${parts.join(",")})`:"conic-gradient(#343b50 0 100%)";
}
function renderRecent(){
  const rows=incidents.slice().sort((a,b)=>new Date(b.created)-new Date(a.created)).slice(0,5);
  $("#recentRows").innerHTML=rows.length?rows.map(x=>`<tr><td><span class="incident-id">${escapeHTML(x.id)}</span><br><span style="color:var(--muted)">${escapeHTML((x.summary||"").slice(0,42))}${(x.summary||"").length>42?"…":""}</span></td><td>${escapeHTML(x.application||"Unknown")}</td><td>${badge(x.severity,"severity")}</td><td>${badge(x.status,"status")}</td><td>${dateLabel(x.created)}</td><td><button class="text-btn" data-status="${escapeHTML(x.id)}">Update</button></td></tr>`).join(""):`<tr><td colspan="5" class="empty-cell">No incidents yet. Create the first report from Incident reporter.</td></tr>`;
}
function renderList(){
  const q=($("#incidentSearch")?.value||"").toLowerCase(),sev=$("#severityFilter")?.value||"all",st=$("#statusFilter")?.value||"all";
  const items=incidents.filter(x=>(sev==="all"||x.severity===sev)&&(st==="all"||x.status===st)&&[x.id,x.application,x.summary].join(" ").toLowerCase().includes(q)).sort((a,b)=>new Date(b.created)-new Date(a.created));
  $("#incidentRows").innerHTML=items.length?items.map(x=>`<tr><td><span class="incident-id">${escapeHTML(x.id)}</span><br><span style="color:var(--muted)">${escapeHTML((x.summary||"").slice(0,38))}${(x.summary||"").length>38?"…":""}</span></td><td>${escapeHTML(x.application||"")}</td><td>${badge(x.severity,"severity")}</td><td>${badge(x.status,"status")}</td><td>${dateLabel(x.created)}</td><td><div class="action-group"><button class="chat-open-btn" data-chat="${escapeHTML(x.id)}">Chat</button><select class="action-select" data-update="${escapeHTML(x.id)}"><option ${x.status==="Open"?"selected":""}>Open</option><option ${x.status==="In progress"?"selected":""}>In progress</option><option ${x.status==="Resolved"?"selected":""}>Resolved</option></select></div></td></tr>`).join(""):`<tr><td colspan="6" class="empty-cell">No incidents found.</td></tr>`;
}
function renderAnalytics(){
  const total=incidents.length,done=incidents.filter(x=>x.status==="Resolved").length;
  $("#meanSeverity").textContent=total?(incidents.reduce((s,x)=>s+sevOrder.indexOf(x.severity)+1,0)/total).toFixed(1):"—";
  $("#resolutionRate").textContent=total?Math.round(done/total*100)+"%":"0%";
  const sevCounts=Object.fromEntries(sevOrder.map(s=>[s,incidents.filter(x=>x.severity===s).length]));
  $("#analyticsBars").innerHTML=total?sevOrder.slice().reverse().map(s=>`<div class="hbar-row"><span>${s}</span><div class="hbar-track"><div class="hbar-fill" style="width:${sevCounts[s]/total*100}%;--bar:var(--${s.toLowerCase()})"></div></div><b>${sevCounts[s]}</b></div>`).join(""):`<div class="empty-chart">No data to display yet.</div>`;
  const states=["Open","In progress","Resolved"];
  $("#statusBars").innerHTML=total?states.map(s=>{const n=incidents.filter(x=>x.status===s).length;return `<div class="hbar-row"><span>${s}</span><div class="hbar-track"><div class="hbar-fill" style="width:${n/total*100}%"></div></div><b>${n}</b></div>`}).join(""):`<div class="empty-chart">No data to display yet.</div>`;
}
function renderAll(){
  $("#totalStat").textContent=incidents.length;
  $("#openStat").textContent=incidents.filter(x=>x.status!=="Resolved").length;
  $("#highStat").textContent=incidents.filter(x=>["Critical","High"].includes(x.severity)).length;
  $("#resolvedStat").textContent=incidents.filter(x=>x.status==="Resolved").length;
  $("#navCount").textContent=incidents.length;
  renderActivity();renderDonut();renderRecent();renderList();renderAnalytics();renderRooms();
}

function addChat(text,who="bot"){
  const row=document.createElement("div");row.className=`chat-msg ${who}`;
  const av=document.createElement("div");av.className="chat-mini-avatar";av.textContent=who==="bot"?"✦":"H";
  const bubble=document.createElement("div");bubble.className="chat-bubble";bubble.textContent=text;
  row.append(av,bubble);$("#chatMessages").append(row);$("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
}
const questions=[
 {key:"application",label:"What is the name of the software, service, road, or place where the problem is happening?",hint:"Affected service"},
 {key:"summary",label:"Tell me what happened. What problem should we report?",hint:"Problem description"},
 {key:"started",label:"When did the problem start?",hint:"Start time"},
 {key:"affected",label:"How many people are affected: one person, a few people, or many/everyone?",hint:"People affected"},
 {key:"impact",label:"What is the impact? Is work slowed, blocked, or is there danger or major disruption?",hint:"Impact"},
 {key:"urgency",label:"How urgent is it: low, medium, or high?",hint:"Urgency"},
 {key:"location",label:"Where is the problem happening? You can type a city, area, landmark, or 'not known'.",hint:"Location"},
 {key:"contact",label:"How can the response team communicate with you? A safe contact method is enough.",hint:"Contact method"}
];
function startChat(){
  step=0;answers={};$("#chatMessages").innerHTML="";$("#chatInput").disabled=false;$("#chatForm").querySelector("button").disabled=false;
  addChat("Hi. This is the Resolve-X incident reporter. You do not need to create an account. I will collect the important details and send the incident to the response system.");
  addChat(questions[0].label);renderContext();
}
function renderContext(){
  const answered=questions.slice(0,step);
  $("#contextFields").innerHTML=answered.length?answered.map(q=>`<div class="context-field"><small>${escapeHTML(q.hint)}</small><b>${escapeHTML(answers[q.key]||"")}</b></div>`).join(""):`<div class="context-empty">Your answers will appear here as you work through the report.</div>`;
  const pct=Math.round(step/questions.length*100);$("#progressText").textContent=pct+"%";$("#progressBar").style.width=pct+"%";$("#progressHint").textContent=step>=questions.length?"Report sent to the response system.":`${questions.length-step} question${questions.length-step===1?"":"s"} remaining.`;
}
function severity(a){
  const txt=[a.summary,a.affected,a.impact,a.urgency].join(" ").toLowerCase();
  if(/death|injur|fire|security breach|data loss|complete outage|everyone|all users|critical|emergency|danger/.test(txt))return "Critical";
  if(/high|blocked|unavailable|crash|down|cannot|can't|not working|major/.test(txt))return "High";
  if(/few|medium|slow|intermittent|sometimes/.test(txt))return "Medium";
  return "Low";
}
async function makeReport(){
  const sev=severity(answers);
  const localId="LOCAL-"+Date.now().toString(36).toUpperCase();
  try{
    const x=await api("/api/incidents",{method:"POST",body:JSON.stringify({...answers,severity:sev,deviceId})});
    addChat(`Incident ${x.id} has been sent successfully. Severity: ${sev}. Your report is now visible to the response team.`);
    showToast(`Incident ${x.id} sent`);
    selectedIncident=x.id;
    renderAll();
    setTimeout(()=>openChat(x.id),500);
  }catch(e){
    addChat("I could not send the incident to the shared server. Please check your internet connection and try again.");
    showToast("Incident could not be sent");
    console.error(e);
  }
  $("#chatInput").disabled=true;$("#chatForm").querySelector("button").disabled=true;
}
$("#chatForm").addEventListener("submit",e=>{e.preventDefault();const input=$("#chatInput"),val=input.value.trim();if(!val||step>=questions.length)return;addChat(val,"user");answers[questions[step].key]=val;step++;input.value="";renderContext();if(step<questions.length)addChat(questions[step].label);else makeReport();});
$("#resetChat").addEventListener("click",startChat);

function renderRooms(){
  const open=incidents.filter(x=>x.status!=="Resolved").sort((a,b)=>new Date(b.created)-new Date(a.created));
  $("#roomCount").textContent=open.length;
  $("#roomList").innerHTML=open.length?open.map(x=>`<button class="room-item ${x.id===selectedIncident?"selected":""}" data-room="${escapeHTML(x.id)}"><span class="room-dot ${x.severity.toLowerCase()}"></span><span><b>${escapeHTML(x.id)}</b><small>${escapeHTML(x.application||"Incident")} · ${escapeHTML(x.status)}</small></span></button>`).join(""):`<div class="context-empty">No open incidents.</div>`;
}
async function openChat(id){
  selectedIncident=id; renderRooms();
  const x=incidents.find(i=>i.id===id);
  $("#roomTitle").textContent=x?x.id:"Incident chat";
  $("#roomSub").textContent=x?`${x.application||"Incident"} · ${x.severity} · ${x.status}`:"Choose an incident";
  $("#roomInput").disabled=!x;$("#roomForm button").disabled=!x;
  $("#roomMessages").innerHTML=`<div class="context-empty">Loading messages…</div>`;
  try{
    const msgs=await api(`/api/incidents/${encodeURIComponent(id)}/messages`);
    renderRoomMessages(msgs);
    socket?.emit("join-incident",id);
  }catch(e){$("#roomMessages").innerHTML=`<div class="context-empty">Could not load messages.</div>`}
}
function renderRoomMessages(msgs){
  $("#roomMessages").innerHTML=msgs.length?msgs.map(m=>`<div class="room-msg ${m.deviceId===deviceId?"mine":""}"><div><span>${m.deviceId===deviceId?"You":(m.sender||"Reporter")}</span><p>${escapeHTML(m.text)}</p><small>${dateLabel(m.created)}</small></div></div>`).join(""):`<div class="context-empty">No messages yet. Send the first message.</div>`;
  $("#roomMessages").scrollTop=$("#roomMessages").scrollHeight;
}
$("#roomList").addEventListener("click",e=>{const b=e.target.closest("[data-room]");if(b)openChat(b.dataset.room)});
$("#roomForm").addEventListener("submit",e=>{
  e.preventDefault();const input=$("#roomInput"),text=input.value.trim();
  if(!text||!selectedIncident||!socket)return;
  socket.emit("incident-message",{incidentId:selectedIncident,text,deviceId});
  input.value="";
});

async function updateStatus(id,status){
  try{const x=await api(`/api/incidents/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status})});incidents=incidents.map(i=>i.id===id?x:i);renderAll();showToast(`${id} is now ${status}`)}
  catch(e){showToast("Could not update incident")}
}
$("#incidentSearch").addEventListener("input",renderList);
$("#severityFilter").addEventListener("change",renderList);
$("#statusFilter").addEventListener("change",renderList);
$("#incidentRows").addEventListener("change",e=>{const id=e.target.dataset.update;if(id)updateStatus(id,e.target.value)});
$("#incidentRows").addEventListener("click",e=>{const id=e.target.dataset.chat;if(id){navigate("livechat");openChat(id)}});
$("#recentRows").addEventListener("click",e=>{
  const id=e.target.dataset.status;if(!id)return;
  const x=incidents.find(x=>x.id===id);if(!x)return;
  const next=x.status==="Open"?"In progress":x.status==="In progress"?"Resolved":"Open";updateStatus(id,next);
});

function csv(){
 const cols=["id","application","summary","started","affected","impact","urgency","location","contact","severity","status","created"];
 const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;
 return [cols.join(","),...incidents.map(x=>cols.map(c=>q(x[c])).join(","))].join("\r\n");
}
function download(name,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast("Your export is ready")}
function exportCsv(){download("resolve-x-incidents.csv",csv(),"text/csv;charset=utf-8")}
$("#exportCsv").addEventListener("click",exportCsv);$("#analyticsExport").addEventListener("click",exportCsv);
$("#exportJson").addEventListener("click",()=>download("resolve-x-backup.json",JSON.stringify(incidents,null,2),"application/json"));

function getAdminKey(){
  const params=new URLSearchParams(location.search);
  const fromUrl=params.get("admin");
  if(fromUrl){localStorage.setItem(ADMIN_KEY_STORAGE,fromUrl);history.replaceState({},document.title,location.pathname+location.hash)}
  return localStorage.getItem(ADMIN_KEY_STORAGE)||"";
}
const adminKey=getAdminKey();
function isAdmin(){return !!adminKey}
async function enableNotifications(){
  if(!("Notification" in window)){showToast("Browser notifications are not supported");return}
  const permission=await Notification.requestPermission();
  if(permission!=="granted"){showToast("Notification permission was not granted");return}
  if(isAdmin()){$("#adminBanner").hidden=false;showToast("Admin alerts enabled");setupPush()}
}
$("#notifyBtn")?.addEventListener("click",enableNotifications);
$("#enableNotifyInline")?.addEventListener("click",enableNotifications);
if(isAdmin()){$("#adminBanner").hidden=false}


async function setupPush(){
  if(!isAdmin() || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try{
    const permission=Notification.permission==="granted" ? "granted" : await Notification.requestPermission();
    if(permission!=="granted") return;
    const reg=await navigator.serviceWorker.register("/sw.js");
    const keyRes=await api("/api/push/public-key");
    if(!keyRes.publicKey) return;
    const existing=await reg.pushManager.getSubscription();
    const sub=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(keyRes.publicKey)});
    await api("/api/push/subscribe",{method:"POST",body:JSON.stringify(sub)});
    $("#adminBanner").hidden=false;
  }catch(e){console.warn("Push notifications unavailable",e)}
}
function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

function connect(){
  socket=io({auth:{deviceId,adminKey}});
  socket.on("connect",()=>{setConnection(true);loadIncidents();if(isAdmin())$("#adminBanner").hidden=false});
  socket.on("disconnect",()=>setConnection(false));
  socket.on("incident:new",incident=>{
    incidents=[incident,...incidents.filter(x=>x.id!==incident.id)];
    renderAll();
    if(isAdmin()){
      if("Notification" in window && Notification.permission==="granted"){
        new Notification("🚨 New Resolve-X incident",{body:`${incident.id} · ${incident.severity} · ${incident.application||"Incident"}`,tag:incident.id});
      }
      showToast(`🚨 New incident: ${incident.id}`);
    }
  });
  socket.on("incident:update",incident=>{
    incidents=incidents.map(x=>x.id===incident.id?incident:x);
    renderAll();
    if(selectedIncident===incident.id)openChat(incident.id);
  });
  socket.on("incident-message",msg=>{
    if(msg.incidentId===selectedIncident){
      const el=$("#roomMessages");
      const empty=el.querySelector(".context-empty"); if(empty)empty.remove();
      const row=document.createElement("div");row.className=`room-msg ${msg.deviceId===deviceId?"mine":""}`;
      row.innerHTML=`<div><span>${msg.deviceId===deviceId?"You":(msg.sender||"Reporter")}</span><p>${escapeHTML(msg.text)}</p><small>${dateLabel(msg.created)}</small></div>`;
      el.appendChild(row);el.scrollTop=el.scrollHeight;
    }
  });
}
connect();
loadIncidents();
if(isAdmin() && "Notification" in window && Notification.permission==="granted") setupPush();
if(!$("#chatMessages").children.length)startChat();
