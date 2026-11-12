import { createHash } from "node:crypto";
import { db } from "../src/lib/db";

const token = "c".repeat(64);

export function authorizeTestDatabase(): HeadersInit {
  db().prepare("INSERT OR IGNORE INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)")
    .run("test-owner", "owner@example.test", "unused", new Date().toISOString());
  db().prepare("INSERT OR IGNORE INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), "test-owner", "2099-01-01T00:00:00.000Z", new Date().toISOString());
  return { cookie: `post_house_session=${token}`, origin: "http://localhost:8000" };
}
