import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "./db";
import { z } from "zod";

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 64, passwordOptions, (error, key) => error ? reject(error) : resolve(key)));
}
const cookieName = "post_house_session";
const sessionSeconds = 7 * 24 * 60 * 60;
const passwordOptions = { N: 1 << 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export const accountSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(12).max(128),
});
export const registrationSchema = accountSchema.extend({ setupKey: z.string().max(256).optional() });
type User = { id: string; email: string };

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, Buffer.from(salt, "hex"));
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt-v1" || !salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const candidate = await scrypt(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export function ownerExists(): boolean {
  return !!db().prepare("SELECT id FROM users LIMIT 1").get();
}

export function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().replace(/:\d+$/, "") ?? host;
  const configured = (() => { try { return new URL(process.env.APP_URL ?? "http://localhost:8000").hostname; } catch { return "invalid"; } })();
  return [host, forwarded, configured].every((name) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(name));
}

export function registrationAllowed(request: Request, setupKey: string | undefined): boolean {
  const expected = process.env.STUDIO_PASSWORD;
  if (expected) return !!setupKey && equals(expected, setupKey);
  return isLocalRequest(request);
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const current = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    return source.origin === current.origin || (source.host === forwardedHost && source.protocol === `${forwardedProto}:`);
  } catch { return false; }
}

function rawCookie(header: string | null): string | null {
  const entry = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  const token = entry?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function sessionUser(token: string | null): User | null {
  if (!token) return null;
  return (db().prepare("SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?")
    .get(tokenHash(token), nowIso()) as User | undefined) ?? null;
}

export function requestUser(request: Request): User | null {
  return sessionUser(rawCookie(request.headers.get("cookie")));
}

export function apiAccess(request: Request): Response | null {
  if (!requestUser(request)) return Response.json({ error: "Sign in to use the studio." }, { status: 401 });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request)) return Response.json({ error: "Request origin did not match this studio." }, { status: 403 });
  return null;
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + sessionSeconds * 1000).toISOString();
  db().prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").run(tokenHash(token), userId, expiry, nowIso());
  return token;
}

export function sessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionSeconds}${secure ? "; Secure" : ""}`;
}

export function clearSession(request: Request): string {
  const token = rawCookie(request.headers.get("cookie"));
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function registerOwner(email: string, password: string): Promise<{ user: User; token: string } | null> {
  const passwordHash = await hashPassword(password);
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (ownerExists()) { connection.exec("ROLLBACK"); return null; }
    const user = { id: randomUUID(), email };
    connection.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)").run(user.id, user.email, passwordHash, nowIso());
    const token = createSession(user.id);
    connection.exec("COMMIT");
    return { user, token };
  } catch (error) { connection.exec("ROLLBACK"); throw error; }
}

function attemptKey(email: string, request: Request): string {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return tokenHash(`${email}:${address}`);
}

export async function login(email: string, password: string, request: Request): Promise<{ kind: "ok"; token: string } | { kind: "blocked" | "invalid" }> {
  const key = attemptKey(email, request);
  const attempt = db().prepare("SELECT failures,blocked_until FROM login_attempts WHERE key=?").get(key) as { failures: number; blocked_until: string | null } | undefined;
  if (attempt?.blocked_until && attempt.blocked_until > nowIso()) return { kind: "blocked" };
  const user = db().prepare("SELECT id,password_hash FROM users WHERE email=?").get(email) as { id: string; password_hash: string } | undefined;
  const valid = await verifyPassword(password, user?.password_hash ?? `scrypt-v1:${"0".repeat(32)}:${"0".repeat(128)}`);
  if (!valid || !user) {
    const failures = (attempt?.blocked_until ? 0 : attempt?.failures ?? 0) + 1;
    const blockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    db().prepare("INSERT INTO login_attempts(key,failures,blocked_until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until")
      .run(key, failures, blockedUntil);
    return { kind: "invalid" };
  }
  db().prepare("DELETE FROM login_attempts WHERE key=?").run(key);
  return { kind: "ok", token: createSession(user.id) };
}
