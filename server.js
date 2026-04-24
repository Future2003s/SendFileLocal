import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import compression from "compression";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
// .trim() để tránh lỗi khi biến môi trường có newline/khoảng trắng thừa trên Linux
const PIN = (process.env.PIN ?? "0801").trim();
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Biến lưu trữ lịch sử Clipboard chung (giới hạn 50 mục, lưu trên RAM)
let clipboardHistory = [];
// Tạo thư mục uploads nếu chưa tồn tại
await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });

// ─── AUTO-FIX MOJIBAKE FILENAMES ──────────────────────────────────────────────
// Khi server khởi động, tự đổi tên file bị mojibake thành tên UTF-8 đúng
async function autoFixMojibakeNames(dir) {
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await autoFixMojibakeNames(fullPath); // Recursive
        continue;
      }
      // Thử fix tên file
      try {
        const bytes = Buffer.from(entry.name, 'latin1');
        const decoded = bytes.toString('utf8');
        if (Buffer.from(decoded, 'utf8').equals(bytes) && decoded !== entry.name) {
          const newPath = path.join(dir, decoded);
          if (!fs.existsSync(newPath)) {
            await fsPromises.rename(fullPath, newPath);
            console.log(`🔧 Renamed: "${entry.name}" → "${decoded}"`);
          }
        }
      } catch { }
    }
  } catch { }
}
await autoFixMojibakeNames(UPLOAD_DIR);

const app = express();

// Nhận đúng IP thật của client nếu LAN Share chạy sau reverse proxy (Nginx, Cloudflare...)
// Điều này giúp rate limit hoạt động đúng trên từng IP thay vì block toàn bộ IP của proxy.
app.set('trust proxy', true);

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────

// Gzip/Brotli nén tất cả response text (JSON, HTML, CSS, JS)
// Bỏ qua /download/ để tránh làm hỏng binary content (PDF, ảnh, ZIP...)
app.use(compression({
  level: 6,
  filter: (req, res) => {
    if (req.path.startsWith('/download/')) return false;
    return compression.filter(req, res);
  }
}));

// Parse JSON body (tăng limit để tránh 413 khi gửi metadata lớn)
app.use(express.json({ limit: "10gb" }));
app.use(express.urlencoded({ extended: true, limit: "10gb" }));

// Phục vụ file tĩnh với cache 1 ngày cho assets (HTML luôn revalidate)
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1d",
    etag: true,
    lastModified: true,
    extensions: ['html'],
    setHeaders(res, filePath) {
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

// Serve trang Nén PDF trước khi qua PIN middleware
app.get('/compress-pdf', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compress-pdf.html'));
});

// ─── PIN MIDDLEWARE ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!PIN) return next();
  // Cho phép trang index load không cần PIN để hiện UI nhập PIN
  // Route /download/ và /api/clipboard có middleware/check riêng biệt không bị ảnh hưởng tại đây
  if (req.method === "GET" && (
    req.path === "/" ||
    req.path.startsWith("/index") ||
    req.path.startsWith("/compress-pdf") ||
    req.path.startsWith("/download/") ||
    req.path.startsWith("/api/clipboard")
  ))
    return next();

  if (req.method === "POST" && req.path.startsWith("/api/clipboard")) {
    return next();
  }
  if (req.method === "DELETE" && req.path.startsWith("/api/clipboard")) {
    return next();
  }

  const pin = req.headers["x-pin"] || req.query.pin;
  if (pin !== PIN)
    return res.status(401).json({ ok: false, error: "Unauthorized (PIN)" });
  next();
});

// --- RATE LIMITING (REMOVED) ---
// Do chạy trong mạng nội bộ, upload không giới hạn.

// ─── MULTER STORAGE ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = req.query.dir || '';
    const dest = safeDirPath(dir);
    if (!dest) return cb(new Error('Invalid directory'));
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const dest = safeDirPath(req.query.dir || '') || UPLOAD_DIR;
    // Fix multer mojibake: decode tên file từ Latin-1 → UTF-8
    const fixedName = tryFixMojibake(file.originalname);
    const safe = fixedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const target = path.join(dest, safe);
    if (!fs.existsSync(target)) return cb(null, safe);

    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    let i = 1;
    while (fs.existsSync(path.join(dest, `${base} (${i})${ext}`))) i++;
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

