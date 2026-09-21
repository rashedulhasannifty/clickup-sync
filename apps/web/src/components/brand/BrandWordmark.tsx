import type { CSSProperties } from "react";

// "Nifty Log" wordmark — plain type, two-tone, no inline glyph.
//
// The three-bar log mark deliberately lives on the tile (BrandIcon) only. It
// was tried as the dot of a dotless "ı" here, echoing the cursor it replaced,
// and it does not work: shrunk into the dot's slot it smears into one blob at
// the 18px sidebar size, and scaled up far enough to resolve it detaches from
// the word and reads as a stray mark. The tile sits immediately to the left in
// every lockup, so the mark is already on screen — twice is noise.
export function BrandWordmark({
  fontSize = 22,
  color = "var(--text)",
  accentColor = "var(--accent)",
  depth = true,
  style,
}: {
  fontSize?: number;
  /** Colour of "Nifty". */
  color?: string;
  /** Colour of "Log". */
  accentColor?: string;
  depth?: boolean;
  style?: CSSProperties;
}) {
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
      <span>Nifty</span>
      <span style={{ width: "0.26em" }} />
      <span style={{ color: accentColor }}>Log</span>
    </span>
  );
}
