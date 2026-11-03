import { cookies, headers } from "next/headers";
import { execute, newId, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { errors } from "@/lib/http";
import { DAY, HOUR, now, randomToken, safeEqual, sha256 } from "@/lib/utils";
import { getUserById, type UserRow } from "@/lib/users";

export const USER_COOKIE = "offr_session";
export const ADMIN_COOKIE = "offr_admin";
export const USER_SESSION_MS = 30 * DAY;
export const ADMIN_SESSION_MS = () => Math.max(1, env.adminSessionHours) * HOUR;

export type SessionKind = "user" | "admin";

export interface SessionRow {
  id: string;
  kind: SessionKind;
  user_id: string | null;
  admin_id: string | null;
  csrf: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number | null;
  ip: string | null;
  user_agent: string | null;
  revoked_at: number | null;
}

function cookieName(kind: SessionKind): string {
  return kind === "user" ? USER_COOKIE : ADMIN_COOKIE;
}

function ttlFor(kind: SessionKind): number {
  return kind === "user" ? USER_SESSION_MS : ADMIN_SESSION_MS();
}

export interface CreatedSession {
  token: string;
  csrf: string;
  expiresAt: number;
}

export async function createSession(args: {
  kind: SessionKind;
  userId?: string | null;
  adminId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<CreatedSession> {
  // A fresh token is issued on every login; only its hash is stored, so a
  // database leak cannot be replayed against the app.
  const token = randomToken(32);
  const id = sha256(token);
  const csrf = randomToken(24);
  const ts = now();
  const expiresAt = ts + ttlFor(args.kind);

  await execute(
    `INSERT INTO sessions (id, kind, user_id, admin_id, csrf, created_at, expires_at, last_seen_at, ip, user_agent, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      args.kind,
      args.userId ?? null,
      args.adminId ?? null,
      csrf,
      ts,
      expiresAt,
      ts,
      args.ip ?? null,
      args.userAgent ?? null,
    ],
  );

  const jar = await cookies();
  jar.set(cookieName(args.kind), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: Math.floor(ttlFor(args.kind) / 1000),
  });

  return { token, csrf, expiresAt };
}

export async function readSession(kind: SessionKind): Promise<SessionRow | null> {
  const jar = await cookies();
  const token = jar.get(cookieName(kind))?.value;
  if (!token || token.length < 20) return null;
  const id = sha256(token);
  const row = await queryOne<SessionRow>(`SELECT * FROM sessions WHERE id = ? AND kind = ?`, [
    id,
    kind,
  ]);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Number(row.expires_at) < now()) return null;

  if (!row.last_seen_at || now() - Number(row.last_seen_at) > 5 * 60 * 1000) {
    await execute(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [now(), id]);
  }
  return row;
}

export async function destroySession(kind: SessionKind): Promise<void> {
  const jar = await cookies();
  const token = jar.get(cookieName(kind))?.value;
  if (token) {
    await execute(`UPDATE sessions SET revoked_at = ? WHERE id = ?`, [now(), sha256(token)]);
  }
  jar.delete(cookieName(kind));
}

export interface AuthContext {
  session: SessionRow;
  user: UserRow;
}

export async function getCurrentUser(): Promise<AuthContext | null> {
  const session = await readSession("user");
  if (!session?.user_id) return null;
  const user = await getUserById(session.user_id);
  if (!user) return null;
  return { session, user };
}

export async function requireUser(): Promise<AuthContext> {
  const ctx = await getCurrentUser();
  if (!ctx) throw errors.unauthorized();
  return ctx;
}

export interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  is_active: number;
  failed_attempts: number;
  locked_until: number | null;
  created_at: number;
  last_login_at: number | null;
}

export async function getCurrentAdmin(): Promise<{ session: SessionRow; admin: AdminRow } | null> {
  const session = await readSession("admin");
  if (!session?.admin_id) return null;
  const admin = await queryOne<AdminRow>(`SELECT * FROM admins WHERE id = ?`, [session.admin_id]);
  if (!admin || !admin.is_active) return null;
  return { session, admin };
}

export async function requireAdmin(): Promise<{ session: SessionRow; admin: AdminRow }> {
  const ctx = await getCurrentAdmin();
  if (!ctx) throw errors.forbidden("Admin authentication required.");
  return ctx;
}

/** Double-submit-cookie style CSRF defence for same-origin mutations. */
export async function requireCsrf(session: SessionRow, req: Request): Promise<void> {
  const header = req.headers.get("x-offr-csrf");
  if (!header || !safeEqual(header, session.csrf)) {
    throw errors.forbidden("Invalid or missing CSRF token. Refresh the page and retry.");
  }
  const h = await headers();
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        throw errors.forbidden("Cross-origin request rejected.");
      }
    } catch {
      throw errors.forbidden("Invalid origin.");
    }
  }
  void h;
}

export function newAdminId(): string {
  return newId("adm");
}
