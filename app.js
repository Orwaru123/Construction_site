const $=id=>document.getElementById(id);
function show(id){
 document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
 $(id).classList.remove("hidden");
 if(id==="dashboard"){ $("date").value=new Date().toLocaleDateString("en-CA"); loadDashboard(); }
}
async function attendance(action){
 const worker_id=$("wid").value.trim(), pin=$("wpin").value.trim();
 if(!worker_id||!pin){return msg("workerMsg","Enter Worker ID and PIN.","error")}
 const r=await fetch("/api/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({worker_id,pin})});
 const d=await r.json();
 if(!r.ok)return msg("workerMsg",d.error,"error");
 msg("workerMsg",`<b>Welcome, ${d.worker.name}</b><br>Worker ID: ${d.worker.worker_id}<br>Time: ${action==="checkin"?d.attendance.check_in:d.attendance.check_out}<br>Status: ${action==="checkin"?"ON SITE":"OFF SITE"}`,"success");
}
function msg(id,text,type){$(id).innerHTML=`<div class="msg">${text}</div>`}
async function registerWorker(){
 const body={name:$("rname").value,phone:$("rphone").value,role:$("rrole").value,pin:$("rpin").value};
 const r=await fetch("/api/workers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const d=await r.json();
 if(!r.ok)return msg("registerMsg",d.error,"error");
 msg("registerMsg",`Worker registered successfully.<br><b>Worker ID: ${d.worker_id}</b><br>Give this ID and the PIN to the worker.`,"success");
 ["rname","rphone","rrole","rpin"].forEach(x=>$(x).value="");
}
async function loadDashboard(){
 const date=$("date").value;
 const [a,s]=await Promise.all([fetch("/api/attendance?date="+date).then(r=>r.json()),fetch("/api/stats").then(r=>r.json())]);
 $("total").textContent=s.total;$("records").textContent=s.records;$("onsite").textContent=s.onsite;$("absent").textContent=s.absent;
 $("attendanceTable").innerHTML=a.map(x=>`<tr><td>${x.worker_id}</td><td>${x.name}</td><td>${x.phone}</td><td>${x.role}</td><td>${x.check_in}</td><td>${x.check_out||"—"}</td><td class="${x.check_out?"off":"on"}">${x.status}</td></tr>`).join("")||`<tr><td colspan="7">No attendance records for this date.</td></tr>`;
 window.currentRows=a;
}
function downloadCSV(){
 const rows=window.currentRows||[];
 let csv="Worker ID,Name,Phone,Role,Date,Check In,Check Out,Status\n";
 rows.forEach(x=>csv+=`"${x.worker_id}","${x.name}","${x.phone}","${x.role}","${x.work_date}","${x.check_in}","${x.check_out||""}","${x.status}"\n`);
 const blob=new Blob([csv],{type:"text/csv"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="attendance.csv";a.click();URL.revokeObjectURL(url);
}
show("worker");
