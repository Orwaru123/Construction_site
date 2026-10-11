const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'attendance-data.json');
const WORKERS_FILE = path.join(__dirname, 'workers.json');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({workers:[], attendance:[]}, null, 2));
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(d.workers)) d.workers = [];
    if (!Array.isArray(d.attendance)) d.attendance = [];
    d.workers.forEach(w => { if (!w.site) w.site = 'Unassigned'; });
    d.attendance.forEach(a => { if (!a.site) a.site = 'Unassigned'; });
    return d;
  } catch (e) { return {workers:[], attendance:[]}; }
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
function clean(v) { return String(v ?? '').trim(); }
function today() { return new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Nairobi'}).format(new Date()); }
function currentTime() { return new Intl.DateTimeFormat('en-GB', {timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()); }
function publicWorker(w) { return {worker_id:w.worker_id,first_name:w.first_name,last_name:w.last_name,name:w.name,phone:w.phone,role:w.role,site:w.site || 'Unassigned',active:w.active}; }
// Import old workers.json without deleting existing records.
if (fs.existsSync(WORKERS_FILE)) {
  try {
    const old = JSON.parse(fs.readFileSync(WORKERS_FILE, 'utf8'));
    if (Array.isArray(old)) {
      const d = loadData();
      old.forEach(w => {
        const id = clean(w.worker_id || w.workerId || w.id);
        if (id && !d.workers.some(x => String(x.worker_id) === id)) {
          const first = clean(w.first_name || w.firstName);
          const last = clean(w.last_name || w.lastName);
          d.workers.push({worker_id:id,first_name:first,last_name:last,name:clean(w.name)||`${first} ${last}`.trim(),phone:clean(w.phone),role:clean(w.role)||'Worker',pin:clean(w.pin),site:clean(w.site)||'Unassigned',active:1});
        }
      }); saveData(d);
    }
  } catch (e) { console.log('Legacy workers import skipped:', e.message); }
}
app.get('/api/health', (req,res)=>res.json({status:'OK',server:'Construction Site Attendance',date:today(),time:currentTime()}));
app.get('/api/sites', (req,res)=>{
  const d=loadData(); const sites=[...new Set(d.workers.filter(w=>w.active!==0).map(w=>clean(w.site)||'Unassigned'))].sort((a,b)=>a.localeCompare(b));
  res.json(sites);
});
app.post('/api/register', (req,res)=>{
  const first=clean(req.body.first_name), last=clean(req.body.last_name), id=clean(req.body.worker_id), phone=clean(req.body.phone), pin=clean(req.body.pin), role=clean(req.body.role)||'Worker', site=clean(req.body.site);
  if(!first) return res.status(400).json({message:'Please enter first name.'});
  if(!last) return res.status(400).json({message:'Please enter last name.'});
  if(!/^\d{8}$/.test(id)) return res.status(400).json({message:'Worker ID must contain exactly 8 numbers.'});
  if(!/^(01|07)\d{8}$/.test(phone)) return res.status(400).json({message:'Phone number must be 10 digits and start with 01 or 07.'});
  if(!/^\d{4,6}$/.test(pin)) return res.status(400).json({message:'PIN must contain 4 to 6 numbers.'});
  if(!site) return res.status(400).json({message:'Please select or enter the construction site.'});
  const d=loadData(); if(d.workers.some(w=>String(w.worker_id)===id)) return res.status(409).json({message:'This Worker ID is already registered.'});
  const w={worker_id:id,first_name:first,last_name:last,name:`${first} ${last}`,phone,role,pin,site,active:1}; d.workers.push(w); saveData(d);
  res.status(201).json({message:'Worker registered successfully.',worker:publicWorker(w)});
});
app.get('/api/workers',(req,res)=>{const d=loadData();res.json(d.workers.filter(w=>w.active!==0).map(publicWorker));});
function findWorker(id,pin){const d=loadData();return {d,w:d.workers.find(w=>String(w.worker_id)===String(id)&&String(w.pin)===String(pin)&&w.active!==0)};}
app.post('/api/checkin',(req,res)=>{
  const id=clean(req.body.worker_id),pin=clean(req.body.pin); if(!id||!pin)return res.status(400).json({message:'Worker ID and PIN are required.'});
  const {d,w}=findWorker(id,pin); if(!w)return res.status(401).json({message:'Invalid Worker ID or PIN.'});
  const date=today(); const old=d.attendance.find(a=>String(a.worker_id)===id&&a.work_date===date);
  if(old)return res.status(409).json({message:'You have already checked in today.',attendance:old});
  const a={id:Date.now(),worker_id:w.worker_id,first_name:w.first_name,last_name:w.last_name,name:w.name,phone:w.phone,role:w.role,site:w.site||'Unassigned',work_date:date,check_in:currentTime(),check_out:null,status:'ON SITE'};
  d.attendance.push(a);saveData(d);res.json({message:'Check-in successful.',attendance:a});
});
app.post('/api/checkout',(req,res)=>{
  const id=clean(req.body.worker_id),pin=clean(req.body.pin);if(!id||!pin)return res.status(400).json({message:'Worker ID and PIN are required.'});
  const {d,w}=findWorker(id,pin);if(!w)return res.status(401).json({message:'Invalid Worker ID or PIN.'});
  const a=d.attendance.find(x=>String(x.worker_id)===id&&x.work_date===today());
  if(!a)return res.status(400).json({message:'You cannot check out because you have not checked in today.'});
  if(a.check_out)return res.status(409).json({message:'You have already checked out today.',attendance:a});
  a.check_out=currentTime();a.status='CHECKED OUT';saveData(d);res.json({message:'Check-out successful.',attendance:a});
});
app.get('/api/my-attendance',(req,res)=>{const id=clean(req.query.worker_id);if(!id)return res.status(400).json({message:'Worker ID is required.'});const d=loadData();res.json(d.attendance.find(a=>String(a.worker_id)===id&&a.work_date===today())||null);});
app.get('/api/attendance',(req,res)=>{
  const date=clean(req.query.date)||today(), site=clean(req.query.site);const d=loadData();
  const rows=d.attendance.filter(a=>a.work_date===date&&(!site||site==='All Sites'||(a.site||'Unassigned')===site)).map(a=>({...a,status:a.check_out?'CHECKED OUT':'ON SITE'}));res.json(rows);
});
app.get('/api/stats',(req,res)=>{const date=clean(req.query.date)||today(),site=clean(req.query.site);const d=loadData();const workers=d.workers.filter(w=>w.active!==0&&(!site||site==='All Sites'||(w.site||'Unassigned')===site));const rows=d.attendance.filter(a=>a.work_date===date&&(!site||site==='All Sites'||(a.site||'Unassigned')===site));res.json({total:workers.length,records:rows.length,onsite:rows.filter(a=>!a.check_out).length,checkedOut:rows.filter(a=>!!a.check_out).length,absent:Math.max(workers.length-rows.length,0)});});
app.get('/api/attendance/history',(req,res)=>{const date=clean(req.query.date);if(!date)return res.status(400).json({message:'Date is required.'});const site=clean(req.query.site);const d=loadData();res.json(d.attendance.filter(a=>a.work_date===date&&(!site||site==='All Sites'||(a.site||'Unassigned')===site)));});
app.listen(PORT,'0.0.0.0',()=>console.log(`\nConstruction Site Attendance running at http://localhost:${PORT}\n`));
