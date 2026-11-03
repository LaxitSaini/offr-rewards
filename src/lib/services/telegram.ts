import { execute, newId, queryOne } from "@/lib/db";
import { env, integrations } from "@/lib/env";
import { errors, ApiError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { MINUTE, now, randomToken, truncate } from "@/lib/utils";
import { ensureAutoClaim } from "@/lib/services/submissions";
import { getUserById, updateUser, type UserRow } from "@/lib/users";
import {
  getBotInfo,
  getChatMember,
  getUpdates,
  isMemberStatus,
  parseStartPayload,
  sendMessage,
  type TelegramUpdate,
} from "@/lib/integrations/telegram";

export const TELEGRAM_LINK_TTL_MS = 30 * MINUTE;
const globalTg = globalThis as unknown as { __offrTgOffset?: number; __offrTgBotUser?: string | null };

export async function telegramBotUsername(): Promise<string | null> {
  if (env.telegramBotUsername) return env.telegramBotUsername.replace(/^@/, "");
  if (globalTg.__offrTgBotUser !== undefined) return globalTg.__offrTgBotUser;
  const info = await getBotInfo();
  globalTg.__offrTgBotUser = info?.username ?? null;
  return globalTg.__offrTgBotUser ?? null;
}

export async function startTelegramLink(user: UserRow): Promise<{ url: string; expiresAt: number }> {
  if (!integrations.telegramConfigured) {
    throw new ApiError(
      503,
      "integration_unavailable",
      "Automatic Telegram verification is not configured yet. Submit your @username on the Telegram task and the team will verify manually.",
    );
  }
  const bot = await telegramBotUsername();
  if (!bot) {
    throw new ApiError(
      503,
      "integration_unavailable",
      "The Telegram bot username could not be resolved. Set TELEGRAM_BOT_USERNAME.",
    );
  }

  const token = randomToken(18).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const ts = now();
  // Invalidate previous unused links for this wallet.
  await execute(`UPDATE telegram_links SET expires_at = ? WHERE user_id = ? AND consumed_at IS NULL`, [
    ts,
    user.id,
  ]);
  await execute(
    `INSERT INTO telegram_links (token, user_id, created_at, expires_at, consumed_at, telegram_user_id)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
    [token, user.id, ts, ts + TELEGRAM_LINK_TTL_MS],
  );

  return {
    url: `https://t.me/${bot}?start=${token}`,
    expiresAt: ts + TELEGRAM_LINK_TTL_MS,
  };
}

export interface TelegramCheck {
  linked: boolean;
  member: boolean;
  status: string;
  detail: string;
  claimCreated: boolean;
}

/** Verifies membership through the Bot API and records the result. */
export async function verifyTelegramMembership(user: UserRow): Promise<TelegramCheck> {
  if (!integrations.telegramConfigured) {
    throw new ApiError(503, "integration_unavailable", "Telegram verification is not configured.");
  }
  if (!user.telegram_user_id) {
    return {
      linked: false,
      member: false,
      status: "not_linked",
      detail: "This wallet has not been linked to a Telegram account yet.",
      claimCreated: false,
    };
  }

  let member: boolean;
  let status = "unknown";
  let detail: string;
  try {
    const result = await getChatMember(env.telegramChatId!, user.telegram_user_id);
    status = result.status;
    member = isMemberStatus(result.status, result.is_member);
    detail = member
      ? `Telegram membership confirmed (${result.status}).`
      : `Telegram reports status "${result.status}" — join ${env.telegramChatId} with the same account.`;
  } catch (err) {
    const message = (err as Error).message ?? "Telegram API error";
    const isNotMember = /user not found|participant/i.test(message);
    member = false;
    status = isNotMember ? "left" : "error";
    detail = isNotMember
      ? "That Telegram account is not a member of the OFFR chat."
      : `Telegram API error: ${truncate(message, 200)}`;
  }

  await execute(
    `INSERT INTO verifications (id, user_id, kind, status, method, detail, checked_at)
     VALUES (?, ?, 'telegram_membership', ?, 'bot', ?, ?)`,
    [newId("ver"), user.id, member ? "verified" : "failed", truncate(detail, 400), now()],
  );

  let claimCreated = false;
  if (member) {
    const claim = await ensureAutoClaim({
      user,
      taskSlug: "telegram-join",
      contentHash: `telegram:${user.telegram_user_id}`,
      verificationState: "verified",
      verificationDetail: detail,
      method: "bot",
    });
    claimCreated = Boolean(claim);
  }

  return { linked: true, member, status, detail, claimCreated };
}

export interface PollResult {
  linked: boolean;
  pending: boolean;
  check?: TelegramCheck;
  error?: string;
}

/**
 * Polls Telegram for the `/start <token>` message produced by the deep link.
 * This avoids needing a public webhook URL for the MVP; the webhook route is
 * also implemented for production use.
 */
export async function pollTelegramLink(user: UserRow): Promise<PollResult> {
  if (!integrations.telegramConfigured) {
    throw new ApiError(503, "integration_unavailable", "Telegram verification is not configured.");
  }
  const fresh = (await getUserById(user.id)) ?? user;
  if (fresh.telegram_linked_at) {
    return { linked: true, pending: false, check: await verifyTelegramMembership(fresh) };
  }

  const link = await queryOne<{ token: string; expires_at: number; consumed_at: number | null }>(
    `SELECT token, expires_at, consumed_at FROM telegram_links WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [user.id],
  );
  if (!link) return { linked: false, pending: false, error: "Start the Telegram link again." };
  if (link.consumed_at) {
    return { linked: true, pending: false, check: await verifyTelegramMembership(fresh) };
  }
  if (Number(link.expires_at) < now()) {
    return { linked: false, pending: false, error: "This Telegram link expired. Generate a new one." };
  }

  const offset = globalTg.__offrTgOffset ?? 0;
  let updates: TelegramUpdate[];
  try {
    updates = await getUpdates(offset, 0);
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/409|conflict|webhook/i.test(message)) {
      return {
        linked: false,
        pending: true,
        error: "A Telegram webhook is active, so polling is disabled. Membership will be confirmed automatically.",
      };
    }
    return { linked: false, pending: true, error: `Telegram API error: ${truncate(message, 160)}` };
  }

  for (const update of updates) {
    globalTg.__offrTgOffset = Math.max(globalTg.__offrTgOffset ?? 0, update.update_id + 1);
    await handleTelegramUpdate(update);
  }

  const after = await getUserById(user.id);
  if (after?.telegram_linked_at) {
    return { linked: true, pending: false, check: await verifyTelegramMembership(after) };
  }
  return { linked: false, pending: true };
}

/** Shared by polling and the webhook route. Idempotent. */
/** True when an update belongs to the configured campaign chat. */
export function isCampaignChat(chat: { id: number; username?: string }): boolean {
  const configured = env.telegramChatId;
  if (!configured) return true;
  if (configured.startsWith("@")) {
    return chat.username?.toLowerCase() === configured.slice(1).toLowerCase();
  }
  return String(chat.id) === configured;
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (message?.text && message.from) {
    const token = parseStartPayload(message.text);
    if (!token) {
      if (message.chat.type === "private") {
        await sendMessage(
          message.chat.id,
          "Welcome to OFFR Rewards. Open the campaign app, tap <b>Connect Telegram</b>, then press Start on the link it gives you.",
        );
      }
      return;
    }

    if (message.chat.type !== "private") {
      await sendMessage(
        message.chat.id,
        "For privacy, open the link the OFFR Rewards app gives you in a direct message with me.",
      );
      return;
    }

    const ts = now();
    const link = await queryOne<{ token: string; user_id: string; expires_at: number; consumed_at: number | null }>(
      `SELECT token, user_id, expires_at, consumed_at FROM telegram_links WHERE token = ?`,
      [token],
    );
    if (!link || link.consumed_at || Number(link.expires_at) < ts) {
      await sendMessage(message.chat.id, "That link has expired. Generate a fresh one from the OFFR Rewards app.");
      return;
    }

    const telegramUserId = String(message.from.id);
    const takenBy = await queryOne<{ id: string; wallet: string }>(
      `SELECT id, wallet FROM users WHERE telegram_user_id = ? AND id <> ?`,
      [telegramUserId, link.user_id],
    );
    if (takenBy) {
      await sendMessage(
        message.chat.id,
        "This Telegram account is already linked to another OFFR Rewards wallet. One Telegram account per wallet.",
      );
      return;
    }

    // Claim the token atomically so a replay (or two simultaneous /start
    // messages) cannot link twice.
    const claimed = await execute(
      `UPDATE telegram_links SET consumed_at = ?, telegram_user_id = ? WHERE token = ? AND consumed_at IS NULL`,
      [ts, telegramUserId, token],
    );
    if (claimed.changes !== 1) {
      await sendMessage(message.chat.id, "That link has expired. Generate a fresh one from the OFFR Rewards app.");
      return;
    }

    await execute(
      `UPDATE users SET telegram_user_id = ?, telegram_username = ?, telegram_linked_at = ? WHERE id = ?`,
      [telegramUserId, message.from.username ?? message.from.first_name ?? null, ts, link.user_id],
    );

    const user = await getUserById(link.user_id);
    if (!user) return;
    const check = await verifyTelegramMembership(user);
    await sendMessage(
      message.chat.id,
      check.member
        ? "✅ Telegram verified and linked to your OFFR Rewards wallet. Head back to the app to see your status."
        : `Wallet linked, but you are not a member of the community chat yet. Join ${env.telegramChatId ?? "the OFFR chat"} and press Verify in the app.`,
    );
    await getSettings();
    return;
  }

  const chatMember = update.chat_member;
  if (chatMember?.new_chat_member?.user && isCampaignChat(chatMember.chat)) {
    const telegramUserId = String(chatMember.new_chat_member.user.id);
    const user = await queryOne<UserRow>(`SELECT * FROM users WHERE telegram_user_id = ?`, [telegramUserId]);
    if (!user) return;
    await verifyTelegramMembership(user);
    await getSettings();
  }
}
