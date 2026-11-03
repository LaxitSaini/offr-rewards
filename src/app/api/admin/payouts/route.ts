import { z } from "zod";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { errors, getClientIp, json, parseJson, route } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { budgetSnapshot } from "@/lib/services/rewards";
import { listPayouts, recordPayout, totalPaidOffr } from "@/lib/services/payouts";

const createSchema = z.object({
  userId: z.string().min(6).max(64).optional(),
  wallet: z.string().min(42).max(42).optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Use a decimal OFFR amount"),
  txHash: z.string().max(80).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  overrideHoldRequirement: z.boolean().optional(),
});

export const GET = route(async (req: Request) => {
  await ensureBoot();
  const { admin } = await requireAdmin();
  void admin;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const [payouts, settings, paid] = await Promise.all([
    listPayouts({ status, limit: 25, offset: (page - 1) * 25 }),
    getSettings(),
    totalPaidOffr(),
  ]);
  return json({
    page,
    payouts,
    budget: budgetSnapshot(settings.budgetOffr, paid),
    limits: {
      budgetOffr: settings.budgetOffr,
      maxRewardPerUserOffr: settings.maxRewardPerUserOffr,
    },
  });
});

export const POST = route(async (req: Request) => {
  await ensureBoot();
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const body = await parseJson(req, createSchema);
  if (body.txHash && body.txHash.trim() === "") body.txHash = null;

  let userId = body.userId ?? null;
  if (!userId && body.wallet) {
    const { getUserByWallet } = await import("@/lib/users");
    const found = await getUserByWallet(body.wallet);
    if (!found) throw errors.notFound("No participant found for that wallet address.");
    userId = found.id;
  }
  if (!userId) throw errors.badRequest("Provide a participant wallet address.");

  const payout = await recordPayout({
    userId,
    amount: body.amount,
    txHash: body.txHash ?? null,
    note: body.note ?? null,
    adminId: admin.id,
    ip: getClientIp(req),
    overrideHoldRequirement: body.overrideHoldRequirement === true,
  });

  if (!payout) throw errors.server("Payout could not be recorded.");
  return json({ ok: true, payout });
});
