"use strict";

/*
 * 风页共享书架服务
 * 零依赖 Node 服务，可部署到 Render / Railway / VPS。
 * 环境变量：
 *   PORT=8787
 *   DATA_DIR=./data
 *   LIBRARY_CODE=朋友加入用的共享码
 *   ADMIN_CODE=推送书籍用的管理码
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const LIBRARY_CODE = process.env.LIBRARY_CODE || "FENGYE-" + crypto.randomBytes(3).toString("hex").toUpperCase();
const ADMIN_CODE = process.env.ADMIN_CODE || crypto.randomBytes(6).toString("hex").toUpperCase();
const MAX_BODY = 60 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "books"), { recursive: true });

let state = {
  seq: 0,
  devices: {},
  books: {},
  messages: []
};

loadState();

function dataPath(name) { return path.join(DATA_DIR, name); }

function loadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function saveJson(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, file);
}

function loadState() {
  state.seq = Number(loadJson(dataPath("seq.json"), { seq: 0 }).seq) || 0;
  state.devices = loadJson(dataPath("devices.json"), {});
  state.books = loadJson(dataPath("books.json"), {});
  state.messages = loadJson(dataPath("messages.json"), []);
  if (!Array.isArray(state.messages)) state.messages = [];
}

function saveAll() {
  saveJson(dataPath("seq.json"), { seq: state.seq });
  saveJson(dataPath("devices.json"), state.devices);
  saveJson(dataPath("books.json"), state.books);
  saveJson(dataPath("messages.json"), state.messages);
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Code",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function text(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("请求体超过 60MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
}

function isAdmin(req) {
  return String(req.headers["x-admin-code"] || "") === ADMIN_CODE;
}

function deviceByToken(token) {
  if (!token) return null;
  return Object.values(state.devices).find((d) => d.token === token) || null;
}

function bookMeta(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    chars: book.chars,
    chapterCount: book.chapterCount,
    size: book.size,
    createdAt: book.createdAt,
    sender: book.sender || ""
  };
}

function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
}

const joinAttempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (joinAttempts.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (list.length >= 12) return true;
  list.push(now);
  joinAttempts.set(ip, list);
  return false;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Code",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && u.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        service: "fengye-share",
        time: new Date().toISOString(),
        devices: Object.keys(state.devices).length,
        books: Object.keys(state.books).length,
        seq: state.seq
      });
      return;
    }

    if (req.method === "POST" && u.pathname === "/api/join") {
      const ip = req.socket.remoteAddress || "unknown";
      if (rateLimited(ip)) { json(res, 429, { error: "尝试太频繁，请一分钟后再试" }); return; }
      const body = await readBody(req);
      if (String(body.code || "").trim() !== LIBRARY_CODE) {
        json(res, 403, { error: "共享码不正确" });
        return;
      }
      const name = String(body.name || "未命名设备").slice(0, 40);
      const id = newId("dev");
      const token = crypto.randomBytes(24).toString("hex");
      state.devices[id] = { id, name, token, createdAt: Date.now(), lastSeen: Date.now() };
      saveAll();
      json(res, 200, {
        token,
        device: { id, name },
        latestSeq: state.seq,
        service: "fengye-share"
      });
      return;
    }

    if (req.method === "GET" && u.pathname === "/api/poll") {
      const dev = deviceByToken(bearer(req));
      if (!dev) { json(res, 401, { error: "设备未配对" }); return; }
      dev.lastSeen = Date.now();
      const since = Math.max(0, parseInt(u.searchParams.get("since") || "0", 10) || 0);
      const msgs = state.messages
        .filter((m) => m.deviceId === dev.id && m.seq > since)
        .slice(0, 20)
        .map((m) => ({
          seq: m.seq,
          book: state.books[m.bookId] ? bookMeta(state.books[m.bookId]) : null
        }))
        .filter((m) => m.book);
      saveAll();
      json(res, 200, {
        messages: msgs,
        cursor: msgs.length ? msgs[msgs.length - 1].seq : state.seq
      });
      return;
    }

    if (req.method === "GET" && u.pathname.startsWith("/api/books/")) {
      const id = decodeURIComponent(u.pathname.slice("/api/books/".length));
      const dev = deviceByToken(bearer(req));
      if (!dev && !isAdmin(req)) { json(res, 401, { error: "没有权限" }); return; }
      const meta = state.books[id];
      if (!meta) { json(res, 404, { error: "书不存在" }); return; }
      const full = loadJson(path.join(DATA_DIR, "books", id + ".json"), null);
      if (!full) { json(res, 404, { error: "书文件不存在" }); return; }
      json(res, 200, { meta: full.meta, chapters: full.chapters });
      return;
    }

    if (req.method === "GET" && u.pathname === "/api/devices") {
      if (!isAdmin(req)) { json(res, 403, { error: "管理码不正确" }); return; }
      const list = Object.values(state.devices)
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
          lastSeen: d.lastSeen,
          online: Date.now() - d.lastSeen < 60 * 1000
        }));
      json(res, 200, { devices: list });
      return;
    }

    if (req.method === "POST" && u.pathname === "/api/push") {
      if (!isAdmin(req)) { json(res, 403, { error: "管理码不正确" }); return; }
      const body = await readBody(req);
      const meta = body.meta;
      const chapters = body.chapters;
      const targets = Array.isArray(body.targets) ? body.targets : [];
      if (!meta || !Array.isArray(chapters) || !chapters.length) {
        json(res, 400, { error: "缺少书的正文" });
        return;
      }
      if (JSON.stringify(chapters).length > MAX_BODY) {
        json(res, 413, { error: "书太大" });
        return;
      }
      const validTargets = targets.filter((id) => state.devices[id]);
      if (!validTargets.length) { json(res, 400, { error: "没有选择接收设备" }); return; }

      const id = newId("book");
      const bookMetaObj = {
        id,
        title: String(meta.title || "未命名").slice(0, 120),
        author: String(meta.author || "").slice(0, 60),
        format: String(meta.format || "TXT").slice(0, 12),
        chars: Number(meta.chars) || 0,
        chapterCount: chapters.length,
        size: JSON.stringify(chapters).length,
        createdAt: Date.now(),
        sender: String(body.sender || "").slice(0, 40)
      };
      saveJson(path.join(DATA_DIR, "books", id + ".json"), { meta: meta, chapters: chapters });
      state.books[id] = bookMetaObj;

      const delivered = [];
      validTargets.forEach((deviceId) => {
        state.seq++;
        state.messages.push({
          seq: state.seq,
          deviceId,
          bookId: id,
          createdAt: Date.now()
        });
        delivered.push(deviceId);
      });
      if (state.messages.length > 5000) state.messages = state.messages.slice(-4000);
      saveAll();
      json(res, 200, { ok: true, id, delivered, seq: state.seq });
      return;
    }

    if (req.method === "DELETE" && u.pathname.startsWith("/api/books/")) {
      if (!isAdmin(req)) { json(res, 403, { error: "管理码不正确" }); return; }
      const id = decodeURIComponent(u.pathname.slice("/api/books/".length));
      if (!state.books[id]) { json(res, 404, { error: "书不存在" }); return; }
      delete state.books[id];
      try { fs.unlinkSync(path.join(DATA_DIR, "books", id + ".json")); } catch (e) { /* ignore */ }
      state.messages = state.messages.filter((m) => m.bookId !== id);
      saveAll();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/admin")) {
      text(res, 200, `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>风页共享书架</title>
<style>body{font-family:-apple-system,'Microsoft YaHei',sans-serif;max-width:720px;margin:60px auto;padding:0 20px;line-height:1.9;color:#2b2925;background:#f4eee2}h1{font-family:serif;letter-spacing:.08em}code{background:#eae2d3;padding:2px 6px;border-radius:4px}.ok{color:#3d6486}</style>
<h1>风页 · 共享书架</h1>
<p class="ok">服务正在运行。</p>
<p>设备数：<b>${Object.keys(state.devices).length}</b> · 书籍数：<b>${Object.keys(state.books).length}</b></p>
<h3>在 App 里填写</h3>
<p>服务器地址：<code>${req.headers.host ? "https://" + req.headers.host : "https://你的域名"}</code></p>
<p>共享码和管理码在部署平台的 Environment Variables 里设置，不要写在公开页面。</p>
<p>接口：<code>/api/health</code> · <code>/api/join</code> · <code>/api/poll</code> · <code>/api/devices</code> · <code>/api/push</code></p>
<p style="color:#928a7b;font-size:12px">书籍保存在服务器的 DATA_DIR，请给 Render/Railway 挂持久磁盘，避免重启丢失。</p>
</html>`, "text/html; charset=utf-8");
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e && e.message ? e.message : "服务器错误" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("fengye-share listening on", PORT);
  console.log("DATA_DIR:", DATA_DIR);
  console.log("LIBRARY_CODE:", LIBRARY_CODE);
  console.log("ADMIN_CODE:", ADMIN_CODE);
});
