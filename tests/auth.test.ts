import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { db } from "../src/lib/db";
import { POST as register } from "../app/api/auth/register/route";
import { POST as signIn } from "../app/api/auth/login/route";
import { POST as signOut } from "../app/api/auth/logout/route";
import { GET as content } from "../app/api/content/route";
import { POST as upload } from "../app/api/content/route";
import { PATCH as edit } from "../app/api/content/[id]/route";
import { GET as jobs } from "../app/api/jobs/route";
import { GET as dashboard } from "../app/api/dashboard/route";
import { GET as googleStart } from "../app/api/oauth/google/start/route";
import { GET as googleCallback } from "../app/api/oauth/google/callback/route";
import { POST as generate } from "../app/api/generate/route";
import { POST as schedule } from "../app/api/jobs/route";
import { POST as publish } from "../app/api/jobs/[id]/publish/route";

const base = "http://localhost:8000";
const email = "owner@example.test";
const password = "correct-horse-battery-staple";

function request(route: string, body: unknown, cookie?: string, origin = base): Request {
  return new Request(`${base}${route}`, { method: "POST", headers: { origin, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}

test("first owner registration, SQLite login session, revocation and protected routes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "post-house-auth-"));
  const saved = { path: process.env.DATABASE_PATH, key: process.env.STUDIO_PASSWORD, url: process.env.APP_URL, connection: globalThis.postHouseDatabase };
  process.env.DATABASE_PATH = path.join(directory, "studio.sqlite");
  process.env.STUDIO_PASSWORD = "existing-setup-key";
  process.env.APP_URL = base;
  globalThis.postHouseDatabase = undefined;
  try {
    assert.equal((await content(new Request(`${base}/api/content`))).status, 401);
    assert.equal((await jobs(new Request(`${base}/api/jobs`))).status, 401);
    assert.equal((await dashboard(new Request(`${base}/api/dashboard`))).status, 401);
    assert.equal((await googleStart(new Request(`${base}/api/oauth/google/start`))).status, 401);
    assert.equal((await googleCallback(new Request(`${base}/api/oauth/google/callback`))).status, 401);
    assert.equal((await generate(request("/api/generate", {}))).status, 401);
    assert.equal((await schedule(request("/api/jobs", {}))).status, 401);
    assert.equal((await upload(request("/api/content", {}))).status, 401);
    assert.equal((await edit(new Request(`${base}/api/content/missing`, { method: "PATCH" }), { params: Promise.resolve({ id: "missing" }) })).status, 401);
    assert.equal((await publish(request("/api/jobs/missing/publish", {}), { params: Promise.resolve({ id: "missing" }) })).status, 401);

    assert.equal((await register(request("/api/auth/register", { email, password, setupKey: "existing-setup-key" }, undefined, "https://evil.example"))).status, 403);
    assert.equal((await register(request("/api/auth/register", { email, password, setupKey: "wrong" }))).status, 403);
    const created = await register(request("/api/auth/register", { email: `  ${email.toUpperCase()}  `, password, setupKey: "existing-setup-key" }));
    assert.equal(created.status, 201);
    const registrationCookie = created.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.match(registrationCookie, /^post_house_session=[a-f0-9]{64}$/);
    assert.match(created.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/);
    const stored = db().prepare("SELECT email,password_hash FROM users").get() as { email: string; password_hash: string };
    assert.equal(stored.email, email);
    assert.match(stored.password_hash, /^scrypt-v1:/);
    assert.doesNotMatch(stored.password_hash, /correct-horse/);
    assert.equal((await register(request("/api/auth/register", { email: "other@example.test", password, setupKey: "existing-setup-key" }))).status, 409);
    assert.equal((await content(new Request(`${base}/api/content`, { headers: { cookie: registrationCookie } }))).status, 200);
    assert.equal((await content(new Request(`${base}/api/content`, { headers: { cookie: `post_house_session=${"f".repeat(64)}` } }))).status, 401);
    assert.equal((await signIn(request("/api/auth/login", { email, password: "wrong-password-123" }))).status, 401);
    const login = await signIn(request("/api/auth/login", { email, password }));
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.notEqual(loginCookie, registrationCookie);
    assert.equal((await jobs(new Request(`${base}/api/jobs`, { headers: { cookie: loginCookie } }))).status, 200);
    assert.equal((await schedule(request("/api/jobs", {}, loginCookie, "https://evil.example"))).status, 403);
    const loggedOut = await signOut(request("/api/auth/logout", {}, loginCookie));
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await jobs(new Request(`${base}/api/jobs`, { headers: { cookie: loginCookie } }))).status, 401);
  } finally {
    if (globalThis.postHouseDatabase) db().close();
    globalThis.postHouseDatabase = saved.connection;
    if (saved.path === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = saved.path;
    if (saved.key === undefined) delete process.env.STUDIO_PASSWORD; else process.env.STUDIO_PASSWORD = saved.key;
    if (saved.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved.url;
    rmSync(directory, { recursive: true, force: true });
  }
});
