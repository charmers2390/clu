import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Environment-based config
const PIN = process.env.PIN;  // Render env var
const PORT = process.env.PORT || 3000;
const dataDir = process.env.DATA || "/data";  // Use DATA if set, else default mount
const DATA_FILE = path.join(dataDir, "trackingData.json");

let trackingData = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    trackingData = JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    console.warn("Warning: Failed to parse existing data file; starting fresh.");
    trackingData = {};
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));
}

function generateTrackingNumber() {
  let num;
  do {
    const part1 = Math.floor(100 + Math.random() * 900);
    const part2 = Math.floor(10000000 + Math.random() * 90000000);
    num = `CHM-${part1}-${part2}`;
  } while (trackingData[num]);
  return num;
}

app.post("/create", (req, res) => {
  const { pin, status } = req.body;
  if (pin !== PIN) return res.status(403).json({ error: "Invalid PIN" });

  const trackingNumber = generateTrackingNumber();
  trackingData[trackingNumber] = {
    history: [{ status, location: "Centerville, TN", time: new Date() }]
  };
  saveData();
  res.json({ trackingNumber, history: trackingData[trackingNumber].history });
});

app.post("/update", (req, res) => {
  const { pin, trackingNumber, status } = req.body;
  if (pin !== PIN) return res.status(403).json({ error: "Invalid PIN" });
  if (!trackingData[trackingNumber]) return res.status(404).json({ error: "Tracking not found" });

  trackingData[trackingNumber].history.push({
    status,
    location: "Centerville, TN",
    time: new Date()
  });
  saveData();
  res.json({ trackingNumber, history: trackingData[trackingNumber].history });
});

app.get("/track/:id", (req, res) => {
  const { id } = req.params;
  if (!trackingData[id]) return res.status(404).json({ error: "Not found" });
  res.json(trackingData[id]);
});

app.listen(PORT, () => {
  console.log(`Tracking API running on port ${PORT}. Using data file at: ${DATA_FILE}`);
});