// Giải quyết dir param an toàn — trả về absolute path trong UPLOAD_DIR
function safeDirPath(dir) {
  if (!dir) return UPLOAD_DIR;
  // Loại bỏ các ký tự nguy hiểm
  const cleaned = dir.replace(/\.\./g, '').replace(/^[\/\\]+/, '');
  const resolved = path.resolve(UPLOAD_DIR, cleaned);
  if (!resolved.toLowerCase().startsWith(path.normalize(UPLOAD_DIR).toLowerCase())) return null;
  return resolved;
}

// Tính tổng dung lượng thư mục (recursive, có giới hạn depth)
async function calcFolderMeta(dirPath, maxDepth = 3, depth = 0) {
  let totalSize = 0;
  let fileCount = 0;
  let folderCount = 0;
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        folderCount++;
        if (depth < maxDepth) {
          const sub = await calcFolderMeta(fullPath, maxDepth, depth + 1);
          totalSize += sub.totalSize;
          fileCount += sub.fileCount;
          folderCount += sub.folderCount;
        }
      } else {
        try {
          const st = await fsPromises.stat(fullPath);
          totalSize += st.size;
          fileCount++;
        } catch { }
      }
    }
  } catch { }
  return { totalSize, fileCount, folderCount };
}

async function getFilesWithEtag(dir = '') {
  const targetDir = safeDirPath(dir);
  if (!targetDir) throw new Error('Invalid directory');

  // Tạo thư mục nếu chưa tồn tại
  await fsPromises.mkdir(targetDir, { recursive: true });

  const entries = await fsPromises.readdir(targetDir, { withFileTypes: true });

  const folders = [];
  const fileEntries = [];

  for (const entry of entries) {
    if (entry.name === '__pdf_tmp__') continue;
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      // Đếm số item và tính dung lượng thư mục
      try {
        const children = await fsPromises.readdir(fullPath, { withFileTypes: true });
        const directFiles = children.filter(c => !c.isDirectory()).length;
        const directFolders = children.filter(c => c.isDirectory()).length;
        const meta = await calcFolderMeta(fullPath);
        folders.push({
          name: entry.name,
          itemCount: children.length,
          fileCount: directFiles,
          folderCount: directFolders,
          totalSize: meta.totalSize,
          totalFiles: meta.fileCount,
          totalFolders: meta.folderCount
        });
      } catch {
        folders.push({ name: entry.name, itemCount: 0, fileCount: 0, folderCount: 0, totalSize: 0, totalFiles: 0, totalFolders: 0 });
      }
    } else {
      const st = await fsPromises.stat(fullPath);
      const name = tryFixMojibake(entry.name);
      fileEntries.push({ name, _rawName: entry.name, size: st.size, mtime: st.mtimeMs });
    }
  }

  // Sort: folders theo tên, files theo mtime mới nhất
  folders.sort((a, b) => a.name.localeCompare(b.name));
  fileEntries.sort((a, b) => b.mtime - a.mtime);

  const raw = [...folders.map(f => `d:${f.name}:${f.itemCount}:${f.totalSize}`), ...fileEntries.map(f => `${f._rawName}:${f.mtime}`)].join('|');
  const etag = `"${crypto.createHash("md5").update(raw).digest("hex").slice(0, 16)}"`;

  return {
    folders,
    files: fileEntries.map(({ _rawName, ...rest }, i) => ({ ...rest, index: i + 1 })),
    etag
  };
}

