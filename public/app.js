
"use strict";

// Construction Site Attendance System
const $ = (id) => document.getElementById(id);

const messageBox = $("message");
const page = window.location.pathname.split("/").pop() || "index.html";

// --------------------------------------------------
// API HELPERS
// --------------------------------------------------

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

function showMessage(message, isError = false) {
  if (!messageBox) {
    alert(message);
    return;
  }

  messageBox.textContent = message;
  messageBox.className = isError
    ? "message error"
    : "message success";
  messageBox.hidden = false;
}

function clearMessage() {
  if (!messageBox) return;

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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
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

function goTo(url) {
  window.location.href = url;
}

// --------------------------------------------------
// ADMIN AUTHENTICATION
// --------------------------------------------------

async function requireAdmin() {
  try {
    await api("/api/me");
    return true;
  } catch {
    goTo("/");
    return false;
  }
}

// --------------------------------------------------
// ADMIN LOGIN
// --------------------------------------------------

const loginForm = $("loginForm");

if (loginForm) {
  api("/api/me")
    .then(() => goTo("/dashboard.html"))
    .catch(() => {});

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const username = $("username");
    const password = $("password");
    const button = loginForm.querySelector('button[type="submit"]');

    try {
      if (button) button.disabled = true;

      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: username.value.trim(),
          password: password.value
        })
      });

      password.value = "";
      goTo("/dashboard.html");
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

// --------------------------------------------------
// ADMIN LOGOUT
// --------------------------------------------------

const logoutButton = $("logoutButton");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    clearMessage();
    logoutButton.disabled = true;

    try {
      await api("/api/logout", { method: "POST" });
      goTo("/");
    } catch (error) {
      showMessage(error.message, true);
      logoutButton.disabled = false;
    }
  });
}

// --------------------------------------------------
// WORKER REGISTRATION
// --------------------------------------------------

const workerForm = $("workerForm");
const workersList = $("workersList");

async function loadWorkers() {
  if (!workersList) return;

  try {
    const data = await api("/api/workers");
    const workers = data.workers || [];

    workersList.innerHTML = workers.length
      ? workers.map((worker) => `
          <tr>
            <td>${escapeHTML(worker.name)}</td>
            <td>${escapeHTML(worker.workerId)}</td>
            <td>${escapeHTML(worker.phone)}</td>
            <td>${escapeHTML(worker.role)}</td>
            <td>${escapeHTML(worker.site)}</td>
          </tr>
        `).join("")
      : '<tr><td colspan="5">No workers registered yet.</td></tr>';
  } catch (error) {
    showMessage(error.message, true);
  }
}

