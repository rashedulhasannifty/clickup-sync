import type { CSSProperties } from "react";

// Nifty Log brand mark: three white concentric arcs — a radial bar chart of
// logged hours — on a purple→cyan rounded tile, rendered with the app's 3D
// "pressable" depth (hard bottom edge + ambient glow + top bevel highlight,
// matching .btn-3d). (Logo direction 04, "arcs".)
//
// The geometry here is the single source of truth for the mark: the static
// favicon (apps/web/public/favicon.svg), the iOS icon and the email PNG
// (apps/web/public/brand/nifty-log-mark.png) are all rasterised from these same
// numbers. Change one and regenerate the rest, or they drift apart.
//
// Known limit, accepted deliberately: the three rings stop resolving below about
// 20px — at a 16px browser tab the glyph softens into a spiral. That is a
// property of three strokes and two gaps inside ~10 device pixels, not something
// thicker strokes fix. If a crisp tab icon ever matters more than one consistent
// mark, the fix is a reduced favicon (one arc + a filled hub), not a redraw here.
//
// Pass `flat` for a depthless version.
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
  // The drawn arcs span ~82% of the 24-unit viewBox, so at 0.78 the mark
  // covers ~64% of the tile — as large as it goes before the outer arc starts
  // crowding the rounded corners. apps/web/public/favicon.svg insets the inner
  // <svg> by the same fraction; keep the two in step.
  const glyph = Math.round(size * 0.78);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        background:
          "linear-gradient(150deg, #8B79FF 0%, #7B68EE 42%, #49CCF9 100%)",
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
        {/* rotate(-90) starts every arc at 12 o'clock; each dasharray is a
            fraction of that ring's circumference (2πr), so the three read as
            bars of different length on a dial — outer 62%, middle 45%,
            inner 78%. */}
        <g
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        >
          <circle cx="12" cy="12" r="8.6" strokeDasharray="33.5 20.5" />
          <circle cx="12" cy="12" r="5.4" strokeDasharray="15.3 18.6" />
          <circle cx="12" cy="12" r="2.2" strokeDasharray="10.8 3" />
        </g>
      </svg>
    </div>
  );
}