app.get("/api/files", async (req, res) => {
  try {
    const dir = req.query.dir || '';
    const { folders, files, etag } = await getFilesWithEtag(dir);

    // Conditional GET — 304 Not Modified nếu client đã có bản này
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache");
    res.json({ ok: true, folders, files, dir });
  } catch (e) {
    console.error("GET /api/files error:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// ─── FOLDER API ───────────────────────────────────────────────────────────────

// Tạo thư mục mới
app.post("/api/folders", async (req, res) => {
  try {
    const { name, dir } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Tên thư mục không hợp lệ' });
    }

    const safeName = name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const parentDir = safeDirPath(dir || '');
    if (!parentDir) return res.status(400).json({ ok: false, error: 'Đường dẫn không hợp lệ' });

    const newPath = path.join(parentDir, safeName);
    if (!newPath.toLowerCase().startsWith(path.normalize(UPLOAD_DIR).toLowerCase())) {
      return res.status(400).json({ ok: false, error: 'Đường dẫn không hợp lệ' });
    }

    if (fs.existsSync(newPath)) {
      return res.status(409).json({ ok: false, error: 'Thư mục đã tồn tại' });
    }

    await fsPromises.mkdir(newPath, { recursive: true });
    res.json({ ok: true, name: safeName });
    sseSend('changed', { type: 'folder-create', name: safeName, dir: dir || '', at: Date.now() });
  } catch (e) {
    console.error('POST /api/folders error:', e);
    res.status(500).json({ ok: false, error: 'Lỗi tạo thư mục' });
  }
});

// Xóa thư mục (recursive)
app.delete("/api/folders", async (req, res) => {
  try {
    const dir = req.query.dir || '';
    if (!dir) return res.status(400).json({ ok: false, error: 'Thiếu đường dẫn thư mục' });

    const targetPath = safeDirPath(dir);
    if (!targetPath || targetPath === path.normalize(UPLOAD_DIR)) {
      return res.status(400).json({ ok: false, error: 'Không thể xóa thư mục gốc' });
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ ok: false, error: 'Thư mục không tồn tại' });
    }

    await fsPromises.rm(targetPath, { recursive: true, force: true });
    res.json({ ok: true });
    sseSend('changed', { type: 'folder-delete', dir, at: Date.now() });
  } catch (e) {
    console.error('DELETE /api/folders error:', e);
    res.status(500).json({ ok: false, error: 'Lỗi xóa thư mục' });
  }
});

// ─── CLIPBOARD API ────────────────────────────────────────────────────────────

// Trả về lịch sử clipbord
app.get("/api/clipboard", (req, res) => {
  if (PIN) {
    const pin = req.headers["x-pin"] || req.query.pin;
    if (pin !== PIN) return res.status(401).json({ ok: false, error: "Unauthorized (PIN)" });
  }
  res.json({ ok: true, history: clipboardHistory });
});

// Thêm văn bản mới vào lịch sử
app.post("/api/clipboard", (req, res) => {
  if (PIN) {
    const pin = req.headers["x-pin"] || req.query.pin;
    if (pin !== PIN) return res.status(401).json({ ok: false, error: "Unauthorized (PIN)" });
  }

  const newText = req.body?.text || "";
  if (typeof newText !== "string" || !newText.trim()) {
    return res.status(400).json({ ok: false, error: "Invalid or empty text" });
  }

  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
    text: newText,
    timestamp: Date.now()
  };

  // Thêm vào đầu mảng và giới hạn 50 mục
  clipboardHistory.unshift(newItem);
  if (clipboardHistory.length > 50) {
    clipboardHistory.pop();
  }

  res.json({ ok: true, item: newItem });

  // Phát tín hiệu SSE cho tất cả client
  sseSend("clipboard", { history: clipboardHistory, at: Date.now() });
});

// Lệnh xóa một mục trong lịch sử clipboard
app.delete("/api/clipboard/:id", (req, res) => {
  if (PIN) {
    const pin = req.headers["x-pin"] || req.query.pin;
    if (pin !== PIN) return res.status(401).json({ ok: false, error: "Unauthorized (PIN)" });
  }

  const id = req.params.id;
  const initialLength = clipboardHistory.length;
  clipboardHistory = clipboardHistory.filter(item => item.id !== id);

  if (clipboardHistory.length < initialLength) {
    res.json({ ok: true });
    // Phát tín hiệu update
    sseSend("clipboard", { history: clipboardHistory, at: Date.now() });
  } else {
    res.status(404).json({ ok: false, error: "Item not found" });
  }
});

// Multer động: dựa vào query param dir để chọn thư mục đích
const dynamicUpload = (req, res, next) => {
  const dir = req.query.dir || '';
  const targetDir = safeDirPath(dir);
  if (!targetDir) return res.status(400).json({ ok: false, error: 'Đường dẫn không hợp lệ' });

  // Tạo thư mục nếu chưa có
  fs.mkdirSync(targetDir, { recursive: true });

  const dynamicStorage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, targetDir),
    filename: (_, file, cb) => {
      // Fix multer mojibake: decode tên file từ Latin-1 → UTF-8
      const fixedName = tryFixMojibake(file.originalname);
      const safe = fixedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      const target = path.join(targetDir, safe);
      if (!fs.existsSync(target)) return cb(null, safe);
      const ext = path.extname(safe);
      const base = path.basename(safe, ext);
      let i = 1;
      while (fs.existsSync(path.join(targetDir, `${base} (${i})${ext}`))) i++;
      cb(null, `${base} (${i})${ext}`);
    }
  });

  multer({ storage: dynamicStorage, limits: { fileSize: 1024 * 1024 * 1024 } })
    .array('files')(req, res, next);
};

