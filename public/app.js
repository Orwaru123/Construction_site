// public/app.js

const $ = (id) => document.getElementById(id);

const loginSection = $("loginSection");
const appSection = $("appSection");
const messageBox = $("message");
const workerForm = $("workerForm");
const attendanceForm = $("attendanceForm");
const workersList = $("workersList");
const attendanceList = $("attendanceList");
const siteFilter = $("siteFilter");
const dateFilter = $("dateFilter");

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function showMessage(message, isError = false) {
  messageBox.textContent = message;
  messageBox.className = isError ? "message error" : "message success";
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.hidden = true;
  messageBox.textContent = "";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function displayTime(value) {
  if (!value) return "—";

  return new Date(value).toLocaleTimeString("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

async function checkLogin() {
  try {
    await api("/api/me");
    loginSection.hidden = true;
    appSection.hidden = false;

    if (!dateFilter.value) dateFilter.value = today();

    await loadWorkers();
    await loadAttendance();
  } catch {
    loginSection.hidden = false;
    appSection.hidden = true;
  }
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("username").value.trim(),
        password: $("password").value
      })
    });

    $("password").value = "";
    loginSection.hidden = true;
    appSection.hidden = false;
    dateFilter.value = today();

    await loadWorkers();
    await loadAttendance();
    showMessage("Admin login successful.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

$("logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    appSection.hidden = true;
    loginSection.hidden = false;
    clearMessage();
  }
});

workerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const worker = {
    name: $("workerName").value.trim(),
    workerId: $("workerId").value.trim(),
    phone: $("workerPhone").value.trim(),
    pin: $("workerPin").value,
    role: $("workerRole").value.trim(),
    site: $("workerSite").value.trim()
  };

  try {
    await api("/api/workers", {
      method: "POST",
      body: JSON.stringify(worker)
    });

    workerForm.reset();
    showMessage("Worker registered successfully.");
    await loadWorkers();
  } catch (error) {
    showMessage(error.message, true);
  }
});

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const action = $("attendanceAction").value;

  try {
    const result = await api(`/api/attendance/${action}`, {
      method: "POST",
      body: JSON.stringify({
        workerId: $("attendanceWorkerId").value.trim(),
        pin: $("attendancePin").value
      })
    });

    $("attendancePin").value = "";
    showMessage(result.message);
    await loadAttendance();
  } catch (error) {
    showMessage(error.message, true);
  }
});

async function loadWorkers() {
  const data = await api("/api/workers");

  workersList.innerHTML = data.workers.length
    ? data.workers.map((worker) => `
        <tr>
          <td>${escapeHTML(worker.name)}</td>
          <td>${escapeHTML(worker.workerId)}</td>
          <td>${escapeHTML(worker.phone)}</td>
          <td>${escapeHTML(worker.role)}</td>
          <td>${escapeHTML(worker.site)}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="5">No workers registered yet.</td></tr>';
}

async function loadAttendance() {
  const params = new URLSearchParams();

  if (dateFilter.value) params.set("date", dateFilter.value);
  if (siteFilter.value.trim()) params.set("site", siteFilter.value.trim());

  try {
    const data = await api(`/api/attendance?${params.toString()}`);

    attendanceList.innerHTML = data.records.length
      ? data.records.map((record) => `
          <tr>
            <td>${escapeHTML(record.name)}</td>
            <td>${escapeHTML(record.workerId)}</td>
            <td>${escapeHTML(record.site)}</td>
            <td>${escapeHTML(record.date)}</td>
            <td>${escapeHTML(displayTime(record.checkIn))}</td>
            <td>${escapeHTML(displayTime(record.checkOut))}</td>
          </tr>
        `).join("")
      : '<tr><td colspan="6">No attendance records for this date and site.</td></tr>';
  } catch (error) {
    showMessage(error.message, true);
  }
}

$("filterButton").addEventListener("click", loadAttendance);
dateFilter.addEventListener("change", loadAttendance);

$("exportButton").addEventListener("click", async () => {
  const params = new URLSearchParams();

  if (dateFilter.value) params.set("date", dateFilter.value);
  if (siteFilter.value.trim()) params.set("site", siteFilter.value.trim());

  try {
    const response = await fetch(
      `/api/attendance/export?${params.toString()}`,
      { credentials: "same-origin" }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Could not export attendance.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `attendance-${dateFilter.value || today()}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  } catch (error) {
    showMessage(error.message, true);
  }
});

checkLogin();
