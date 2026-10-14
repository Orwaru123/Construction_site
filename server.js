
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = process.env.DATA_FILE ||
  path.join(__dirname, "attendance-data.json");

const WORKERS_FILE = process.env.WORKERS_FILE ||
  path.join(__dirname, "workers.json");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error(
    "Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET in your hosting environment."
  );
  process.exit(1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

const sessions = new Map();

function readArray(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      fs.writeFileSync(file, "[]", { mode: 0o600 });
      return [];
    }
    throw error;
  }
}

function writeArray(file, records) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), {
    mode: 0o600
  });
  fs.renameSync(temp, file);
}

function getNairobiDate() {
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

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pin, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPin(pin, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(pin, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");

    return actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function safeWorker(worker) {
  const { pinSalt, pinHash, ...publicWorker } = worker;
  return publicWorker;
}

function auth(req, res, next) {
  const sid = req.cookiesSid;

  if (!sid || !sessions.has(sid)) {
    return res.status(401).json({
      error: "Please sign in as admin first."
    });
  }

  next();
}

// Read the session cookie without an additional dependency.
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/(?:^|;\s*)attendance_sid=([^;]+)/);
  req.cookiesSid = match ? decodeURIComponent(match[1]) : null;
  next();
});

function setSessionCookie(res, sid) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `attendance_sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${secure}`
  );
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username !== ADMIN_USERNAME ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "Incorrect admin username or password."
    });
  }

  const sid = crypto.randomBytes(32).toString("hex");
  sessions.set(sid, { createdAt: Date.now() });
  setSessionCookie(res, sid);

  res.json({ message: "Login successful." });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ authenticated: true });
});

app.post("/api/logout", (req, res) => {
  if (req.cookiesSid) sessions.delete(req.cookiesSid);

  res.setHeader(
    "Set-Cookie",
    "attendance_sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0"
  );

  res.json({ message: "Logged out." });
});

// Require admin access for worker management and attendance.
app.use("/api/workers", auth);
app.use("/api/attendance", auth);

app.get("/api/workers", (req, res) => {
  const workers = readArray(WORKERS_FILE).map(safeWorker);
  res.json({ workers });
});

app.post("/api/workers", (req, res) => {
  const { name, workerId, phone, pin, role, site } = req.body || {};

  if (
    ![name, workerId, phone, pin, role, site].every(
      (value) => typeof value === "string" && value.trim()
    )
  ) {
    return res.status(400).json({
      error: "Please fill in every worker field."
    });
  }

  const cleanId = workerId.trim();
  const cleanName = name.trim();
  const cleanPhone = phone.trim();
  const cleanRole = role.trim();
  const cleanSite = site.trim();

  if (!/^\d{8}$/.test(cleanId)) {
    return res.status(400).json({
      error: "Worker ID must contain exactly 8 digits."
    });
  }

  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({
      error: "PIN must contain 4 to 8 digits."
    });
  }

  if ([cleanName, cleanPhone, cleanRole, cleanSite].some(
    value => value.length > 120
  )) {
    return res.status(400).json({
      error: "Worker details are too long."
    });
  }

  const workers = readArray(WORKERS_FILE);

  if (workers.some(worker => worker.workerId === cleanId)) {
    return res.status(409).json({
      error: "That Worker ID is already registered."
    });
  }

  const { salt, hash } = hashPin(pin);

  workers.push({
    name: cleanName,
    workerId: cleanId,
    phone: cleanPhone,
    role: cleanRole,
    site: cleanSite,
    pinSalt: salt,
    pinHash: hash,
    createdAt: new Date().toISOString()
  });

  writeArray(WORKERS_FILE, workers);

  res.status(201).json({
    message: "Worker registered successfully."
  });
});

app.post("/api/attendance/check-in", (req, res) => {
  recordAttendance(req, res, "check-in");
});

app.post("/api/attendance/check-out", (req, res) => {
  recordAttendance(req, res, "check-out");
});

function recordAttendance(req, res, action) {
  const { workerId, pin } = req.body || {};

  if (
    typeof workerId !== "string" ||
    typeof pin !== "string" ||
    !workerId.trim() ||
    !pin
  ) {
    return res.status(400).json({
      error: "Enter your Worker ID and PIN."
    });
  }

  const workers = readArray(WORKERS_FILE);
  const worker = workers.find(
    item => item.workerId === workerId.trim()
  );

  if (!worker || !verifyPin(pin, worker.pinSalt, worker.pinHash)) {
    return res.status(401).json({
      error: "Invalid Worker ID or PIN."
    });
  }

  const date = getNairobiDate();
  const records = readArray(DATA_FILE);

  let record = records.find(
    item => item.workerId === worker.workerId && item.date === date
  );

  if (action === "check-in") {
    if (record) {
      return res.status(409).json({
        error: record.checkOut
          ? "You have already checked in and checked out today."
          : "You have already checked in today."
      });
    }

    record = {
      name: worker.name,
      workerId: worker.workerId,
      role: worker.role,
      site: worker.site,
      date,
      checkIn: new Date().toISOString(),
      checkOut: null
    };

    records.push(record);
    writeArray(DATA_FILE, records);

    return res.json({
      message: `Check-in successful for ${worker.name} at ${worker.site}.`
    });
  }

  if (!record) {
    return res.status(400).json({
      error: "You must check in before checking out."
    });
  }

  if (record.checkOut) {
    return res.status(409).json({
      error: "You have already checked out today."
    });
  }

  record.checkOut = new Date().toISOString();
  writeArray(DATA_FILE, records);

  return res.json({
    message: `Check-out successful for ${worker.name}.`
  });
}

app.get("/api/attendance", (req, res) => {
  const date = req.query.date || getNairobiDate();
  const site = String(req.query.site || "").trim().toLowerCase();

  if (!validDate(date)) {
    return res.status(400).json({
      error: "Please select a valid attendance date."
    });
  }

  const records = readArray(DATA_FILE).filter(record => {
    const sameDate = record.date === date;
    const sameSite = !site ||
      String(record.site || "").toLowerCase().includes(site);

    return sameDate && sameSite;
  });

  res.json({ records });
});

app.get("/api/attendance/export", (req, res) => {
  const date = req.query.date || getNairobiDate();
  const site = String(req.query.site || "").trim().toLowerCase();

  if (!validDate(date)) {
    return res.status(400).json({
      error: "Please select a valid attendance date."
    });
  }

  const records = readArray(DATA_FILE).filter(record => {
    return record.date === date &&
      (!site ||
       String(record.site || "").toLowerCase().includes(site));
  });

  const columns = [
    "Name", "Worker ID", "Role", "Site",
    "Date", "Check In", "Check Out"
  ];

  const values = records.map(record => [
    record.name,
    record.workerId,
    record.role,
    record.site,
    record.date,
    record.checkIn,
    record.checkOut || ""
  ]);

  // Escape CSV cells so commas and quotation marks do not break columns.
  const csvCell = value =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [columns, ...values]
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="attendance-${date}.csv"`
  );
  res.send("\uFEFF" + csv);
});

// Serve the website from the public folder.
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error. Please try again." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Construction attendance server running on port ${PORT}`);
});
