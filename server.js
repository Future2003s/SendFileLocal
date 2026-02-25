import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import compression from "compression";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
// .trim() để tránh lỗi khi biến môi trường có newline/khoảng trắng thừa trên Linux
const PIN = (process.env.PIN ?? "8081").trim();
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Tạo thư mục uploads nếu chưa tồn tại
await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });

const app = express();

// Nhận đúng IP thật của client nếu LAN Share chạy sau reverse proxy (Nginx, Cloudflare...)
// Điều này giúp rate limit hoạt động đúng trên từng IP thay vì block toàn bộ IP của proxy.
app.set('trust proxy', true);

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────

// Gzip/Brotli nén tất cả response text (JSON, HTML, CSS, JS)
app.use(compression({ level: 6 }));

// Parse JSON body (tăng limit để tránh 413 khi gửi metadata lớn)
app.use(express.json({ limit: "10gb" }));
app.use(express.urlencoded({ extended: true, limit: "10gb" }));

// Phục vụ file tĩnh với cache 1 ngày cho assets (HTML luôn revalidate)
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1d",
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      // HTML không cache để luôn nhận bản mới nhất
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

// ─── SSE (Server-Sent Events) ─────────────────────────────────────────────────
const sseClients = new Set();

function sseSend(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

app.get("/events", (req, res) => {
  if (PIN) {
    const pin = req.headers["x-pin"] || req.query.pin;
    if (pin !== PIN) return res.status(401).end();
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Keep-alive ping để iOS/router không cắt kết nối idle
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n"); // comment SSE, không trigger event handler
    } catch {
      clearInterval(ping);
      sseClients.delete(res);
    }
  }, 25_000);

  sseClients.add(res);
  sseSend("hello", { ok: true });

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

// ─── PIN MIDDLEWARE ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!PIN) return next();
  // Cho phép trang index load không cần PIN để hiện UI nhập PIN
  if (req.method === "GET" && (req.path === "/" || req.path.startsWith("/index")))
    return next();

  const pin = req.headers["x-pin"] || req.query.pin;
  if (pin !== PIN)
    return res.status(401).json({ ok: false, error: "Unauthorized (PIN)" });
  next();
});

// --- RATE LIMITING (REMOVED) ---
// Do chạy trong mạng nội bộ, upload không giới hạn.

