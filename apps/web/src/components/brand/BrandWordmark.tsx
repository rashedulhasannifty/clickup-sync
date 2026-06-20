import type { CSSProperties } from "react";

// "clıcksy" wordmark — the dot of the (dotless) "ı" is a tiny mouse-cursor,
// echoing the app icon. `depth` adds a soft 3D lift consistent with the rest
// of the UI's pressable-depth system.
export function BrandWordmark({
  fontSize = 22,
  color = "var(--accent)",
  depth = true,
  style,
}: {
  fontSize?: number;
  color?: string;
  depth?: boolean;
  style?: CSSProperties;
}) {
  const cur = fontSize * 0.5;
  return (
    <span
      style={{
        fontFamily: "'Poppins', var(--font-sans)",
        fontWeight: 800,
        fontSize,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        color,
        display: "inline-flex",
        alignItems: "baseline",
        textShadow: depth ? "0 1px 1px rgba(91, 72, 201, 0.22)" : undefined,
        ...style,
      }}
    >
      <span>cl</span>
      <span style={{ position: "relative", display: "inline-block" }}>
        {"ı"}
        <span
          style={{
            position: "absolute",
            left: "46%",
            top: "-0.46em",
            transform: "rotate(-12deg)",
            lineHeight: 0,
          }}
        >
          <svg
            width={cur}
            height={cur * 1.18}
            viewBox="0 0 24 28"
            style={depth ? { filter: "drop-shadow(0 1px 1px rgba(91, 72, 201, 0.35))" } : undefined}
          >
            <path
              d="M3 2 L3 23 L8.5 17.5 L12 26 L15.5 24.4 L12 16 L20 16 Z"
              fill="currentColor"
              stroke="var(--surface)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
      <span>cksy</span>
    </span>
  );
}
