/**
 * UI / accessibility audit — runs against a live server and asserts the
 * structural invariants we can verify without a layout engine.
 *
 *   node scripts/ui-audit.mjs                 # against http://localhost:3000
 *   AUDIT_BASE_URL=https://… node scripts/ui-audit.mjs
 *
 * What it checks, per route:
 *   - document language + mobile viewport meta
 *   - one <h1>, sane heading order, <main> landmark, skip link
 *   - accessible names for inputs and buttons, alt text for images
 *   - target=_blank without rel=noopener/noreferrer
 *   - fixed pixel widths that cannot fit a 320px screen
 *   - tables that are not in a horizontal-scroll wrapper
 *   - long unbreakable tokens (addresses, hashes) with no wrap/truncate guard
 *   - text colour contrast (WCAG AA) computed from the Tailwind classes
 *   - small tap targets (py-1 / py-1.5 interactive elements)
 *   - internal links resolve (no 404s in navigation)
 *
 * It signs in a throwaway wallet and the admin account so authenticated pages
 * (dashboard, the whole admin console) are audited too. It cannot measure real
 * layout — a headless browser is not available in this environment — so widths
 * are verified as CSS constraints rather than measured pixels.
 */
import { parseHTML } from "linkedom";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@offr.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "e2e-admin-password-1";

const PAGE_BG = "#0A0D14"; // ink-850, the lightest surface text usually sits on
const TOKENS = {
  "ink-950": "#05060A",
  "ink-900": "#080A10",
  "ink-850": "#0A0D14",
  "ink-800": "#0D111A",
  "lime": "#B8FF3C",
  "lime-soft": "#D8FF9A",
  "lime-dim": "#8FCC2E",
  "electric": "#6E8BFF",
  "electric-soft": "#A9BAFF",
  "electric-dim": "#4458C4",
  "ember": "#FF7A45",
  "ember-soft": "#FFB08A",
  "danger": "#FF5A6E",
  "amber-200": "#FDE68A",
  "amber-300": "#FCD34D",
  "white": "#FFFFFF",
};

/* ---------- colour helpers ---------- */
const hex = (h) => {
  const v = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const composite = (fg, alpha, bg) => fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]));
const luminance = ([r, g, b]) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Resolves `text-white/45`, `text-lime/80`, `text-danger` → effective colour. */
function resolveTextColour(cls, bg = hex(PAGE_BG)) {
  const m = cls.match(/\btext-([a-z0-9-]+)(?:\/(\d{1,3}))?\b/);
  if (!m) return null;
  const [, token, alphaRaw] = m;
  if (token === "transparent" || token === "inherit") return null;
  const base = TOKENS[token];
  if (!base) return null;
  const alpha = alphaRaw ? Math.min(100, Number(alphaRaw)) / 100 : 1;
  return composite(hex(base), alpha, bg);
}

const isLargeText = (cls) =>
  /text-(2xl|3xl|4xl|5xl|6xl)\b/.test(cls) || /text-\[(2[4-9]|[3-9]\d)px\]/.test(cls);

/* ---------- auth helpers ---------- */
function cookieHeader(res) {
  const jars = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return jars.map((c) => c.split(";")[0]).join("; ");
}

async function participantCookie() {
  const account = privateKeyToAccount(generatePrivateKey());
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address }),
  });
  const nonce = await nonceRes.json();
  const message = nonce?.message ?? nonce?.data?.message;
  if (!message) return { cookie: "", address: account.address };
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address, signature }),
  });
  return { cookie: cookieHeader(verifyRes), address: account.address };
}

async function adminCookie() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  return cookieHeader(res);
}

/* ---------- per-document audit ---------- */
const issues = [];
const add = (level, route, rule, detail) => issues.push({ level, route, rule, detail });