// ─── MULTER STORAGE ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const target = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(target)) return cb(null, safe);

    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    let i = 1;
    while (fs.existsSync(path.join(UPLOAD_DIR, `${base} (${i})${ext}`))) i++;
    cb(null, `${base} (${i})${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB/file
});

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Tính ETag đơn giản từ nội dung danh sách để client có thể dùng conditional GET
// Cố gắng auto-fix tên file bị lỗi encoding (mojibake: UTF-8 bytes bị đọc thành Latin-1)
// Ví dụ: "Ä\x90\xC6\xA1n" → "Đơn"
function tryFixMojibake(name) {
  try {
    // Chuyển từng ký tự sang byte Latin-1 rồi giải mã lại UTF-8
    const bytes = Buffer.from(name, 'latin1');
    const decoded = bytes.toString('utf8');
    // Nếu chuỗi giải mã xong mà encode lại thành utf8 ra đúng byte array ban đầu,
    // thì chắc chắn ban đầu nó là mảng byte UTF-8 nhưng bị đọc nhầm thành Latin-1.
    if (Buffer.from(decoded, 'utf8').equals(bytes) && decoded !== name) {
      return decoded;
    }
    return name;
  } catch {
    return name;
  }
}

async function getFilesWithEtag() {
  const names = await fsPromises.readdir(UPLOAD_DIR);
  const stats = await Promise.all(
    names.map(async (rawName) => {
      const p = path.join(UPLOAD_DIR, rawName);
      const st = await fsPromises.stat(p);
      const name = tryFixMojibake(rawName);
      return { name, _rawName: rawName, size: st.size, mtime: st.mtimeMs };
    })
  );
  stats.sort((a, b) => b.mtime - a.mtime);

  const raw = stats.map((f) => `${f._rawName}:${f.mtime}`).join("|");
  const etag = `"${crypto.createHash("md5").update(raw).digest("hex").slice(0, 16)}"`;
  // Không trả _rawName ra client
  return { files: stats.map(({ _rawName, ...rest }, i) => ({ ...rest, index: i + 1 })), etag };
}

app.get("/api/files", async (req, res) => {
  try {
    const { files, etag } = await getFilesWithEtag();

    // Conditional GET — 304 Not Modified nếu client đã có bản này
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache"); // revalidate mỗi lần, nhưng dùng ETag
    res.json({ ok: true, files });
  } catch (e) {
    console.error("GET /api/files error:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const uploaded = (req.files ?? []).map((f) => f.filename);
    res.json({ ok: true, uploaded });
    sseSend("changed", { type: "upload", uploaded, at: Date.now() });
  } catch (e) {
    console.error("POST /api/upload error:", e);
    res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

// Chuẩn hoá path để so sánh an toàn trên Windows (case-insensitive, unified sep)
const UPLOAD_DIR_NORM = path.normalize(UPLOAD_DIR).toLowerCase() + path.sep;

function isSafeUploadPath(p) {
  return path.normalize(p).toLowerCase().startsWith(UPLOAD_DIR_NORM);
}

app.get("/download/:name", (req, res) => {
  const name = req.params.name;
  const p = path.resolve(UPLOAD_DIR, name);
  if (!isSafeUploadPath(p)) return res.status(400).send("Bad Request");

  // Thử tìm file: trước tiên bằng tên gốc, sau đó bằng tên đã fix mojibake
  let filePath = p;
  if (!fs.existsSync(p)) {
    // Tìm file có tên mojibake tương ứng
    const allFiles = fs.readdirSync(UPLOAD_DIR);
    const match = allFiles.find(f => tryFixMojibake(f) === name || f === name);
    if (!match) return res.status(404).send("Not found");
    filePath = path.join(UPLOAD_DIR, match);
  }

  // Thiết lập Content-Disposition với UTF-8 encoding đúng chuẩn RFC 5987
  const dispName = encodeURIComponent(path.basename(filePath));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${dispName}`);

  res.sendFile(filePath, { dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

app.delete("/api/files/:name", async (req, res) => {
  const name = req.params.name;
  const p = path.resolve(UPLOAD_DIR, name);

  if (!isSafeUploadPath(p)) return res.status(400).json({ ok: false, error: "Bad Request" });

  // Tìm file thực tế trên disk (kể cả tên mojibake)
  let filePath = p;
  if (!fs.existsSync(p)) {
    const allFiles = fs.readdirSync(UPLOAD_DIR);
    const match = allFiles.find(f => tryFixMojibake(f) === name || f === name);
    if (!match) return res.status(404).json({ ok: false, error: "Not found" });
    filePath = path.join(UPLOAD_DIR, match);
  }

  try {
    await fsPromises.unlink(filePath);
    res.json({ ok: true });
    sseSend("changed", { type: "delete", name, at: Date.now() });
  } catch (e) {
    if (e.code === "ENOENT") return res.status(404).json({ ok: false, error: "Not found" });
    console.error("DELETE error:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIPv4();
  console.log(`✅ LAN Share running: http://${ip}:${PORT}  (localhost: http://127.0.0.1:${PORT})`);
  if (PIN) console.log(`🔒 PIN enabled: ${PIN}`);
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully…`);

  // Đóng tất cả SSE connections
  for (const res of sseClients) {
    try { res.end(); } catch { }
  }
  sseClients.clear();

  // Dừng nhận request mới, chờ hiện tại hoàn thành
  server.close(() => {
    console.log("Server closed. Bye!");
    process.exit(0);
  });

  // Timeout tối đa 10 giây
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
