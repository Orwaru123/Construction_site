
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error(
    "Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET."
  );
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Set DATABASE_URL in Render.");
  process.exit(1);
}

if (ADMIN_PASSWORD.length < 12 || SESSION_SECRET.length < 32) {
  console.error(
    "Admin password must be at least 12 characters and SESSION_SECRET at least 32."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

pool.on("error", err => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

const sessions = new Map();
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

function getNairobiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) values[part.type] = part.value;

  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(date) {
  if (typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(pin, salt, 64).toString("hex")
  };
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
  const {
    pinSalt,
    pinHash,
    ...publicWorker
  } = worker;
  return publicWorker;
}

app.use((req, res, next) => {
  const header = req.headers.cookie || "";
  const match = header.match(
    /(?:^|;\s*)attendance_sid=([^;]+)/
  );

  try {
    req.cookiesSid = match ? decodeURIComponent(match[1]) : null;
  } catch {
    req.cookiesSid = null;
  }

  next();
});

function auth(req, res, next) {
  const sid = req.cookiesSid;
  const session = sid ? sessions.get(sid) : null;

  if (!session) {
    return res.status(401).json({
      error: "Please sign in as admin first."
    });
  }

  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sid);
    res.setHeader(
      "Set-Cookie",
      "attendance_sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0; Secure"
    );

    return res.status(401).json({
      error: "Your session has expired. Please sign in again."
    });
  }

  next();
}

function setSessionCookie(res, sid) {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `attendance_sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${secure}`
  );
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Database connection test.
app.get("/api/db-health", auth, async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    next(err);
  }
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

  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `attendance_sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`
  );

  res.json({ message: "Logged out." });
});

app.use("/api/workers", auth);
app.use("/api/attendance", auth);

// List workers. Never send PIN hashes to the browser.
app.get("/api/workers", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT name,
             worker_id AS "workerId",
             phone,
             role,
             site,
             created_at AS "createdAt"
      FROM workers
      ORDER BY created_at DESC
    `);

    res.json({ workers: result.rows });
  } catch (err) {
    next(err);
  }
});

// Register a worker.
app.post("/api/workers", async (req, res, next) => {
  try {
    const { name, workerId, phone, pin, role, site } = req.body || {};

    if (
      ![name, workerId, phone, pin, role, site].every(
        value => typeof value === "string" && value.trim()
      )
    ) {
      return res.status(400).json({
        error: "Please fill in every worker field."
      });
    }

    const cleanName = name.trim();
    const cleanId = workerId.trim();
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

    if (
      [cleanName, cleanPhone, cleanRole, cleanSite].some(
        value => value.length > 120
      )
    ) {
      return res.status(400).json({
        error: "Worker details are too long."
      });
    }

    const { salt, hash } = hashPin(pin);

    await pool.query(
      `INSERT INTO workers
       (worker_id, name, phone, role, site, pin_salt, pin_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cleanId, cleanName, cleanPhone, cleanRole, cleanSite, salt, hash]
    );

    res.status(201).json({
      message: "Worker registered successfully."
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "That Worker ID is already registered."
      });
    }
    next(err);
  }
});

// Check-in and check-out.
app.post("/api/attendance/check-in", (req, res, next) => {
  recordAttendance(req, res, "check-in", next);
});

app.post("/api/attendance/check-out", (req, res, next) => {
  recordAttendance(req, res, "check-out", next);
});

