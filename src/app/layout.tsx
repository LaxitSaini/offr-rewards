import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/wallet-provider";

export const metadata: Metadata = {
  title: {
    default: "OFFR Rewards — $OFFR community campaign",
    template: "%s · OFFR Rewards",
  },
  description:
    "Earn points for real contributions to OFFLINE RESEARCH ($OFFR) on Base. Connect a wallet, complete verified tasks, and track your reward status.",
  applicationName: "OFFR Rewards",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "OFFR Rewards",
    description: "The $OFFR community campaign on Base. Contribute, get verified, get recognised.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#05060A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Accessibility: every route renders exactly one `<main id="main">`, so this
 * layout only owns the skip link.
 *
 * Do NOT add `src/app/loading.tsx`: a root loading boundary makes Next stream the
 * shell with HTTP 200 before auth redirects resolve, which silently turns the
 * `/admin` → `/admin-login` 307 into a 200. `scripts/e2e.ts` asserts that every
 * admin route answers with a real 3xx, and it caught exactly that regression.
 * Loading states live inside the client components that own the data instead.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-lime focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
        >
          Skip to content
        </a>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
