const crypto = require("crypto");

const COOKIE = "scrap_ledger_session";
const maxAge = 60 * 60 * 8;

function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }, body: JSON.stringify(body) };
}

function cookieOptions(value, maxAgeValue = maxAge) {
  const secureContexts = ["production", "deploy-preview", "branch-deploy"];
  const secure = secureContexts.includes(process.env.CONTEXT) ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeValue}${secure}`;
}

function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}

function equals(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(username) {
  const payload = Buffer.from(JSON.stringify({ sub: username, exp: Date.now() + maxAge * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function getCookie(headers = {}) {
  const raw = headers.cookie || headers.Cookie || "";
  return raw.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

function verifySession(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !equals(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch (_) { return null; }
}

exports.handler = async (event) => {
  if (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD || !process.env.SESSION_SECRET) {
    return json(503, { error: "Authentication is not configured." });
  }
  const session = verifySession(getCookie(event.headers));
  if (event.httpMethod === "GET") return json(200, { authenticated: !!session, user: session ? { username: session.sub } : null });
  if (event.httpMethod === "DELETE") return json(200, { authenticated: false }, { "Set-Cookie": cookieOptions("", 0) });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Invalid request." }); }
  const validUser = typeof input.username === "string" && equals(input.username, process.env.AUTH_USERNAME);
  const validPassword = typeof input.password === "string" && equals(input.password, process.env.AUTH_PASSWORD);
  if (!validUser || !validPassword) return json(401, { error: "Invalid credentials." });
  return json(200, { authenticated: true, user: { username: process.env.AUTH_USERNAME } }, { "Set-Cookie": cookieOptions(createSession(process.env.AUTH_USERNAME)) });
};
