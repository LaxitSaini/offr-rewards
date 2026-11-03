import { execute, queryOne } from "@/lib/db";
import { now } from "@/lib/utils";
import { getSettings } from "@/lib/settings";

export interface SeedTask {
  slug: string;
  title: string;
  description: string;
  instructions: string;
  type: string;
  points: number;
  max_awards: number;
  requires_proof: number;
  auto_verify: string;
  sort_order: number;
}

/**
 * Campaign task catalogue. Seeded once; afterwards the team edits tasks from the
 * admin dashboard and this seed never overwrites their changes.
 */
export const SEED_TASKS: SeedTask[] = [
  {
    slug: "telegram-join",
    title: "Join the OFFR Telegram",
    description: "Join the official OFFR community chat and stay for the campaign.",
    instructions:
      "Tap Connect Telegram, then press Start in the OFFR bot. Membership is verified with the Telegram Bot API.",
    type: "telegram",
    points: 150,
    max_awards: 1,
    requires_proof: 0,
    auto_verify: "telegram",
    sort_order: 10,
  },
  {
    slug: "x-follow",
    title: "Follow @OFFR35 on X",
    description: "Follow the official OFFR account and submit your handle for review.",
    instructions: "Follow https://x.com/OFFR35, then submit your X username (@handle).",
    type: "x_follow",
    points: 150,
    max_awards: 1,
    requires_proof: 1,
    auto_verify: "none",
    sort_order: 20,
  },
  {
    slug: "x-post",
    title: "Publish an original X post",
    description: "Post an original take on OFFR — research angle preferred over hype.",
    instructions:
      "Post on X mentioning $OFFR (tagging @OFFR35 helps). Paste the post link. One original post per account.",
    type: "x_post",
    points: 300,
    max_awards: 2,
    requires_proof: 1,
    auto_verify: "x_post",
    sort_order: 30,
  },
  {
    slug: "meme",
    title: "Create an OFFR meme",
    description: "Make something worth reposting. Quality beats volume.",
    instructions: "Upload your meme anywhere public and paste the link. Up to 2 entries per wallet.",
    type: "meme",
    points: 250,
    max_awards: 2,
    requires_proof: 1,
    auto_verify: "none",
    sort_order: 40,
  },
  {
    slug: "content",
    title: "Long-form content or video",
    description: "A thread, article, video or research note about OFFR.",
    instructions: "Submit a public link to your thread, article or video. Reviewed manually.",
    type: "content",
    points: 500,
    max_awards: 1,
    requires_proof: 1,
    auto_verify: "none",
    sort_order: 50,
  },
  {
    slug: "offr-holder",
    title: "Hold OFFR on Base",
    description: "Hold the minimum OFFR balance across the required number of verified days.",
    instructions:
      "Connect your wallet on Base. Balances are checked server-side; hold days count distinct UTC days with a verified qualifying balance.",
    type: "hold",
    points: 400,
    max_awards: 1,
    requires_proof: 0,
    auto_verify: "onchain_hold",
    sort_order: 60,
  },
];

export async function seedDefaults(): Promise<void> {
  const existing = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks`);
  if (Number(existing?.c ?? 0) === 0) {
    const ts = now();
    for (const task of SEED_TASKS) {
      await execute(
        `INSERT INTO tasks (id, slug, title, description, instructions, type, points, max_awards,
          requires_proof, requires_holding_raw, min_hold_days, auto_verify, active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 1, ?, ?, ?)
         ON CONFLICT (slug) DO NOTHING`,
        [
          `task_${task.slug}`,
          task.slug,
          task.title,
          task.description,
          task.instructions,
          task.type,
          task.points,
          task.max_awards,
          task.requires_proof,
          task.auto_verify,
          task.sort_order,
          ts,
          ts,
        ],
      );
    }
  }
  // Ensure campaign settings exist with valid defaults.
  await getSettings();
}