function auditDocument(route, html) {
  const { document } = parseHTML(html);
  const q = (sel) => [...document.querySelectorAll(sel)];
  const classesOf = (el) => (el.getAttribute?.("class") ?? "").toString();

  // 1. language + viewport
  const lang = document.querySelector("html")?.getAttribute("lang");
  if (!lang) add("error", route, "html-lang", "<html> has no lang attribute");
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
  if (!/width=device-width/.test(vp)) add("error", route, "viewport", `viewport meta: "${vp}"`);
  if (!/initial-scale=1/.test(vp)) add("error", route, "viewport-scale", `viewport meta: "${vp}"`);
  if (!/viewport-fit=cover/.test(vp)) add("warn", route, "viewport-fit", "no viewport-fit=cover");

  // 2. headings + landmarks
  const h1s = q("h1");
  if (h1s.length === 0) add("error", route, "h1-missing", "page has no <h1>");
  if (h1s.length > 1) add("warn", route, "h1-multiple", `${h1s.length} <h1> elements`);
  const main = document.querySelector("main");
  if (!main) add("warn", route, "main-landmark", "no <main> landmark");
  if (!document.querySelector('a[href="#main"]')) add("warn", route, "skip-link", "no skip-to-content link");

  const levels = q("h1,h2,h3,h4").map((h) => Number(h.tagName.slice(1)));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      add("warn", route, "heading-order", `h${levels[i - 1]} → h${levels[i]}`);
      break;
    }
  }

  // 3. accessible names
  const hasName = (el) => {
    if ((el.getAttribute("aria-label") ?? "").trim()) return true;
    if ((el.getAttribute("aria-labelledby") ?? "").trim()) return true;
    if ((el.textContent ?? "").trim()) return true;
    if ((el.getAttribute("title") ?? "").trim()) return true;
    const id = el.getAttribute("id");
    if (id && document.querySelector(`label[for="${id}"]`)) return true;
    let p = el.parentElement;
    while (p) {
      if (p.tagName === "LABEL") return true;
      p = p.parentElement;
    }
    return false;
  };
  for (const el of q("input, select, textarea")) {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (["hidden", "submit", "button", "reset"].includes(type)) continue;
    if (!hasName(el)) {
      add("error", route, "field-name", `<${el.tagName.toLowerCase()} name="${el.getAttribute("name") ?? ""}" type="${type}"> has no label`);
    }
  }
  for (const el of q("button")) {
    if (!hasName(el)) add("error", route, "button-name", `<button class="${classesOf(el).slice(0, 60)}">`); 
  }
  for (const img of q("img")) {
    if (img.getAttribute("alt") === null) add("error", route, "img-alt", img.getAttribute("src") ?? "(inline)");
  }
  for (const a of q('a[target="_blank"]')) {
    const rel = (a.getAttribute("rel") ?? "").toLowerCase();
    if (!/noopener|noreferrer/.test(rel)) {
      add("error", route, "blank-rel", `${a.getAttribute("href")} rel="${rel}"`);
    }
  }
  for (const a of q("a")) {
    if (!hasName(a)) add("error", route, "link-name", `a[href="${a.getAttribute("href")}"]`);
  }

  // 4. responsive constraints
  for (const el of q("[class]")) {
    const cls = classesOf(el);
    const m = cls.match(/\b(?:min-)?w-\[(\d+)px\]/);
    if (m && Number(m[1]) >= 320) add("error", route, "fixed-width", `${m[0]} on <${el.tagName.toLowerCase()}>`);
    if (/\bw-screen\b/.test(cls) && !/max-w-full/.test(cls)) add("warn", route, "w-screen", "w-screen without max-w-full");
  }
  for (const table of q("table")) {
    let p = table.parentElement;
    let guarded = false;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const cls = classesOf(p);
      if (/overflow-x-auto|overflow-auto|table-wrap/.test(cls)) {
        guarded = true;
        break;
      }
    }
    if (!guarded) add("error", route, "table-overflow", "table is not inside a horizontal scroll wrapper");
  }

  // 5. long unbreakable tokens (addresses / hashes)
  const wrapGuard = (el) => {
    let p = el;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const cls = p.getAttribute?.("class") ?? "";
      if (/break-all|break-words|break-normal|truncate|overflow-hidden|overflow-x-auto|line-clamp/.test(cls)) return true;
    }
    return false;
  };
  const seen = new Set();
  for (const el of q("span, p, div, td, code, a")) {
    const direct = [...(el.childNodes ?? [])]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join(" ");
    const token = direct.split(/\s+/).find((t) => t.length >= 24 && /^[0-9a-zA-Z:_-]+$/.test(t));
    if (!token) continue;
    const key = `${el.tagName}:${token.slice(0, 12)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!wrapGuard(el)) add("warn", route, "long-token", `${token.slice(0, 16)}… in <${el.tagName.toLowerCase()}>`);
  }

  // 6. contrast
  const checked = new Set();
  for (const el of q("[class]")) {
    const cls = classesOf(el);
    if (!/\btext-(white|lime|electric|ember|danger|amber-\d+)/.test(cls)) continue;
    if (/aria-hidden="true"/.test(el.outerHTML?.slice(0, 200) ?? "")) continue;
    const text = (el.textContent ?? "").trim();
    if (!text) continue;
    const colour = resolveTextColour(cls);
    if (!colour) continue;
    const ratio = contrast(colour, hex(PAGE_BG));
    const large = isLargeText(cls);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      const token = cls.match(/\btext-[a-z0-9-]+(?:\/\d+)?/)?.[0] ?? cls.slice(0, 20);
      const key = `${token}|${min}`;
      if (checked.has(key)) continue;
      checked.add(key);
      add("error", route, "contrast", `${token} → ${ratio.toFixed(2)}:1 (needs ${min}:1)`);
    }
  }

  // 7. tap targets — .btn-sm and .tap carry a 44px min-height below `sm`,
  //    so only unguarded small controls are flagged.
  const small = [];
  for (const el of q("button, a, [role=button]")) {
    const cls = classesOf(el);
    const lowPadding = /\bpy-1\.5\b|\bpy-1\b/.test(cls);
    const guarded = /\bbtn-sm\b|\btap\b|\bmin-h-(9|10|11|12)\b|\bmin-h-\[4[4-9]px\]/.test(cls);
    if (lowPadding && !guarded) small.push(`${el.tagName.toLowerCase()}: "${(el.textContent ?? "").trim().slice(0, 22)}"`);
  }
  if (small.length) add("warn", route, "tap-target", `${small.length} control(s) below 44px → ${small.slice(0, 4).join(", ")}`);
}

/* ---------- link crawl ---------- */
const internalLinks = new Set();
function collectLinks(html) {
  const { document } = parseHTML(html);
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href?.startsWith("/") && !href.startsWith("//")) internalLinks.add(href.split("#")[0]);
  }
}

/* ---------- main ---------- */
async function main() {
  console.log(`\nUI audit against ${BASE}\n`);
  const participant = await participantCookie().catch(() => ({ cookie: "" }));
  const admin = await adminCookie().catch(() => "");

  const routes = [
    { path: "/", label: "landing", cookie: "" },
    { path: "/leaderboard", label: "leaderboard", cookie: "" },
    { path: "/admin-login", label: "admin login", cookie: "" },
    { path: "/dashboard", label: "dashboard (signed in)", cookie: participant.cookie },
    { path: "/admin", label: "admin overview", cookie: admin },
    { path: "/admin/submissions", label: "admin review queue", cookie: admin },
    { path: "/admin/participants", label: "admin participants", cookie: admin },
    { path: "/admin/tasks", label: "admin tasks", cookie: admin },
    { path: "/admin/settings", label: "admin settings", cookie: admin },
    { path: "/admin/payouts", label: "admin payouts", cookie: admin },
    { path: "/admin/audit", label: "admin audit", cookie: admin },
  ];

  for (const route of routes) {
    const res = await fetch(`${BASE}${route.path}`, {
      headers: route.cookie ? { cookie: route.cookie } : {},
      redirect: "manual",
    });
    if (res.status !== 200) {
      add(res.status >= 500 ? "error" : "warn", route.path, "http-status", `HTTP ${res.status}`);
      continue;
    }
    const html = await res.text();
    auditDocument(route.path, html);
    collectLinks(html);
    const count = issues.filter((i) => i.route === route.path);
    const errs = count.filter((i) => i.level === "error").length;
    console.log(
      `  ${errs === 0 ? "✓" : "✗"} ${route.label.padEnd(26)} ${errs} error(s), ${count.length - errs} warning(s)`,
    );
  }

  // link integrity
  const broken = [];
  for (const href of [...internalLinks].slice(0, 40)) {
    const res = await fetch(`${BASE}${href}`, { redirect: "manual" });
    if (res.status >= 400) broken.push(`${href} → ${res.status}`);
  }
  for (const b of broken) add("error", "(links)", "broken-link", b);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warn");

  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    for (const i of errors) console.log(`  • [${i.route}] ${i.rule}: ${i.detail}`);
  }
  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`);
    const grouped = new Map();
    for (const w of warnings) {
      const key = `${w.rule}`;
      grouped.set(key, [...(grouped.get(key) ?? []), w]);
    }
    for (const [rule, list] of grouped) {
      console.log(`  • ${rule} — ${list.length} on ${new Set(list.map((l) => l.route)).size} route(s)`);
      for (const w of list.slice(0, 4)) console.log(`      [${w.route}] ${w.detail}`);
      if (list.length > 4) console.log(`      … ${list.length - 4} more`);
    }
  }

  console.log(
    `\n${errors.length === 0 ? "PASS" : "FAIL"} — ${errors.length} error(s), ${warnings.length} warning(s) across ${routes.length} routes\n`,
  );
  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("audit crashed:", err.message);
  process.exit(1);
});
