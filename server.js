require("dotenv").config();
const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const webpush = require("web-push");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "change-this-admin-key";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "incidents.json");
const SUB_FILE = path.join(DATA_DIR, "push-subscriptions.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(SUB_FILE)) fs.writeFileSync(SUB_FILE, "[]");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
let incidents = readJson(DATA_FILE, []);
let subscriptions = readJson(SUB_FILE, []);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function adminOk(req) {
  return (req.get("x-admin-key") || "") === ADMIN_KEY;
}
function safeIncident(x) {
  return x;
}
function newId() {
  return "RX-" + Math.random().toString(36).slice(2, 7).toUpperCase() + "-" + String(Date.now()).slice(-4);
}
function clean(v, max=2000) {
  return String(v ?? "").trim().slice(0, max);
}
function severityOf(a) {
  const txt=[a.summary,a.affected,a.impact,a.urgency].join(" ").toLowerCase();
  if (/death|injur|fire|security breach|data loss|complete outage|everyone|all users|critical|emergency|danger/.test(txt)) return "Critical";
  if (/high|blocked|unavailable|crash|down|cannot|can't|not working|major/.test(txt)) return "High";
  if (/few|medium|slow|intermittent|sometimes/.test(txt)) return "Medium";
  return "Low";
}

app.get("/api/health", (req,res)=>res.json({ok:true,service:"resolve-x",time:new Date().toISOString()}));

app.get("/api/incidents", (req,res)=>{
  res.json(incidents.slice().sort((a,b)=>new Date(b.created)-new Date(a.created)));
});

app.post("/api/incidents", (req,res)=>{
  const a=req.body||{};
  const incident={
    id:newId(),
    application:clean(a.application,160)||"Unknown service",
    summary:clean(a.summary,2500)||"No description provided",
    started:clean(a.started,300),
    affected:clean(a.affected,500),
    impact:clean(a.impact,1000),
    urgency:clean(a.urgency,300),
    location:clean(a.location,300),
    contact:clean(a.contact,300),
    environment:clean(a.environment,300),
    severity:["Low","Medium","High","Critical"].includes(a.severity)?a.severity:severityOf(a),
    status:"Open",
    created:new Date().toISOString(),
    reporterDevice:clean(a.deviceId,100)
  };
  incidents.push(incident);
  writeJson(DATA_FILE,incidents);
  io.to("admins").emit("incident:new",safeIncident(incident));
  sendPush(incident).catch(console.error);
  res.status(201).json(incident);
});

app.patch("/api/incidents/:id",(req,res)=>{
  if(!adminOk(req)) return res.status(403).json({error:"Admin access required for updates."});
  const x=incidents.find(i=>i.id===req.params.id);
  if(!x) return res.status(404).json({error:"Incident not found"});
  if(req.body.status && ["Open","In progress","Resolved"].includes(req.body.status)) x.status=req.body.status;
  writeJson(DATA_FILE,incidents);
  io.emit("incident:update",x);
  res.json(x);
});

app.get("/api/incidents/:id/messages",(req,res)=>{
  const x=incidents.find(i=>i.id===req.params.id);
  if(!x) return res.status(404).json({error:"Incident not found"});
  res.json(x.messages||[]);
});

async function saveMessage(id, msg) {
  const x=incidents.find(i=>i.id===id);
  if(!x) return null;
  x.messages=x.messages||[];
  x.messages.push(msg);
  if(x.messages.length>500) x.messages=x.messages.slice(-500);
  writeJson(DATA_FILE,incidents);
  return msg;
}

app.post("/api/push/subscribe",(req,res)=>{
  if(!adminOk(req)) return res.status(403).json({error:"Admin access required."});
  const sub=req.body;
  if(!sub || !sub.endpoint) return res.status(400).json({error:"Invalid subscription"});
  subscriptions=subscriptions.filter(x=>x.endpoint!==sub.endpoint);
  subscriptions.push(sub);
  writeJson(SUB_FILE,subscriptions);
  res.json({ok:true});
});

app.get("/api/push/public-key",(req,res)=>{
  res.json({publicKey:process.env.VAPID_PUBLIC_KEY||null});
});

async function sendPush(incident) {
  if(!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT || !subscriptions.length) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const payload=JSON.stringify({
    title:"🚨 New Resolve-X incident",
    body:`${incident.id} · ${incident.severity} · ${incident.application}`,
    incidentId:incident.id
  });
  const keep=[];
  for(const sub of subscriptions){
    try { await webpush.sendNotification(sub,payload); keep.push(sub); }
    catch(e) { if(e.statusCode!==404 && e.statusCode!==410) keep.push(sub); }
  }
  subscriptions=keep; writeJson(SUB_FILE,subscriptions);
}

io.on("connection",socket=>{
  const {deviceId,adminKey}=socket.handshake.auth||{};
  if(adminKey===ADMIN_KEY) socket.join("admins");

  socket.on("join-incident",id=>{
    const exists=incidents.some(i=>i.id===id);
    if(exists) socket.join(`incident:${id}`);
  });

  socket.on("incident-message",async ({incidentId,text,deviceId:senderDevice})=>{
    const cleanText=clean(text,2000);
    if(!incidentId || !cleanText) return;
    const exists=incidents.find(i=>i.id===incidentId);
    if(!exists) return;
    const msg={id:newId(),incidentId,text:cleanText,deviceId:clean(senderDevice,100),sender:"Participant",created:new Date().toISOString()};
    await saveMessage(incidentId,msg);
    io.to(`incident:${incidentId}`).emit("incident-message",msg);
  });
});

app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

server.listen(PORT,()=>console.log(`Resolve-X running on http://localhost:${PORT}`));