if (workerForm) {
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

    const button = workerForm.querySelector('button[type="submit"]');

    try {
      if (button) button.disabled = true;

      const result = await api("/api/workers", {
        method: "POST",
        body: JSON.stringify(worker)
      });

      workerForm.reset();
      showMessage(result.message || "Worker registered successfully.");
      await loadWorkers();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

// --------------------------------------------------
// WORKER ATTENDANCE
// --------------------------------------------------

const attendanceForm = $("attendanceForm");

if (attendanceForm) {
  attendanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const action = $("attendanceAction").value;
    const button = attendanceForm.querySelector('button[type="submit"]');

    try {
      if (button) button.disabled = true;

      const result = await api(`/api/attendance/${action}`, {
        method: "POST",
        body: JSON.stringify({
          workerId: $("attendanceWorkerId").value.trim(),
          pin: $("attendancePin").value
        })
      });

      $("attendancePin").value = "";
      showMessage(result.message || "Attendance recorded successfully.");
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

// --------------------------------------------------
// ATTENDANCE RECORDS
// --------------------------------------------------

const attendanceList = $("attendanceList");
const siteFilter = $("siteFilter");
const dateFilter = $("dateFilter");
const filterButton = $("filterButton");
const exportButton = $("exportButton");

if (dateFilter && !dateFilter.value) {
  dateFilter.value = today();
}

async function loadAttendance() {
  if (!attendanceList) return;

  clearMessage();

  const params = new URLSearchParams();

  if (dateFilter && dateFilter.value) {
    params.set("date", dateFilter.value);
  }

  if (siteFilter && siteFilter.value.trim()) {
    params.set("site", siteFilter.value.trim());
  }

  attendanceList.innerHTML =
    '<tr><td colspan="6">Loading attendance records...</td></tr>';

  try {
    const data = await api(`/api/attendance?${params.toString()}`);
    const records = data.records || [];

    attendanceList.innerHTML = records.length
      ? records.map((record) => `
          <tr>
            <td>${escapeHTML(record.name)}</td>
            <td>${escapeHTML(record.workerId)}</td>
            <td>${escapeHTML(record.role)}</td>
            <td>${escapeHTML(record.site)}</td>
            <td>${escapeHTML(displayTime(record.checkIn))}</td>
            <td>${escapeHTML(displayTime(record.checkOut))}</td>
          </tr>
        `).join("")
      : '<tr><td colspan="6">No attendance records for this date and site.</td></tr>';
  } catch (error) {
    attendanceList.innerHTML =
      `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;

    showMessage(error.message, true);
  }
}

if (filterButton) {
  filterButton.addEventListener("click", loadAttendance);
}

if (dateFilter) {
  dateFilter.addEventListener("change", loadAttendance);
}

if (siteFilter) {
  siteFilter.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadAttendance();
    }
  });
}

// --------------------------------------------------
// EXPORT ATTENDANCE AS CSV
// --------------------------------------------------

if (exportButton) {
  exportButton.addEventListener("click", async () => {
    clearMessage();

    const params = new URLSearchParams();

    if (dateFilter && dateFilter.value) {
      params.set("date", dateFilter.value);
    }

    if (siteFilter && siteFilter.value.trim()) {
      params.set("site", siteFilter.value.trim());
    }

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
      link.download =
        `attendance-${dateFilter?.value || today()}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

// --------------------------------------------------
// DAILY WORKFORCE SUMMARY
// --------------------------------------------------

const summaryDate = $("summaryDate");
const totalPresent = $("totalPresent");
const totalWorkers = $("totalWorkers");
const totalSupervisors = $("totalSupervisors");
const totalEngineers = $("totalEngineers");
const totalContractors = $("totalContractors");
const totalSecurity = $("totalSecurity");
const totalOtherStaff = $("totalOtherStaff");
const siteSummaryTable = $("siteSummaryTable");

let summaryRequestNumber = 0;

async function loadSummary() {
  if (!summaryDate || !totalPresent) return;

  const requestNumber = ++summaryRequestNumber;
  const date = summaryDate.value || today();

  clearMessage();

  totalPresent.textContent = "…";

  const countElements = [
    totalWorkers,
    totalSupervisors,
    totalEngineers,
    totalContractors,
    totalSecurity,
    totalOtherStaff
  ];

  countElements.forEach((element) => {
    if (element) element.textContent = "…";
  });

  if (siteSummaryTable) {
    siteSummaryTable.innerHTML =
      '<tr><td colspan="8">Loading workforce summary...</td></tr>';
  }

  try {
    const data = await api(
      `/api/summary?date=${encodeURIComponent(date)}`
    );

    // Ignore an older request if the date was changed while loading.
    if (requestNumber !== summaryRequestNumber) return;

    const counts = data.roleCounts || {};

    totalPresent.textContent = data.totalPresent ?? 0;

    if (totalWorkers)
      totalWorkers.textContent = counts.Workers ?? 0;

    if (totalSupervisors)
      totalSupervisors.textContent = counts.Supervisors ?? 0;

    if (totalEngineers)
      totalEngineers.textContent = counts.Engineers ?? 0;

    if (totalContractors)
      totalContractors.textContent = counts.Contractors ?? 0;

    if (totalSecurity)
      totalSecurity.textContent = counts["Security Officers"] ?? 0;

    if (totalOtherStaff)
      totalOtherStaff.textContent = counts["Other Staff"] ?? 0;

    if (siteSummaryTable) {
      const sites = data.sites || [];

      siteSummaryTable.innerHTML = sites.length
        ? sites.map((site) => `
            <tr>
              <td>${escapeHTML(site.site)}</td>
              <td>${site.Workers ?? 0}</td>
              <td>${site.Supervisors ?? 0}</td>
              <td>${site.Engineers ?? 0}</td>
              <td>${site.Contractors ?? 0}</td>
              <td>${site["Security Officers"] ?? 0}</td>
              <td>${site["Other Staff"] ?? 0}</td>
              <td>${site.total ?? 0}</td>
            </tr>
          `).join("")
        : '<tr><td colspan="8">No attendance records for this date.</td></tr>';
    }
  } catch (error) {
    if (requestNumber !== summaryRequestNumber) return;

    totalPresent.textContent = "—";

    countElements.forEach((element) => {
      if (element) element.textContent = "—";
    });

    if (siteSummaryTable) {
      siteSummaryTable.innerHTML =
        `<tr><td colspan="8">${escapeHTML(error.message)}</td></tr>`;
    }

    showMessage(`Workforce summary could not load: ${error.message}`, true);
  }
}

if (summaryDate) {
  if (!summaryDate.value) {
    summaryDate.value = today();
  }

  summaryDate.addEventListener("change", loadSummary);
}

// --------------------------------------------------
// PROTECT AND INITIALIZE PAGES
// --------------------------------------------------

if (page !== "index.html") {
  requireAdmin().then((authenticated) => {
    if (!authenticated) return;

    if (workersList) loadWorkers();
    if (attendanceList) loadAttendance();
    if (summaryDate) loadSummary();
  });
}
