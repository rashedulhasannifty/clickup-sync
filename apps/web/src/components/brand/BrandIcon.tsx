import type { CSSProperties } from "react";

// Clicksy brand mark: a white mouse-cursor on a purple→cyan rounded tile,
// rendered with the app's 3D "pressable" depth — a hard bottom edge + ambient
// glow + top bevel highlight, matching .btn-3d. (Logo direction 02.)
// Pass `flat` for a depthless version; the static favicon counterpart lives
// at apps/web/public/favicon.svg.
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
  const cursorH = Math.round(size * 0.56);
  const cursorW = Math.round(cursorH * (24 / 28));
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
        width={cursorW}
        height={cursorH}
        viewBox="0 0 24 28"
        style={{ filter: "drop-shadow(0 1px 0.5px rgba(20, 10, 60, 0.45))" }}
      >
        <path d="M3 2 L3 23 L8.5 17.5 L12 26 L15.5 24.4 L12 16 L20 16 Z" fill="#fff" />
      </svg>
    </div>
  );
}
