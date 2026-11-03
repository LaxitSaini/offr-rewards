import { requireAdmin } from "@/lib/auth/session";
import { countAudit, listAudit } from "@/lib/audit";
import { json, route } from "@/lib/http";

export const GET = route(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const perPage = 50;
  const [entries, total] = await Promise.all([
    listAudit(perPage, (page - 1) * perPage),
    countAudit(),
  ]);
  return json({ page, perPage, total, entries });
});
