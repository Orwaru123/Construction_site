"use strict";

// Construction Site Attendance System
const $ = (id) => document.getElementById(id);

const messageBox = $("message");
const page = window.location.pathname.split("/").pop() || "index.html";

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

// ADMIN AUTHENTICATION
async function requireAdmin() {
  try {
    await api("/api/me");
    return true;
  } catch {
    goTo("/");
    return false;
  }
}

// ADMIN LOGIN
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

// ADMIN LOGOUT
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

// WORKER REGISTRATION
const workerForm = $("workerForm");
const workersList = $("workersList");

async function loadWorkers() {
  if (!workersList) return;

  try {
    const data = await api("/api/workers");
    const workers = Array.isArray(data.workers) ? data.workers : [];

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

// WORKER ATTENDANCE: CHECK-IN / CHECK-OUT
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

// DAILY WORKFORCE SUMMARY
// Required dashboard element IDs:
// summaryDate, totalPresent, totalWorkers, totalSupervisors,
// totalEngineers, totalContractors, totalSecurity, totalOtherStaff,
// siteSummaryTable
const summaryDate = $("summaryDate");
const totalPresentElement = $("totalPresent");
const summarySitesTable = $("siteSummaryTable");

const summaryCategoryElements = {
  Workers: $("totalWorkers"),
  Supervisors: $("totalSupervisors"),
  Engineers: $("totalEngineers"),
  Contractors: $("totalContractors"),
  "Security Officers": $("totalSecurity"),
  "Other Staff": $("totalOtherStaff")
};

if (summaryDate && !summaryDate.value) {
  summaryDate.value = today();
}

async function loadWorkforceSummary() {
  if (!summaryDate || !totalPresentElement || !summarySitesTable) {
    return;
  }

  const selectedDate = summaryDate.value;

  if (!selectedDate) {
    showMessage("Please select a date for the workforce summary.", true);
    return;
  }

  clearMessage();

  totalPresentElement.textContent = "…";

  Object.values(summaryCategoryElements).forEach((element) => {
    if (element) element.textContent = "…";
  });

  summarySitesTable.innerHTML =
    '<tr><td colspan="9">Loading workforce summary...</td></tr>';

  try {
    const params = new URLSearchParams({ date: selectedDate });
    const data = await api(`/api/summary?${params.toString()}`);

    totalPresentElement.textContent = Number(data.totalPresent || 0);

    for (const [category, element] of Object.entries(summaryCategoryElements)) {
      if (element) {
        element.textContent = Number(data.roleCounts?.[category] || 0);
      }
    }

    const sites = Array.isArray(data.sites) ? data.sites : [];

    summarySitesTable.innerHTML = sites.length
      ? sites.map((site) => `
          <tr>
            <td>${escapeHTML(site.site)}</td>
            <td>${Number(site.Workers || 0)}</td>
            <td>${Number(site.Supervisors || 0)}</td>
            <td>${Number(site.Engineers || 0)}</td>
            <td>${Number(site.Contractors || 0)}</td>
            <td>${Number(site["Security Officers"] || 0)}</td>
            <td>${Number(site["Other Staff"] || 0)}</td>
            <td><strong>${Number(site.total || 0)}</strong></td>
          </tr>
        `).join("")
      : '<tr><td colspan="8">No attendance records for this date.</td></tr>';
  } catch (error) {
    totalPresentElement.textContent = "—";

    Object.values(summaryCategoryElements).forEach((element) => {
      if (element) element.textContent = "—";
    });

    summarySitesTable.innerHTML =
      '<tr><td colspan="8">Unable to load the workforce summary.</td></tr>';

    showMessage(error.message, true);
  }
}

if (summaryDate) {
  summaryDate.addEventListener("change", loadWorkforceSummary);
}

// ATTENDANCE RECORDS
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
    const records = Array.isArray(data.records) ? data.records : [];

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
      '<tr><td colspan="6">Unable to load attendance records.</td></tr>';

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

// EXPORT ATTENDANCE AS CSV
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
      link.download = `attendance-${dateFilter?.value || today()}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

// PROTECT AND INITIALIZE EACH ADMIN PAGE
if (page !== "index.html") {
  requireAdmin().then((authenticated) => {
    if (!authenticated) return;

    if (workersList) loadWorkers();
    if (attendanceList) loadAttendance();
    if (summaryDate) loadWorkforceSummary();
  });
}
