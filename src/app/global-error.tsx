"use client";

/** Last-resort boundary: the root layout itself failed. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#05060A",
          color: "#fff",
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <main id="main" style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>OFFR Rewards is temporarily unavailable</h1>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px", lineHeight: 1.6, marginTop: "12px" }}>
            No rewards are lost. Please try again in a moment.
            {error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "20px",
              background: "#B8FF3C",
              color: "#05060A",
              border: 0,
              borderRadius: "12px",
              padding: "12px 20px",
              fontWeight: 600,
              fontSize: "14px",
              minHeight: "44px",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
