import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const PIN = process.env.PIN || ""; // ví dụ: set PIN=1234
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== SSE (Server-Sent Events) =====
const sseClients = new Set();

function sseSend(event, data) {
  const payload =
    `event: ${event}\n` +
    `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

app.get("/events", (req, res) => {
  // (optional) PIN check giống các API khác
  if (PIN) {
    const pin = req.headers["x-pin"] || req.query.pin;
    if (pin !== PIN) return res.status(401).end();
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // keep-alive ping để iOS/router không cắt kết nối
  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: {}\n\n`); } catch {}
  }, 25000);

  sseClients.add(res);

  // gửi trạng thái ban đầu
  sseSend("hello", { ok: true });

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});


function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

// PIN middleware (optional)
app.use((req, res, next) => {
  if (!PIN) return next();
  // Cho phép trang index load không cần PIN để hiện UI nhập PIN
  if (req.method === "GET" && (req.path === "/" || req.path.startsWith("/index"))) return next();

  const pin = req.headers["x-pin"] || req.query.pin;
  if (pin !== PIN) return res.status(401).json({ ok: false, error: "Unauthorized (PIN)" });
  next();
});

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    // tránh lỗi tên trùng
    const safe = file.originalname.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const target = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(target)) return cb(null, safe);

    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    let i = 1;
    while (fs.existsSync(path.join(UPLOAD_DIR, `${base} (${i})${ext}`))) i++;
    cb(null, `${base} (${i})${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB/file (tuỳ chỉnh)
});

app.get("/api/files", (_, res) => {
  const files = fs.readdirSync(UPLOAD_DIR).map((name) => {
    const p = path.join(UPLOAD_DIR, name);
    const st = fs.statSync(p);
    return { name, size: st.size, mtime: st.mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);

  res.json({ ok: true, files });
});

app.post("/api/upload", upload.array("files"), (req, res) => {
    const uploaded = (req.files || []).map(f => f.filename);
    res.json({ ok: true, uploaded });
  
    // báo cho mọi client cập nhật
    sseSend("changed", { type: "upload", uploaded, at: Date.now() });
});

app.get("/download/:name", (req, res) => {
  const name = req.params.name;
  const p = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.download(p, name);
});

app.delete("/api/files/:name", (req, res) => {
  const name = req.params.name;
  const p = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: "Not found" });
  fs.unlinkSync(p);
  res.json({ ok: true });
  sseSend("changed", { type: "delete", name, at: Date.now() });
});

app.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIPv4();
  console.log(`LAN Share running: http://${ip}:${PORT}`);
  if (PIN) console.log(`PIN enabled: ${PIN}`);
});
