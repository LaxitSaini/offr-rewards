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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
