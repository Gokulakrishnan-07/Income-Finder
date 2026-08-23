const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const COOKIE = "scrap_ledger_session";
const STORE_NAME = "income-tracker-records";
const LEGACY_CATEGORIES = { pithalai: "metal", chembu: "metal", aluminium: "metal" };
const VALID_CATEGORIES = new Set(["kottangushi", "puliyankottai", "irumbu_plastic", "metal"]);

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

function cookieValue(headers = {}) {
  const raw = headers.cookie || headers.Cookie || "";
  return raw.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

function validSession(event) {
  if (!process.env.SESSION_SECRET) return null;
  const token = cookieValue(event.headers);
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Date.now() && session.sub ? session : null;
  } catch (_) { return null; }
}

function storeFor(user) {
  const userKey = crypto.createHash("sha256").update(user).digest("hex");
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  const options = { name: STORE_NAME, consistency: "strong" };
  if (siteID && token) {
    options.siteID = siteID;
    options.token = token;
  }
  return { store: getStore(options), key: `user/${userKey}/records` };
}

function emptyData() { return { version: 1, nextId: 1, records: [] }; }

async function readData(store, key) {
  const entry = await store.getWithMetadata(key, { consistency: "strong", type: "json" });
  return entry ? { data: entry.data || emptyData(), etag: entry.etag } : { data: emptyData(), etag: null };
}

function recordKey(record) {
  return [record.date, record.category, Number(record.amount).toFixed(2), String(record.notes || "").trim().toLocaleLowerCase()].join("|");
}

function normalizeRecord(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid record.");
  const category = LEGACY_CATEGORIES[input.category] || input.category;
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : "";
  const amount = Number(input.amount);
  if (!date || !VALID_CATEGORIES.has(category) || !Number.isFinite(amount) || amount <= 0) throw new Error("Invalid record fields.");
  return { date, category, amount, notes: String(input.notes || "").trim().slice(0, 200), createdAt: input.createdAt || new Date().toISOString() };
}

function mergeRecords(current, incoming) {
  const existing = new Set(current.records.map(recordKey));
  const additions = [];
  for (const input of incoming) {
    const record = normalizeRecord(input);
    if (existing.has(recordKey(record))) continue;
    const saved = { ...record, id: current.nextId++ };
    current.records.push(saved);
    existing.add(recordKey(saved));
    additions.push(saved);
  }
  return additions;
}

async function updateData(store, key, mutator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readData(store, key);
    const result = mutator(current.data);
    const options = current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const saved = await store.setJSON(key, result.data, options);
    if (saved.modified) return { data: result.data, result: result.result };
  }
  throw new Error("The data changed on another device. Please retry.");
}

function dashboard(data) {
  const total = data.records.reduce((sum, record) => sum + Number(record.amount), 0);
  const months = {};
  const categories = {};
  data.records.forEach(record => { const month = record.date.slice(0, 7); months[month] = (months[month] || 0) + Number(record.amount); });
  data.records.forEach(record => { categories[record.category] = (categories[record.category] || 0) + Number(record.amount); });
  return { total, count: data.records.length, monthly: months, categories };
}

exports.handler = async (event) => {
  if (!process.env.SESSION_SECRET) return json(503, { error: "Shared storage is not configured." });
  const session = validSession(event);
  if (!session) return json(401, { error: "Unauthorized." });
  if (!["GET", "POST", "PUT", "DELETE"].includes(event.httpMethod)) return json(405, { error: "Method not allowed." });

  try {
    const { store, key } = storeFor(session.sub);
    if (event.httpMethod === "GET") {
      const { data } = await readData(store, key);
      const view = new URL(event.rawUrl || `https://${event.headers.host || "localhost"}${event.path || "/"}`).searchParams.get("view");
      const month = new URL(event.rawUrl || `https://${event.headers.host || "localhost"}${event.path || "/"}`).searchParams.get("month");
      if (view === "monthly" && month) {
        const records = data.records.filter(record => record.date.startsWith(month));
        return json(200, { records, total: records.reduce((sum, record) => sum + Number(record.amount), 0), count: records.length });
      }
      return json(200, view === "dashboard" ? { records: data.records, dashboard: dashboard(data) } : { records: data.records });
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Invalid JSON request." }); }
    const update = await updateData(store, key, data => {
      if (event.httpMethod === "POST") {
        const incoming = body.action === "import" || Array.isArray(body.records) ? body.records : [body.record || body];
        const imported = mergeRecords(data, incoming || []);
        return { data, result: { imported, record: imported[0] || null } };
      }
      if (event.httpMethod === "PUT") {
        const id = Number(body.id);
        const index = data.records.findIndex(record => record.id === id);
        if (index < 0) throw new Error("Record not found.");
        const replacement = normalizeRecord(body.record || body);
        data.records[index] = { ...replacement, id, createdAt: data.records[index].createdAt };
        return { data, result: { record: data.records[index] } };
      }
      const id = Number(body.id);
      const before = data.records.length;
      data.records = data.records.filter(record => record.id !== id);
      if (data.records.length === before) throw new Error("Record not found.");
      return { data, result: { deleted: true } };
    });
    return json(200, { ...update.result, records: update.data.records, dashboard: dashboard(update.data) });
  } catch (error) {
    if (error?.name === "MissingBlobsEnvironmentError" || /environment has not been configured to use Netlify Blobs/i.test(error?.message || "")) {
      return json(503, { error: "Shared cloud storage is not configured. Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in Netlify, then redeploy.", code: "BLOBS_CONFIG_MISSING" });
    }
    const status = error.message === "Record not found." ? 404 : 400;
    return json(status, { error: error.message || "Unable to sync data." });
  }
};
