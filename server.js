
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE =
  process.env.DATA_FILE ||
  path.join(__dirname, "attendance-data.json");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ workers: [], attendance: [] }, null, 2)
    );
  }

  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function timeNow() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function makeToken(data) {
  const body = Buffer.from(JSON.stringify({
    ...data,
    exp: Date.now() + 12 * 60 * 60 * 1000
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  return body + "." + signature;
}

function session(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith("csa_session="));

  if (!cookie) return null;

  try {
    const token = decodeURIComponent(cookie.slice(12));
    const [body, signature] = token.split(".");

    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(body)
      .digest();

    const actual = Buffer.from(signature, "base64url");

    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) return null;

    const data = JSON.parse(
      Buffer.from(body, "base64url").toString()
    );

    if (data.exp < Date.now()) return null;

    return data;
  } catch {
    return null;
  }
}

function setSession(res, data) {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `csa_session=${encodeURIComponent(makeToken(data))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`
  );
}

function logoutCookie(res) {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `csa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

function adminOnly(req, res, next) {
  const s = session(req);

  if (!s || s.role !== "admin") {
    return res.status(401).json({
      message: "Please sign in as the engineer."
    });
  }

  next();
}

function workerOnly(req, res, next) {
  const s = session(req);

  if (!s || s.role !== "worker") {
    return res.status(401).json({
      message: "Please sign in with your Worker ID and PIN."
    });
  }

  req.workerId = s.workerId;
  next();
}

function safeWorker(w) {
  return {
    worker_id: w.worker_id,
    first_name: w.first_name,
    last_name: w.last_name,
    name: w.first_name + " " + w.last_name,
    phone: w.phone,
    role: w.role,
    site: w.site
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/worker", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "worker.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    date: today(),
    time: timeNow()
  });
});

app.get("/api/session", (req, res) => {
  const s = session(req);

  if (!s) return res.json({ role: "guest" });

  if (s.role === "admin") {
    return res.json({ role: "admin" });
  }

  const worker = loadData().workers.find(
    w => String(w.worker_id) === String(s.workerId)
  );

  if (!worker) return res.json({ role: "guest" });

  res.json({
    role: "worker",
    worker: safeWorker(worker)
  });
});

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
    return res.status(503).json({
      message: "Configure ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET in Render."
    });
  }

  const username = Buffer.from(String(req.body.username || ""));
  const expectedUser = Buffer.from(ADMIN_USERNAME);
  const password = Buffer.from(String(req.body.password || ""));
  const expectedPass = Buffer.from(ADMIN_PASSWORD);

  const userOK =
    username.length === expectedUser.length &&
    crypto.timingSafeEqual(username, expectedUser);

  const passOK =
    password.length === expectedPass.length &&
    crypto.timingSafeEqual(password, expectedPass);

  if (!userOK || !passOK) {
    return res.status(401).json({
      message: "Incorrect username or password."
    });
  }

  setSession(res, {
    role: "admin",
    username: ADMIN_USERNAME
  });

  res.json({ message: "Login successful." });
});

app.post("/api/worker/login", (req, res) => {
  const id = String(req.body.worker_id || "").trim();
  const pin = String(req.body.pin || "").trim();

  const worker = loadData().workers.find(
    w =>
      String(w.worker_id) === id &&
      String(w.pin) === pin &&
      w.active !== false
  );

  if (!worker) {
    return res.status(401).json({
      message: "Incorrect Worker ID or PIN."
    });
  }

  setSession(res, {
    role: "worker",
    workerId: worker.worker_id
  });

  res.json({
    message: "Login successful.",
    worker: safeWorker(worker)
  });
});

app.post("/api/logout", (req, res) => {
  logoutCookie(res);
  res.json({ message: "Signed out." });
});

app.post("/api/register", adminOnly, (req, res) => {
  const first = String(req.body.first_name || "").trim();
  const last = String(req.body.last_name || "").trim();
  const id = String(req.body.worker_id || "").trim();
  const phone = String(req.body.phone || "").trim();
  const pin = String(req.body.pin || "").trim();
  const role = String(req.body.role || "Worker").trim();
  const site = String(req.body.site || "").trim();

  if (!first || !last || !site) {
    return res.status(400).json({
      message: "Enter first name, last name and site."
    });
  }

  if (!/^\d{8}$/.test(id)) {
    return res.status(400).json({
      message: "Worker ID must contain exactly 8 digits."
    });
  }

  if (!/^(01|07)\d{8}$/.test(phone)) {
    return res.status(400).json({
      message: "Enter a valid 10-digit Kenyan phone number."
    });
  }

  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({
      message: "PIN must contain 4 to 6 digits."
    });
  }

  const data = loadData();

  if (data.workers.some(w => String(w.worker_id) === id)) {
    return res.status(409).json({
      message: "Worker ID already exists."
    });
  }

  const worker = {
    worker_id: id,
    first_name: first,
    last_name: last,
    phone,
    pin,
    role,
    site,
    active: true
  };

  data.workers.push(worker);
  saveData(data);

  res.status(201).json({
    message: "Worker registered successfully.",
    worker: safeWorker(worker)
  });
});

app.get("/api/workers", adminOnly, (req, res) => {
  res.json(loadData().workers.map(safeWorker));
});

app.get("/api/sites", adminOnly, (req, res) => {
  const sites = [
    ...new Set(loadData().workers.map(w => w.site))
  ].filter(Boolean);

  res.json(sites.sort());
});

app.get("/api/attendance", adminOnly, (req, res) => {
  const date = req.query.date || today();
  const site = req.query.site || "All Sites";

  const rows = loadData().attendance.filter(a =>
    a.work_date === date &&
    (site === "All Sites" || a.site === site)
  );

  res.json(rows);
});

app.get("/api/admin/stats", adminOnly, (req, res) => {
  const date = req.query.date || today();
  const site = req.query.site || "All Sites";
  const data = loadData();

  const workers = data.workers.filter(w =>
    site === "All Sites" || w.site === site
  );

  const rows = data.attendance.filter(a =>
    a.work_date === date &&
    (site === "All Sites" || a.site === site)
  );

  res.json({
    total: workers.length,
    records: rows.length,
    onsite: rows.filter(a => !a.check_out).length,
    checkedOut: rows.filter(a => a.check_out).length,
    absent: Math.max(workers.length - rows.length, 0)
  });
});

app.get("/api/my-attendance", workerOnly, (req, res) => {
  const row = loadData().attendance.find(a =>
    String(a.worker_id) === String(req.workerId) &&
    a.work_date === today()
  );

  res.json(row || null);
});

app.post("/api/checkin", workerOnly, (req, res) => {
  const data = loadData();

  const worker = data.workers.find(w =>
    String(w.worker_id) === String(req.workerId)
  );

  if (!worker) {
    return res.status(401).json({
      message: "Worker account not found."
    });
  }

  if (data.attendance.some(a =>
    String(a.worker_id) === String(worker.worker_id) &&
    a.work_date === today()
  )) {
    return res.status(409).json({
      message: "You have already checked in today."
    });
  }

  const record = {
    worker_id: worker.worker_id,
    name: worker.first_name + " " + worker.last_name,
    phone: worker.phone,
    role: worker.role,
    site: worker.site,
    work_date: today(),
    check_in: timeNow(),
    check_out: null
  };

  data.attendance.push(record);
  saveData(data);

  res.json({
    message: "Check-in successful.",
    attendance: record
  });
});

app.post("/api/checkout", workerOnly, (req, res) => {
  const data = loadData();

  const record = data.attendance.find(a =>
    String(a.worker_id) === String(req.workerId) &&
    a.work_date === today()
  );

  if (!record) {
    return res.status(400).json({
      message: "Check in before checking out."
    });
  }

  if (record.check_out) {
    return res.status(409).json({
      message: "You have already checked out today."
    });
  }

  record.check_out = timeNow();
  saveData(data);

  res.json({
    message: "Check-out successful.",
    attendance: record
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Attendance server running on port " + PORT);
});
