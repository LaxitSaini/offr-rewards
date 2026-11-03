/**
 * End-to-end smoke test against a running OFFR Rewards server.
 *
 *   CHAIN_MODE=mock npm run dev            # terminal 1
 *   npx tsx scripts/e2e.ts                 # terminal 2
 *
 * Exercises: wallet signature auth, session + CSRF, task submission, duplicate
 * prevention, on-chain holding read, referral credit, admin auth, review,
 * payout validation and the leaderboard. Exits non-zero on failure.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { execute } from "@/lib/db";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@offr.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "e2e-admin-password-1";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
  }
}

class Session {
  cookie = "";
  csrf = "";

  async call<T = any>(
    path: string,
    options: { method?: string; body?: unknown; csrf?: string | null } = {},
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    const token = options.csrf === undefined ? this.csrf : options.csrf;
    if (token) headers["x-offr-csrf"] = token;

    const res = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
    });

    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      if (pair && !pair.endsWith("=")) {
        const [name] = pair.split("=");
        const existing = this.cookie
          .split("; ")
          .filter((c) => c && !c.startsWith(`${name}=`))
          .join("; ");
        this.cookie = existing ? `${existing}; ${pair}` : pair;
      }
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
}

async function signIn(session: Session, privateKey: `0x${string}`, referralCode?: string) {
  const account = privateKeyToAccount(privateKey);
  const nonce = await session.call<{ message: string }>("/api/auth/nonce", {
    method: "POST",
    body: { address: account.address },
  });
  if (nonce.status !== 200) throw new Error(`nonce failed: ${JSON.stringify(nonce.data)}`);
  const signature = await account.signMessage({ message: nonce.data.message });
  const verify = await session.call<{ csrf: string; created: boolean }>("/api/auth/verify", {
    method: "POST",
    body: { address: account.address, signature, referralCode },
  });
  if (verify.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verify.data)}`);
  session.csrf = verify.data.csrf;
  return { address: account.address, created: verify.data.created };
}

async function adminRedirectCheck(): Promise<number> {
  const res = await fetch(`${BASE}/admin`, { redirect: "manual" });
  return res.status;
}

async function main() {
  console.log(`\n🔎 OFFR Rewards E2E against ${BASE}\n`);
  const suffix = Math.random().toString(36).slice(2, 8);
  const xHandle = `@offr_a_${suffix}`;
  const tgHandle = `@offr_tg_${suffix}`;
  const memeUrl = `https://example.com/meme-${suffix}.png`;

  // Local convenience: clear the rate-limit windows so reruns are repeatable.
  try {
    const cleared = await execute(`DELETE FROM rate_limits`);
    if (cleared.changes === 0) {
      const path = process.env.SQLITE_PATH ?? "./data/offr.db";
      console.log(
        `  ⚠️  cleared 0 rate-limit rows from ${path} — if the server uses another database, export SQLITE_PATH to match.\n`,
      );
    }
  } catch {
    /* remote server / no local DB — ignore */
  }

  const health = await new Session().call("/api/health");
  check("health endpoint responds", health.status === 200, health.data);
  check("chain mode is mock for this test run", health.data?.chain?.mode === "mock", health.data?.chain);

  // ── Participant A ────────────────────────────────────────────────────────
  console.log("\n1. Wallet sign-in");
  const alice = new Session();
  const aliceInfo = await signIn(alice, generatePrivateKey());
  check("wallet signature creates a session", Boolean(alice.csrf), aliceInfo);
  check("cookie is httpOnly-compatible (set)", alice.cookie.includes("offr_session"));

  const sessionInfo = await alice.call<{ user: { wallet: string } | null }>("/api/auth/session");
  check(
    "session returns the connected wallet",
    sessionInfo.data.user?.wallet?.toLowerCase() === aliceInfo.address.toLowerCase(),
    sessionInfo.data,
  );

  const dash = await alice.call<any>("/api/me");
  check("dashboard loads", dash.status === 200, dash.data?.error);
  check("task catalogue is seeded", (dash.data?.tasks?.length ?? 0) >= 6, dash.data?.tasks?.length);
  check("new wallet starts at zero points", dash.data?.user?.points === 0);
  check("reward estimate is locked below the point floor", dash.data?.reward?.eligible === false);

  // ── Server-rendered pages ───────────────────────────────────────────────
  console.log("\n1b. Server-rendered pages");
  const landing = await new Session().call<string>("/");
  check("landing page renders", landing.status === 200 && String(landing.data).includes("Contribute to OFFR"));
  const dashboardHtml = await alice.call<string>("/dashboard");
  check(
    "authenticated dashboard renders server-side",
    dashboardHtml.status === 200 &&
      String(dashboardHtml.data).includes("Campaign board") &&
      String(dashboardHtml.data).includes("Your standing"),
    dashboardHtml.status,
  );
  const gate = await new Session().call<string>("/dashboard");
  check(
    "logged-out dashboard shows the connect gate",
    String(gate.data).includes("Connect your wallet to open your dashboard"),
  );
  const adminPage = await adminRedirectCheck();
  check("admin area redirects unauthenticated visitors", adminPage === 307 || adminPage === 302, adminPage);

  // ── CSRF ────────────────────────────────────────────────────────────────
  console.log("\n2. CSRF + duplicate protection");
  const noCsrf = await alice.call("/api/tasks/x-follow/submit", {
    method: "POST",
    csrf: null,
    body: { proofText: tgHandle },
  });
  check("mutation without CSRF token is rejected", noCsrf.status === 403, noCsrf.data);

  // ── Submissions ─────────────────────────────────────────────────────────
  const submit = await alice.call<any>("/api/tasks/x-follow/submit", {
    method: "POST",
    body: { proofText: xHandle },
  });
  check("X follow claim is accepted", submit.status === 200, submit.data);
  check("claim is pending manual review", submit.data?.submission?.status === "pending");

  const duplicate = await alice.call("/api/tasks/x-follow/submit", {
    method: "POST",
    body: { proofText: xHandle },
  });
  check("duplicate claim is refused (409)", duplicate.status === 409, duplicate.data);

  const carol = new Session();
  await signIn(carol, generatePrivateKey());
  const badHandle = await carol.call("/api/tasks/x-follow/submit", {
    method: "POST",
    body: { proofText: "not a handle!!" },
  });
  check("invalid X handle is refused (400)", badHandle.status === 400, badHandle.data);

  const telegram = await alice.call<any>("/api/tasks/telegram-join/submit", {
    method: "POST",
    body: { proofText: tgHandle },
  });
  check(
    "Telegram claim falls back to manual review when the bot is unconfigured",
    telegram.status === 200 && telegram.data?.submission?.verificationState === "manual",
    telegram.data,
  );

  const badTask = await alice.call("/api/tasks/does-not-exist/submit", {
    method: "POST",
    body: { proofText: "x" },
  });
  check("unknown task is rejected", badTask.status === 404, badTask.data);

  // ── On-chain balance ────────────────────────────────────────────────────
  console.log("\n3. On-chain holdings check");
  const hold = await alice.call<any>("/api/holdings/verify", { method: "POST" });
  check("holding verification reads a balance", hold.status === 200, hold.data);
  check("balance is recorded from the chain provider", Number(hold.data?.hold?.balanceOffr?.replace(/,/g, "")) >= 0);
  check(
    "single check does not satisfy the multi-day rule",
    hold.data?.hold?.meetsRequirement === false,
    hold.data?.hold,
  );

  const holdAgain = await alice.call("/api/holdings/verify", { method: "POST" });
  check("repeated checks stay allowed under the limit", holdAgain.status === 200);

  // ── Referral ────────────────────────────────────────────────────────────
  console.log("\n4. Referral flow");
  const bob = new Session();
  const bobInfo = await signIn(bob, generatePrivateKey(), dash.data.user.referralCode);
  check("invited wallet registers", bobInfo.created === true);

  const selfReferral = await alice.call("/api/referral/apply", {
    method: "POST",
    body: { code: dash.data.user.referralCode },
  });
  check("self-referral is blocked", selfReferral.status === 400, selfReferral.data);

  const bobSubmit = await bob.call("/api/tasks/meme/submit", {
    method: "POST",
    body: {
      proofUrl: memeUrl,
      proofText: "OFFR meme entry",
    },
  });
  check("meme claim submitted", bobSubmit.status === 200, bobSubmit.data);

  const bobReuse = await alice.call("/api/tasks/meme/submit", {
    method: "POST",
    body: { proofUrl: memeUrl, proofText: "same link from another wallet" },
  });
  check("same proof cannot be reused by another wallet", bobReuse.status === 409, bobReuse.data);

  // ── Admin ───────────────────────────────────────────────────────────────
  console.log("\n5. Admin authentication");
  const admin = new Session();
  const noCookieAdmin = await new Session().call("/api/admin/overview");
  check("admin API is blocked without a session", noCookieAdmin.status === 403, noCookieAdmin.data);

  const badLogin = await admin.call("/api/admin/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: "definitely-wrong-1" },
  });
  check("wrong admin password is rejected", badLogin.status === 401, badLogin.data);

  const login = await admin.call<any>("/api/admin/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  check("admin login succeeds", login.status === 200, login.data);
  admin.csrf = login.data?.csrf ?? "";

  const noCsrfAdmin = await admin.call("/api/admin/settings", {
    method: "PUT",
    csrf: null,
    body: { campaignName: "Hacked" },
  });
  check("admin mutation without CSRF is rejected", noCsrfAdmin.status === 403, noCsrfAdmin.data);

  const overview = await admin.call<any>("/api/admin/overview");
  check("admin overview loads", overview.status === 200 && Boolean(overview.data?.counts), overview.data);
  check("overview reports participants", (overview.data?.counts?.participants ?? 0) >= 2);

  const tasksBefore = await admin.call<any>("/api/admin/tasks");
  const followWeight = tasksBefore.data?.tasks?.find((t: any) => t.slug === "x-follow")?.points ?? 150;

  const queue = await admin.call<any>("/api/admin/submissions?status=pending");
  const pendingAlice = queue.data?.submissions?.find(
    (s: any) => s.wallet?.toLowerCase() === aliceInfo.address.toLowerCase() && s.task_slug === "x-follow",
  );
  check("pending claim appears in the review queue", Boolean(pendingAlice), queue.data?.submissions?.length);

  const approve = await admin.call<any>(`/api/admin/submissions/${pendingAlice?.id}/review`, {
    method: "POST",
    body: { action: "approve", note: "verified follow" },
  });
  check("admin can approve a claim", approve.status === 200, approve.data);
  check(
    "approval credits the task weight",
    approve.data?.pointsAwarded === followWeight,
    { awarded: approve.data?.pointsAwarded, followWeight },
  );

  const approveAgain = await admin.call(`/api/admin/submissions/${pendingAlice?.id}/review`, {
    method: "POST",
    body: { action: "approve" },
  });
  check("double approval is refused", approveAgain.status === 409, approveAgain.data);

  const overAward = await admin.call(`/api/admin/submissions/${pendingAlice?.id}/review`, {
    method: "POST",
    body: { action: "approve", points: 99999 },
  });
  check("over-weight points are refused", overAward.status === 409 || overAward.status === 400, overAward.data);

  const aliceAfter = await alice.call<any>("/api/me");
  check("participant points increased", aliceAfter.data?.user?.points === followWeight, aliceAfter.data?.user);
  const expectedNet = String(
    Math.round(followWeight * Number(aliceAfter.data?.campaign?.offrPerPoint ?? 10)),
  );
  check(
    "reward estimate is now eligible",
    aliceAfter.data?.reward?.eligible === true && aliceAfter.data?.reward?.netOffr === expectedNet,
    { reward: aliceAfter.data?.reward, expectedNet },
  );

  // review bob's meme → alice referral should be credited
  const bobPending = queue.data?.submissions?.find(
    (s: any) => s.wallet?.toLowerCase() === bobInfo.address.toLowerCase(),
  );
  const bobApprove = await admin.call<any>(`/api/admin/submissions/${bobPending?.id}/review`, {
    method: "POST",
    body: { action: "approve" },
  });
  check("second participant can be approved", bobApprove.status === 200, bobApprove.data);
  check("referral is credited on first approval", bobApprove.data?.referralCredited === true, bobApprove.data);

  const aliceReferral = await alice.call<any>("/api/me");
  const referralPoints = aliceReferral.data?.campaign?.referralPoints ?? 100;
  check(
    "referrer received referral points",
    aliceReferral.data?.user?.points === followWeight + referralPoints,
    { points: aliceReferral.data?.user?.points, followWeight, referralPoints },
  );

  // ── Payouts ─────────────────────────────────────────────────────────────
  console.log("\n6. Payout validation");
  const badHash = await admin.call("/api/admin/payouts", {
    method: "POST",
    body: { wallet: aliceInfo.address, amount: "1000", txHash: "0xnotahash" },
  });
  check("malformed transaction hash is refused", badHash.status === 400, badHash.data);

  const overCap = await admin.call("/api/admin/payouts", {
    method: "POST",
    body: { wallet: aliceInfo.address, amount: "9000000" },
  });
  check("payout above the per-user cap is refused", overCap.status === 400, overCap.data);

  const record = await admin.call<any>("/api/admin/payouts", {
    method: "POST",
    body: { wallet: aliceInfo.address, amount: "1500", note: "e2e payout" },
  });
  check("payout can be recorded without a hash (pending)", record.status === 200, record.data);
  check("unverified payout is recorded, not paid", record.data?.payout?.status === "recorded", record.data?.payout);

  const fakeHash = `0x${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
  const failedVerify = await admin.call<any>("/api/admin/payouts", {
    method: "POST",
    body: { wallet: aliceInfo.address, amount: "10", txHash: fakeHash },
  });
  check(
    "unknown transaction hash is marked failed instead of verified",
    failedVerify.status === 200 && failedVerify.data?.payout?.status === "failed",
    failedVerify.data?.payout,
  );

  const duplicateHash = await admin.call("/api/admin/payouts", {
    method: "POST",
    body: { wallet: aliceInfo.address, amount: "10", txHash: fakeHash },
  });
  check("duplicate transaction hash is refused", duplicateHash.status === 409, duplicateHash.data);

  const budgetCheck = await admin.call<any>("/api/admin/payouts");
  check("budget snapshot is returned", Boolean(budgetCheck.data?.budget?.budgetOffr), budgetCheck.data?.budget);

  // ── Leaderboard + block ─────────────────────────────────────────────────
  console.log("\n7. Leaderboard, settings and moderation");
  const board = await new Session().call<any>("/api/leaderboard");
  check("leaderboard lists the approved participant", (board.data?.entries?.length ?? 0) >= 1, board.data);
  check("leaderboard masks wallets", board.data?.entries?.[0]?.wallet?.includes("…") === true);

  const settingsUpdate = await admin.call<any>("/api/admin/settings", {
    method: "PUT",
    body: { campaignName: "OFFR Rewards Season 1" },
  });
  check("admin can update campaign settings", settingsUpdate.status === 200, settingsUpdate.data);
  const badSettings = await admin.call("/api/admin/settings", {
    method: "PUT",
    body: { budgetOffr: "not-a-number" },
  });
  check("invalid settings are rejected", badSettings.status === 400, badSettings.data);

  const tasksList = await admin.call<any>("/api/admin/tasks");
  const followTask = tasksList.data?.tasks?.find((t: any) => t.slug === "x-follow");
  const taskPatch = await admin.call("/api/admin/tasks/" + followTask?.id, {
    method: "PATCH",
    body: { points: 200 },
  });
  check("admin can retune task weights", taskPatch.status === 200, taskPatch.data);

  const bobUserId = bobPending?.user_id;
  const blockRes = await admin.call(`/api/admin/users/${bobUserId}`, {
    method: "POST",
    body: { action: "block", note: "e2e block" },
  });
  check("admin can block a wallet", blockRes.status === 200, blockRes.data);
  const blockedSubmit = await bob.call("/api/tasks/meme/submit", {
    method: "POST",
    body: { proofUrl: `${memeUrl.replace(".png", "")}-2.png` },
  });
  check("blocked wallet cannot submit", blockedSubmit.status === 403, blockedSubmit.data);
  const unblock = await admin.call(`/api/admin/users/${bobUserId}`, {
    method: "POST",
    body: { action: "unblock" },
  });
  check("admin can unblock a wallet", unblock.status === 200, unblock.data);

  // ── Audit ───────────────────────────────────────────────────────────────
  console.log("\n8. Audit trail + rate limiting");
  const audit = await admin.call<any>("/api/admin/audit");
  check("audit log records actions", (audit.data?.entries?.length ?? 0) > 5, audit.data?.total);
  check(
    "audit contains the approval event",
    audit.data?.entries?.some((e: any) => e.action === "submission.approve") === true,
  );

  const fresh = new Session();
  let limited = false;
  for (let i = 0; i < 34; i++) {
    const res = await fresh.call("/api/auth/nonce", {
      method: "POST",
      body: { address: "0x1111111111111111111111111111111111111111" },
    });
    if (res.status === 429) {
      limited = true;
      break;
    }
  }
  check("nonce endpoint is rate limited", limited);

  console.log(`\n───────────────\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:", failures.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n💥 E2E crashed:", err);
  process.exit(1);
});
