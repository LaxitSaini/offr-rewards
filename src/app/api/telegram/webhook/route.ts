import { env } from "@/lib/env";
import { ensureBoot } from "@/lib/bootstrap";
import { json, route } from "@/lib/http";
import { handleTelegramUpdate } from "@/lib/services/telegram";
import { safeEqual } from "@/lib/utils";
import type { TelegramUpdate } from "@/lib/integrations/telegram";

export const dynamic = "force-dynamic";

/**
 * Optional production path: register this URL with
 *   setWebhook?url=...&secret_token=TELEGRAM_WEBHOOK_SECRET
 * If no secret is configured the endpoint refuses every request.
 */
export const POST = route(async (req: Request) => {
  if (!env.telegramWebhookSecret) {
    return json({ ok: false, error: "webhook_not_configured" }, 503);
  }
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!provided || !safeEqual(provided, env.telegramWebhookSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  await ensureBoot();
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  try {
    await handleTelegramUpdate(update);
  } catch (err) {
    console.error("[telegram] webhook handler failed:", (err as Error).message);
  }
  return json({ ok: true });
});
