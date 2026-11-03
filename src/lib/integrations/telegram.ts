import { env } from "@/lib/env";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
}

export interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  is_member?: boolean;
  user?: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: TelegramUser;
    chat: { id: number; type: string; title?: string; username?: string };
    text?: string;
    date: number;
  };
  chat_member?: {
    chat: { id: number; type: string; title?: string; username?: string };
    from?: TelegramUser;
    old_chat_member?: TelegramChatMember;
    new_chat_member: TelegramChatMember;
  };
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const TIMEOUT_MS = 10_000;

async function call<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
  if (!env.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "content-type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as TelegramApiResponse<T>;
    if (!json.ok) {
      const err = new Error(json.description ?? `Telegram ${method} failed`);
      (err as Error & { code?: number }).code = json.error_code;
      throw err;
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBotInfo(): Promise<TelegramUser | null> {
  try {
    return await call<TelegramUser>("getMe");
  } catch (err) {
    console.error("[telegram] getMe failed:", (err as Error).message);
    return null;
  }
}

export async function getChatMember(chatId: string, userId: string): Promise<TelegramChatMember> {
  return call<TelegramChatMember>("getChatMember", { chat_id: chatId, user_id: Number(userId) });
}

export async function getChat(chatId: string): Promise<{ id: number; title?: string; username?: string }> {
  return call("getChat", { chat_id: chatId });
}

export async function getUpdates(offset: number, timeoutSec = 0): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>("getUpdates", {
    offset,
    timeout: timeoutSec,
    allowed_updates: ["message", "chat_member"],
    limit: 100,
  });
}

export async function sendMessage(chatId: string | number, text: string): Promise<void> {
  try {
    await call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("[telegram] sendMessage failed:", (err as Error).message);
  }
}

/**
 * Telegram reports a member who has been muted/limited as "restricted" — they
 * are still in the chat, so `is_member` decides.
 */
export function isMemberStatus(status?: string, isMember?: boolean): boolean {
  if (status === "creator" || status === "administrator" || status === "member") return true;
  if (status === "restricted") return isMember === true;
  return false;
}

/** Parses `/start <token>` payloads into a link token. */
export function parseStartPayload(text?: string): string | null {
  if (!text) return null;
  const match = text.trim().match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{6,64})$/);
  return match ? match[1] : null;
}
