import { env } from "@/lib/env";

export interface XPostCheck {
  state: "verified" | "failed" | "unavailable" | "not_configured";
  detail: string;
  tweet?: { id: string; text: string; created_at?: string; author_username?: string };
}

interface XApiTweetResponse {
  data?: { id: string; text: string; author_id?: string; created_at?: string };
  includes?: { users?: { id: string; username: string }[] };
  errors?: { detail?: string; title?: string }[];
}

async function xFetch(path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`https://api.x.com/2${path}`, {
      headers: {
        Authorization: `Bearer ${env.xBearerToken}`,
        "User-Agent": "offr-rewards/1.0",
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies a submitted X post with the official API (app-only bearer token).
 * If credentials are missing or X is unreachable, the result is explicitly
 * reported as such so the submission falls back to manual review — it is never
 * marked verified without a real API response.
 */
export async function verifyXPost(args: {
  tweetId: string;
  expectedUsername?: string | null;
  campaignStartMs?: number;
}): Promise<XPostCheck> {
  if (!env.xBearerToken) {
    return {
      state: "not_configured",
      detail: "X API verification is not configured (X_BEARER_TOKEN missing). Queued for manual review.",
    };
  }

  let res: Response;
  try {
    res = await xFetch(
      `/tweets/${encodeURIComponent(args.tweetId)}?tweet.fields=created_at,author_id,text&expansions=author_id&user.fields=username`,
    );
  } catch (err) {
    return {
      state: "unavailable",
      detail: `X API unreachable (${(err as Error).message}). Queued for manual review.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      state: "unavailable",
      detail:
        "X API rejected our credentials or access tier (401/403). Queued for manual review — check X_BEARER_TOKEN.",
    };
  }
  if (res.status === 429) {
    return {
      state: "unavailable",
      detail: "X API rate limit reached (429). Queued for manual review.",
    };
  }
  if (res.status === 404) {
    return { state: "failed", detail: "That post could not be found on X (404). It may be deleted or private." };
  }
  if (!res.ok) {
    return { state: "unavailable", detail: `X API returned HTTP ${res.status}. Queued for manual review.` };
  }

  let body: XApiTweetResponse;
  try {
    body = (await res.json()) as XApiTweetResponse;
  } catch {
    return { state: "unavailable", detail: "X API returned an unreadable response. Queued for manual review." };
  }

  const tweet = body.data;
  if (!tweet) {
    return { state: "failed", detail: "X API did not return post data for that link." };
  }
  const author = body.includes?.users?.find((u) => u.id === tweet.author_id);
  const username = author?.username ?? null;

  if (!username) {
    return {
      state: "unavailable",
      detail: "X API did not resolve the post author (likely API tier limitation). Queued for manual review.",
    };
  }

  if (args.expectedUsername && username.toLowerCase() !== args.expectedUsername.replace(/^@/, "").toLowerCase()) {
    return {
      state: "failed",
      detail: `That post belongs to @${username}, which does not match your linked X account.`,
      tweet: { id: tweet.id, text: tweet.text, created_at: tweet.created_at, author_username: username },
    };
  }

  if (!/\boffr\b/i.test(tweet.text)) {
    return {
      state: "failed",
      detail: "The post does not mention OFFR. Add $OFFR to your post and resubmit.",
      tweet: { id: tweet.id, text: tweet.text, created_at: tweet.created_at, author_username: username },
    };
  }

  if (args.campaignStartMs && tweet.created_at) {
    const createdAt = new Date(tweet.created_at).getTime();
    if (Number.isFinite(createdAt) && createdAt < args.campaignStartMs - 24 * 60 * 60 * 1000) {
      return {
        state: "failed",
        detail: "That post was published before the campaign started.",
        tweet: { id: tweet.id, text: tweet.text, created_at: tweet.created_at, author_username: username },
      };
    }
  }

  return {
    state: "verified",
    detail: `Confirmed on X as @${username}.`,
    tweet: { id: tweet.id, text: tweet.text, created_at: tweet.created_at, author_username: username },
  };
}
