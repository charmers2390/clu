// server.js (Render-ready)
// CLU Tracking backend with persistent disk (/data) on Render
// - Everyone shares the same tracking data
// - Issues shareable links like:
//   /?Tracking/tools/trackingcode=CHM-123-12345678/token=<random>
//
// ENV:
//   PIN (default 0431)
//
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PIN = process.env.PIN || "0431";
const CODE_RE = /^CHM-\d{3}-\d{8}$/;
const PORT = process.env.PORT || 3000;

// On Render, mount a Disk at /data for persistence
const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_PATH = path.join(DATA_DIR, "db.json");
const TOKENS_PATH = path.join(DATA_DIR, "tokens.json");

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.set("trust proxy", true); // to read X-Forwarded-Proto on Render
app.use(cors()); // allow all origins (front-end can be anywhere)
app.use(express.json());

/** Helpers **/
function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}
function loadDB() { return readJSON(DB_PATH, {}); }
function saveDB(db) { writeJSON(DB_PATH, db); }
function loadTokens() { return readJSON(TOKENS_PATH, {}); }
function saveTokens(t) { writeJSON(TOKENS_PATH, t); }

function pad(n, len){ return String(n).padStart(len, "0"); }
function randomInt(max){ return Math.floor(Math.random() * (max + 1)); }
function generateUniqueCode(db){
  let code, tries = 0;
  do {
    const partA = pad(randomInt(999), 3);
    const partB = pad(randomInt(99999999), 8);
    code = `CHM-${partA}-${partB}`;
    tries++;
    if (tries > 10000) throw new Error("Could not generate unique code");
  } while (db[code]);
  return code;
}
function newToken() {
  return crypto.randomBytes(12).toString("hex"); // 24 hex chars
}
function baseURL(req){
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  const host = req.headers.host;
  return `${proto}://${host}`;
}

/** Routes **/
// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// Create a new tracking
app.post("/api/create", (req, res) => {
  const { pin, initialText } = req.body || {};
  if (pin !== PIN) return res.status(403).json({ error: "Invalid PIN" });

  const db = loadDB();
  const code = generateUniqueCode(db);
  const init = (initialText && String(initialText).trim()) || "Label created";
  db[code] = { updates: [{ ts: Date.now(), text: init }] };
  saveDB(db);

  return res.json({ code, updates: db[code].updates });
});

// Add update
app.post("/api/add", (req, res) => {
  const { pin, code, text } = req.body || {};
  if (pin !== PIN) return res.status(403).json({ error: "Invalid PIN" });
  if (!CODE_RE.test(code || "")) return res.status(400).json({ error: "Invalid code format" });

  const db = loadDB();
  if (!db[code]) return res.status(404).json({ error: "Code not found" });

  if (!text || !String(text).trim()) return res.status(400).json({ error: "Missing update text" });

  db[code].updates.push({ ts: Date.now(), text: String(text).trim() });
  saveDB(db);
  return res.json({ ok: true, updates: db[code].updates });
});

// Track
app.get("/api/track/:code", (req, res) => {
  const code = req.params.code;
  if (!CODE_RE.test(code)) return res.status(400).json({ error: "Invalid code format" });
  const db = loadDB();
  if (!db[code]) return res.status(404).json({ error: "Not found" });
  return res.json({ code, updates: db[code].updates });
});

// Build a shareable link that includes a token
app.get("/api/share-link", (req, res) => {
  const code = String(req.query.code || "");
  if (!CODE_RE.test(code)) return res.status(400).json({ error: "Invalid code format" });

  const db = loadDB();
  if (!db[code]) return res.status(404).json({ error: "Not found" });

  const tokens = loadTokens();
  const token = newToken();
  tokens[token] = { code, ts: Date.now() };
  saveTokens(tokens);

  // Desired format: /?Tracking/tools/trackingcode=CHM-.../token=<random>
  const relative = `/?Tracking/tools/trackingcode=${encodeURIComponent(code)}/token=${encodeURIComponent(token)}`;
  const fullUrl = `${baseURL(req)}${relative}`;
  return res.json({ url: relative, fullUrl, token });
});

// Verify token + code and return tracking
app.get("/api/shared", (req, res) => {
  const code = String(req.query.trackingcode || "");
  const token = String(req.query.token || "");

  if (!CODE_RE.test(code)) return res.status(400).json({ error: "Invalid code format" });

  const tokens = loadTokens();
  const entry = tokens[token];
  if (!entry || entry.code !== code) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  const db = loadDB();
  if (!db[code]) return res.status(404).json({ error: "Not found" });
  return res.json({ code, updates: db[code].updates });
});

// Fallback 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`CLU Tracking server listening on :${PORT}`);
});