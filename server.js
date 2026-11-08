// Mahalla serveri. Ishga tushirish: node server.js
// Ma'lumot saqlash: UPSTASH_URL + UPSTASH_TOKEN bo'lsa Upstash Redis (bepul), bo'lmasa data.json fayli.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const E = process.env, PORT = E.PORT || 3000, CAP = 784;
const CARD = E.CARD_INFO || "", OWNER = E.OWNER_USERNAME || "_lutsius";
// Narx: 1..FREE-qavat har biri P0 so'm, keyin har qavat STEP so'mga qimmatlashadi (50 qavat jami ~296 500)
const CFG = { p0: +E.P0 || 5000, free: +E.FREE || 20, step: +E.STEP || 100, max: +E.MAX || 50 };
const price = f => f <= CFG.free ? CFG.p0 : CFG.p0 + CFG.step * (f - CFG.free);
const cost = (a, b) => { let t = 0; for (let f = a + 1; f <= b; f++) t += price(f); return t; };
const U = E.UPSTASH_URL, UT = E.UPSTASH_TOKEN, FILE = path.join(E.DATA_DIR || __dirname, "data.json");
const REGIONS = ["Toshkent","Samarqand","Buxoro","Farg‘ona","Andijon","Namangan","Qashqadaryo","Surxondaryo","Xorazm","Navoiy","Jizzax","Sirdaryo","Qoraqalpog‘iston"];
let D = { users: {} };
async function redis(cmd) {
  const r = await fetch(U, { method: "POST", headers: { Authorization: "Bearer " + UT, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
}
async function load() {
  if (U) { const a = (await redis(["HGETALL", "users"])) || []; for (let i = 0; i < a.length; i += 2) { try { const u = JSON.parse(a[i + 1]); D.users[u.id] = u; } catch (e) {} } }
  else { try { D = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {} }
}
function persist(u) { if (U) redis(["HSET", "users", u.id, JSON.stringify(u)]).catch(e => console.log("redis:", e.message)); else fs.writeFileSync(FILE, JSON.stringify(D)); }
const CL = new Map(); // Instagram tugmasi bosilgan qurilmalar
async function clicked(d) {
  if (!/^[a-f0-9]{16,32}$/.test(d)) return false;
  if (CL.has(d) && Date.now() - CL.get(d) < 864e5) return true;
  if (U) { try { return (await redis(["GET", "c:" + d])) === "1"; } catch (e) {} }
  return false;
}
function unpersist(x) { delete D.users[x.id]; if (U) redis(["HDEL", "users", x.id]).catch(e => console.log("redis:", e.message)); else fs.writeFileSync(FILE, JSON.stringify(D)); }
const rsv = s => { const c = s % 28, r = Math.floor(s / 28); return c >= 12 && c <= 15 && r >= 12 && r <= 15; };
const json = (res, c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
const byToken = t => t ? Object.values(D.users).find(u => u.token === t) : null;
const isAdmin = k => !!E.ADMIN_KEY && k === E.ADMIN_KEY;
const hits = {};
function state(t) {
  const all = Object.values(D.users), cnt = {}; REGIONS.forEach(r => cnt[r] = 0); all.forEach(u => cnt[u.r]++);
  const me = byToken(t);
  return { houses: all.map(u => ({ u: u.u, r: u.r, s: u.s, t: u.floors || 0 })), regions: REGIONS.map(r => ({ r, n: cnt[r] })).sort((a, b) => b.n - a.n),
    me: me ? { u: me.u, r: me.r, floors: me.floors || 0, pending: me.pending || null } : null, cfg: Object.assign({ card: CARD, owner: OWNER }, CFG) };
}
function readBody(req, cb) { let raw = ""; req.on("data", c => { raw += c; if (raw.length > 2000) req.destroy(); }); req.on("end", () => { let b = {}; try { b = JSON.parse(raw); } catch (e) {} cb(b); }); }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
  if (u.pathname === "/api/state") return json(res, 200, state(u.searchParams.get("t")));
  if (u.pathname === "/go") {
    const d = u.searchParams.get("d") || "";
    if (/^[a-f0-9]{16,32}$/.test(d)) { if (CL.size > 20000) CL.clear(); CL.set(d, Date.now()); if (U) redis(["SET", "c:" + d, "1", "EX", "86400"]).catch(() => {}); }
    res.writeHead(302, { Location: "https://instagram.com/" + OWNER }); return res.end();
  }
  if (u.pathname === "/api/join" && req.method === "POST") return readBody(req, async b => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0], t = Date.now();
    hits[ip] = (hits[ip] || []).filter(x => t - x < 3600000);
    if (hits[ip].length >= 10) return json(res, 429, { error: "Ko‘p urinish, keyinroq qayta urinib ko‘ring" });
    hits[ip].push(t);
    const name = String(b.username || "").replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9._]{1,30}$/.test(name)) return json(res, 400, { error: "Username noto‘g‘ri" });
    if (!REGIONS.includes(b.region)) return json(res, 400, { error: "Viloyatni tanlang" });
    const mine = byToken(b.t);
    if (mine) return json(res, 200, Object.assign({ token: mine.token }, state(mine.token)));
    if (!(await clicked(String(b.d || "")))) return json(res, 403, { error: "Avval Instagram tugmasini bosib obuna bo‘ling 🙂", nofollow: true });
    if (Object.values(D.users).some(x => x.u.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: "Bu username band" });
    const used = new Set(Object.values(D.users).filter(x => x.r === b.region).map(x => x.s));
    for (let c = 12; c <= 15; c++) for (let r2 = 12; r2 <= 15; r2++) used.add(c + r2 * 28); // markaziy maydon
    let s = 0; while (used.has(s)) s++;
    if (s >= CAP) return json(res, 409, { error: "Bu viloyat to‘lgan" });
    const id = crypto.randomBytes(8).toString("hex"), token = crypto.randomBytes(16).toString("hex");
    D.users[id] = { id, token, u: name, r: b.region, s, t }; persist(D.users[id]);
    json(res, 200, Object.assign({ token }, state(token)));
  });
  if (u.pathname === "/api/upgrade" && req.method === "POST") return readBody(req, b => {
    const me = byToken(b.t), to = +b.to;
    if (!me) return json(res, 403, { error: "Avval uy oling" });
    const cur = me.floors || 0;
    if (!Number.isInteger(to) || to <= cur || to > CFG.max) return json(res, 400, { error: "Noto‘g‘ri qavat soni" });
    me.pending = { to, cost: cost(cur, to) }; persist(me); json(res, 200, state(b.t));
  });
  if (u.pathname === "/api/admin") {
    if (!isAdmin(u.searchParams.get("key"))) return json(res, 403, {});
    return json(res, 200, { list: Object.values(D.users).filter(x => x.pending).map(x => ({ u: x.u, to: x.pending.to, cost: x.pending.cost })) });
  }
  if (u.pathname === "/api/decide" && req.method === "POST") return readBody(req, b => {
    if (!isAdmin(b.key)) return json(res, 403, {});
    const x = Object.values(D.users).find(y => y.u === b.u);
    if (x && x.pending) { if (b.approve) x.floors = Math.max(x.floors || 0, x.pending.to); x.pending = null; persist(x); }
    json(res, 200, { ok: true });
  });
  if (u.pathname === "/api/admin/find") {
    if (!isAdmin(u.searchParams.get("key"))) return json(res, 403, {});
    const q = (u.searchParams.get("q") || "").toLowerCase();
    return json(res, 200, { list: Object.values(D.users).filter(x => !q || x.u.toLowerCase().includes(q)).slice(0, 20).map(x => ({ u: x.u, r: x.r, row: Math.floor(x.s / 28) + 1, col: x.s % 28 + 1, floors: x.floors || 0 })) });
  }
  if (u.pathname.startsWith("/api/admin/") && req.method === "POST") return readBody(req, b => {
    if (!isAdmin(b.key)) return json(res, 403, {});
    const A = Object.values(D.users).find(x => x.u === b.u);
    if (!A) return json(res, 404, { error: "Topilmadi" });
    const act = u.pathname.slice(11);
    if (act === "remove") { unpersist(A); return json(res, 200, { ok: true }); }
    if (act === "floors") { const f = +b.floors; if (!Number.isInteger(f) || f < 0 || f > CFG.max) return json(res, 400, { error: "0–" + CFG.max }); A.floors = f; A.pending = null; persist(A); return json(res, 200, { ok: true }); }
    if (act === "move") {
      const row = +b.row, col = +b.col;
      if (!REGIONS.includes(b.region) || !Number.isInteger(row) || !Number.isInteger(col) || row < 1 || row > 28 || col < 1 || col > 28) return json(res, 400, { error: "Noto‘g‘ri joy" });
      const s2 = (row - 1) * 28 + col - 1;
      if (rsv(s2)) return json(res, 400, { error: "Bu joy markaziy maydon" });
      const B = Object.values(D.users).find(x => x !== A && x.r === b.region && x.s === s2);
      if (B) { B.r = A.r; B.s = A.s; persist(B); }
      A.r = b.region; A.s = s2; persist(A); return json(res, 200, { ok: true, swapped: B ? B.u : null });
    }
    json(res, 404, {});
  });
  if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(path.join(__dirname, "index.html"))); }
  res.writeHead(404); res.end();
});
load().then(() => server.listen(PORT, () => console.log("Ishlayapti: port " + PORT)), e => { console.error("Baza bilan xato:", e.message); process.exit(1); });
