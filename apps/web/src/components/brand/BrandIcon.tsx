import type { CSSProperties } from "react";

// Nifty Log brand mark: three white "log" bars on a purple→cyan rounded tile,
// rendered with the app's 3D "pressable" depth — a hard bottom edge + ambient
// glow + top bevel highlight, matching .btn-3d. (Logo direction 02.)
// Pass `flat` for a depthless version; the static favicon counterpart lives
// at apps/web/public/favicon.svg, and the sibling Nifty Timer tile at
// apps/web/public/nifty-timer.svg.
export function BrandIcon({
  size = 28,
  flat = false,
  style,
}: {
  size?: number;
  flat?: boolean;
  style?: CSSProperties;
}) {
  const radius = Math.max(6, Math.round(size * 0.3));
  const edge = Math.max(2, Math.round(size * 0.1)); // thickness of the 3D side
  const glyph = Math.round(size * 0.62);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        background: "linear-gradient(150deg, #8B79FF 0%, #7B68EE 42%, #49CCF9 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: flat
          ? undefined
          : [
              `0 ${edge}px 0 0 #5b48c9`, // hard bottom edge — the 3D thickness
              `0 ${edge + 3}px ${edge + 8}px rgba(123, 104, 238, 0.45)`, // ambient glow
              "inset 0 1px 0 rgba(255, 255, 255, 0.45)", // top bevel highlight
              "inset 0 -2px 4px rgba(40, 20, 90, 0.30)", // bottom inner shade
            ].join(", "),
        ...style,
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        style={{ filter: "drop-shadow(0 1px 0.5px rgba(20, 10, 60, 0.45))" }}
      >
        {/* Long / short / medium: a list of logged entries, and a bar chart of
            the hours on them. Widths stay uneven so it never reads as a menu. */}
        <g fill="#fff">
          <rect x="3.5" y="4.4" width="17" height="3.4" rx="1.7" />
          <rect x="3.5" y="10.3" width="9.5" height="3.4" rx="1.7" />
          <rect x="3.5" y="16.2" width="13.5" height="3.4" rx="1.7" />
        </g>
      </svg>
    </div>
  );
}