app.post("/api/upload", dynamicUpload, async (req, res) => {
  try {
    const uploaded = (req.files ?? []).map((f) => f.filename);
    const dir = req.query.dir || '';
    res.json({ ok: true, uploaded });
    if (dir !== '__pdf_tmp__') {
      sseSend("changed", { type: "upload", uploaded, dir, at: Date.now() });
    }
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
  const name = decodeURIComponent(req.params.name);
  const dir = req.query.dir || '';
  const baseDir = safeDirPath(dir) || UPLOAD_DIR;
  const p = path.resolve(baseDir, name);

  // Kiểm tra path an toàn
  if (!p.toLowerCase().startsWith(path.normalize(UPLOAD_DIR).toLowerCase())) {
    return res.status(400).send("Bad Request");
  }

  // Thử tìm file: trước tiên bằng tên gốc, sau đó bằng tên đã fix mojibake
  let filePath = p;
  if (!fs.existsSync(p)) {
    try {
      const allFiles = fs.readdirSync(baseDir);
      const match = allFiles.find(f => tryFixMojibake(f) === name || f === name);
      if (!match) return res.status(404).send("Not found");
      filePath = path.join(baseDir, match);
    } catch {
      return res.status(404).send("Not found");
    }
  }

  // ── Tên hiển thị: ưu tiên ?dl=..., fallback về tên từ URL ──
  const displayName = req.query.dl || name;

  // ── Content-Disposition ──
  // RFC 5987: filename*=UTF-8''... cho trình duyệt hiện đại (hỗ trợ tiếng Việt)
  // filename="..." cho trình duyệt cũ (ASCII-only, thay ký tự đặc biệt bằng _)
  const isPreview = req.query.preview === '1';
  const disposition = isPreview ? 'inline' : 'attachment';
  const asciiName = displayName.replace(/[^\x20-\x7E]/g, '_'); // Fallback ASCII-safe
  const utf8Name = encodeURIComponent(displayName).replace(/'/g, '%27');
  res.setHeader("Content-Disposition",
    `${disposition}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`
  );

  // ── Headers ──
  res.setHeader("Cache-Control", "no-transform");
  // Không set Content-Type thủ công — Express/sendFile tự detect từ extension chính xác hơn

  res.sendFile(filePath, { dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.status(500).end();
    if (!err && req.query.dir === '__pdf_tmp__') {
      try { fs.unlink(filePath, () => { }); } catch { }
    }
  });
});

app.delete("/api/files/:name", async (req, res) => {
  const name = req.params.name;
  const dir = req.query.dir || '';
  const baseDir = safeDirPath(dir) || UPLOAD_DIR;
  const p = path.resolve(baseDir, name);

  if (!p.toLowerCase().startsWith(path.normalize(UPLOAD_DIR).toLowerCase())) {
    return res.status(400).json({ ok: false, error: "Bad Request" });
  }

  // Tìm file thực tế trên disk (kể cả tên mojibake)
  let filePath = p;
  if (!fs.existsSync(p)) {
    try {
      const allFiles = fs.readdirSync(baseDir);
      const match = allFiles.find(f => tryFixMojibake(f) === name || f === name);
      if (!match) return res.status(404).json({ ok: false, error: "Not found" });
      filePath = path.join(baseDir, match);
    } catch {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
  }

  try {
    await fsPromises.unlink(filePath);
    res.json({ ok: true });
    sseSend("changed", { type: "delete", name, dir, at: Date.now() });
  } catch (e) {
    if (e.code === "ENOENT") return res.status(404).json({ ok: false, error: "Not found" });
    console.error("DELETE error:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// ─── PDF COMPRESS API ─────────────────────────────────────────────────────────

// Tìm đường dẫn Ghostscript: thử nhiều vị trí tiêu chuẩn trên Windows/Linux
function findGhostscript() {
  const candidates = [
    'gswin64c', 'gswin32c', 'gs',
    'C:\\Program Files\\gs\\gs10.05.0\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.04.0\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.02.1\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.05.0\\bin\\gswin32c.exe',
  ];
  // Thử tìm thêm trong thư mục Program Files\gs\
  try {
    const gsRoot = 'C:\\Program Files\\gs';
    if (fs.existsSync(gsRoot)) {
      const versions = fs.readdirSync(gsRoot).sort().reverse();
      for (const v of versions) {
        const p = path.join(gsRoot, v, 'bin', 'gswin64c.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { }
  return candidates[0]; // Fallback to PATH lookup
}

const GS_BIN = findGhostscript();

// Mức chất lượng nén PDF:  screen < ebook < printer < prepress
const COMPRESS_PRESETS = {
  low: { dPDFSETTINGS: '/ebook', label: 'Cân bằng' },   // ~150dpi ảnh
  medium: { dPDFSETTINGS: '/screen', label: 'Nén mạnh' },   // ~72dpi ảnh, nhỏ nhất
  high: { dPDFSETTINGS: '/printer', label: 'Chất lượng' }, // ~300dpi, ít nén hơn
};

app.post('/api/compress-pdf', async (req, res) => {
  const name = req.query.name;
  const dir = req.query.dir || '';
  const preset = req.query.preset || 'low'; // low | medium | high

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'Tên file không hợp lệ' });
  }

  // Giải mã và định vị file
  const decodedName = decodeURIComponent(name);
  const baseDir = safeDirPath(dir) || UPLOAD_DIR;
  const inputPath = path.resolve(baseDir, decodedName);

  if (!inputPath.toLowerCase().startsWith(path.normalize(UPLOAD_DIR).toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'Đường dẫn không hợp lệ' });
  }
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ ok: false, error: 'Không tìm thấy file' });
  }
  if (!decodedName.toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ ok: false, error: 'Chỉ hỗ trợ file PDF' });
  }

  const cfg = COMPRESS_PRESETS[preset] || COMPRESS_PRESETS.low;
  const ext = path.extname(decodedName);
  const base = path.basename(decodedName, ext);
  const outName = `${base}_compressed${ext}`;
  const outputPath = path.join(baseDir, outName);

  // Ghostscript trên Windows: dùng forward slash tránh lỗi escape
  const gsOutput = outputPath.split(path.sep).join('/');
  const gsInput = inputPath.split(path.sep).join('/');


  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    `-dPDFSETTINGS=${cfg.dPDFSETTINGS}`,
    '-dNOPAUSE',
    '-dBATCH',
    `-sOutputFile=${gsOutput}`,
    gsInput,
  ];

  console.log('[GS] cmd:', GS_BIN);
  console.log('[GS] args:', args);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(GS_BIN, args, { stdio: 'pipe' });
      let stderr = '';
      let done = false;
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', (err) => {
        if (done) return; done = true;
        if (err.code === 'ENOENT' || err.code === 'EACCES') {
          reject(new Error('GS_NOT_FOUND'));
        } else {
          reject(err);
        }
      });
      proc.on('close', code => {
        if (done) return; done = true;
        if (code === 0) resolve();
        else {
          // Nếu stderr chứa lỗi tìm file → Ghostscript chưa cài
          const errOut = stderr.toLowerCase();
          if (errOut.includes('not found') || errOut.includes('cannot find') || errOut.includes('no such file')) {
            reject(new Error('GS_NOT_FOUND'));
          } else {
            reject(new Error(`gs_exit_${code}: ${stderr.slice(0, 300)}`));
          }
        }
      });
    });

    const originalSize = (await fsPromises.stat(inputPath)).size;
    const compressedSize = (await fsPromises.stat(outputPath)).size;
    const savedPercent = Math.round((1 - compressedSize / originalSize) * 100);

    res.json({
      ok: true,
      outName,
      originalSize,
      compressedSize,
      savedPercent,
      preset: cfg.label,
    });

    if (dir !== '__pdf_tmp__') {
      sseSend('changed', { type: 'upload', uploaded: [outName], dir: dir || '', at: Date.now() });
    }

    try {
      if (fs.existsSync(inputPath)) await fsPromises.unlink(inputPath);
    } catch { }

  } catch (e) {
    if (e.message === 'GS_NOT_FOUND') {
      return res.status(503).json({
        ok: false,
        error: 'Ghostscript chưa được cài đặt. Vui lòng cài tại: https://www.ghostscript.com/releases/gsdnld.html'
      });
    }
    console.error('PDF compress error:', e);
    // Dọn dẹp file output lỗi nếu có
    try { if (fs.existsSync(outputPath)) await fsPromises.unlink(outputPath); } catch { }
    res.status(500).json({ ok: false, error: 'Nén thất bại, vui lòng thử lại' });
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
