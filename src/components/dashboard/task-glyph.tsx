export function TaskGlyph({ type }: { type: string }) {
  const common = "h-4 w-4";
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: common,
  };
  switch (type) {
    case "telegram":
      return (
        <svg {...props}>
          <path d="M21 4L3 11l6 2 2 6 3-4 5 3 2-14z" />
        </svg>
      );
    case "x_follow":
    case "x_post":
      return (
        <svg {...props}>
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
    case "meme":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5c1 1.5 2.3 2.2 3.5 2.2s2.5-.7 3.5-2.2M9 9.5h.01M15 9.5h.01" />
        </svg>
      );
    case "content":
      return (
        <svg {...props}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 12h7M9 16h5" />
        </svg>
      );
    case "hold":
      return (
        <svg {...props}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
          <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      );
    case "referral":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="3" />
          <circle cx="17" cy="16" r="3" />
          <path d="M10.5 10.5l4.5 4" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <path d="M12 3l2.5 6L21 12l-6.5 3L12 21l-2.5-6L3 12l6.5-3z" />
        </svg>
      );
  }
}