async function recordAttendance(req, res, action, next) {
  try {
    const { workerId, pin } = req.body || {};

    if (
      typeof workerId !== "string" ||
      typeof pin !== "string" ||
      !workerId.trim() ||
      !pin
    ) {
      return res.status(400).json({
        error: "Enter the Worker ID and PIN."
      });
    }

    const workerResult = await pool.query(
      `SELECT worker_id, name, role, site, pin_salt, pin_hash
       FROM workers WHERE worker_id = $1`,
      [workerId.trim()]
    );

    const worker = workerResult.rows[0];

    if (
      !worker ||
      !verifyPin(pin, worker.pin_salt, worker.pin_hash)
    ) {
      return res.status(401).json({
        error: "Invalid Worker ID or PIN."
      });
    }

    const date = getNairobiDate();

    if (action === "check-in") {
      try {
        await pool.query(
          `INSERT INTO attendance
           (worker_id, name, role, site, attendance_date, check_in)
           VALUES ($1, $2, $3, $4, $5::date, NOW())`,
          [worker.worker_id, worker.name, worker.role, worker.site, date]
        );
      } catch (err) {
        if (err.code === "23505") {
          const existing = await pool.query(
            `SELECT check_out FROM attendance
             WHERE worker_id = $1 AND attendance_date = $2::date`,
            [worker.worker_id, date]
          );

          return res.status(409).json({
            error: existing.rows[0]?.check_out
              ? "This worker has already checked in and checked out today."
              : "This worker has already checked in today."
          });
        }
        throw err;
      }

      return res.json({
        message: `Check-in successful for ${worker.name} at ${worker.site}.`
      });
    }

    const updated = await pool.query(
      `UPDATE attendance
       SET check_out = NOW()
       WHERE worker_id = $1
         AND attendance_date = $2::date
         AND check_out IS NULL
       RETURNING worker_id`,
      [worker.worker_id, date]
    );

    if (updated.rowCount === 0) {
      const existing = await pool.query(
        `SELECT check_out FROM attendance
         WHERE worker_id = $1 AND attendance_date = $2::date`,
        [worker.worker_id, date]
      );

      if (!existing.rows.length) {
        return res.status(400).json({
          error: "The worker must check in before checking out."
        });
      }

      return res.status(409).json({
        error: "This worker has already checked out today."
      });
    }

    return res.json({
      message: `Check-out successful for ${worker.name}.`
    });
  } catch (err) {
    next(err);
  }
}

const ATTENDANCE_SELECT = `
  SELECT name,
         worker_id AS "workerId",
         role,
         site,
         attendance_date::text AS date,
         check_in AS "checkIn",
         check_out AS "checkOut"
  FROM attendance
`;

function attendanceFilters(date, site) {
  if (site) {
    return {
      sql: " WHERE attendance_date = $1::date AND LOWER(site) LIKE $2",
      params: [date, `%${site.toLowerCase()}%`]
    };
  }

  return {
    sql: " WHERE attendance_date = $1::date",
    params: [date]
  };
}

// List attendance for a selected date and optional site.
app.get("/api/attendance", async (req, res, next) => {
  try {
    const date = req.query.date || getNairobiDate();
    const site = String(req.query.site || "").trim();

    if (!validDate(date)) {
      return res.status(400).json({
        error: "Please select a valid attendance date."
      });
    }

    const filter = attendanceFilters(date, site);
    const result = await pool.query(
      ATTENDANCE_SELECT + filter.sql + " ORDER BY check_in DESC",
      filter.params
    );

    res.json({ records: result.rows });
  } catch (err) {
    next(err);
  }
});

// Export attendance as CSV.
app.get("/api/attendance/export", async (req, res, next) => {
  try {
    const date = req.query.date || getNairobiDate();
    const site = String(req.query.site || "").trim();

    if (!validDate(date)) {
      return res.status(400).json({
        error: "Please select a valid attendance date."
      });
    }

    const filter = attendanceFilters(date, site);
    const result = await pool.query(
      ATTENDANCE_SELECT + filter.sql + " ORDER BY check_in",
      filter.params
    );

    const columns = [
      "Name", "Worker ID", "Role", "Site",
      "Date", "Check In", "Check Out"
    ];

    const values = result.rows.map(record => [
      record.name,
      record.workerId,
      record.role,
      record.site,
      record.date,
      record.checkIn ? new Date(record.checkIn).toISOString() : "",
      record.checkOut ? new Date(record.checkOut).toISOString() : ""
    ]);

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
  } catch (err) {
    next(err);
  }
});

// Keep the login page public; protect other HTML pages.
app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return next();

  const page = req.path;

  if (
    page === "/" ||
    page === "/index.html" ||
    !page.endsWith(".html")
  ) {
    return next();
  }

  const session = req.cookiesSid
    ? sessions.get(req.cookiesSid)
    : null;

  if (
    !session ||
    Date.now() - session.createdAt > SESSION_MAX_AGE
  ) {
    if (req.cookiesSid) sessions.delete(req.cookiesSid);
    return res.redirect("/");
  }

  next();
});

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("Request failed:", err.message);

  if (res.headersSent) return next(err);

  res.status(500).json({
    error: "Server or database error. Please try again."
  });
});

pool.query("SELECT 1")
  .then(() => {
    console.log("Neon PostgreSQL connected successfully.");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Construction attendance server running on port ${PORT}`
      );
    });
  })
  .catch(err => {
    console.error("Could not connect to Neon PostgreSQL:", err.message);
    process.exit(1);
  });
