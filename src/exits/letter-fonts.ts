import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The letter font. Hind Siliguri (SIL OFL 1.1, see fonts/OFL.txt) covers Latin AND Bengali in a
 * single file, so a mixed line such as a Bengali name inside an English sentence renders with one
 * font. pdfkit's built-in Helvetica has no Bengali glyphs.
 *
 * The TTFs live in `fonts/` next to this file and are copied into `dist/exits/fonts` by the
 * `assets` entry in nest-cli.json (the production image ships only dist/, node_modules and
 * prisma/). Resolved from __dirname, so it works from ts-jest (src) and from dist alike.
 */
export const LETTER_FONT_REGULAR = 'LetterRegular';
export const LETTER_FONT_BOLD = 'LetterBold';

type LetterFontName = typeof LETTER_FONT_REGULAR | typeof LETTER_FONT_BOLD;

const FONT_DIR = join(__dirname, 'fonts');
const FILES: Record<LetterFontName, string> = {
  [LETTER_FONT_REGULAR]: 'HindSiliguri-Regular.ttf',
  [LETTER_FONT_BOLD]: 'HindSiliguri-Bold.ttf',
};

let cache: Record<LetterFontName, Buffer> | null = null;

/** Reads the font files once. Throws a descriptive error if one is missing; never falls back to Helvetica. */
export function loadLetterFonts(): Record<LetterFontName, Buffer> {
  if (cache) return cache;
  const loaded = {} as Record<LetterFontName, Buffer>;
  for (const name of Object.keys(FILES) as LetterFontName[]) {
    const path = join(FONT_DIR, FILES[name]);
    if (!existsSync(path)) {
      throw new Error(
        `Letter font file is missing: ${path}. It must be copied next to the compiled code ` +
          `(nest-cli.json "assets": exits/fonts/*). Refusing to fall back to Helvetica, which cannot render Bengali.`,
      );
    }
    loaded[name] = readFileSync(path);
  }
  cache = loaded;
  return loaded;
}
