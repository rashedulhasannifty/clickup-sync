import type { INestApplication } from '@nestjs/common';
import { json } from 'express';

/** The routes that take a past-records import (up to 2,000 rows, a few hundred KB). */
export const LARGE_JSON_ROUTES = [
  '/api/people/past-records/preview',
  '/api/people/past-records/apply',
];
export const LARGE_JSON_LIMIT = '4mb';

/**
 * Raises the JSON body limit for the import routes only; every other route
 * keeps Express's 100kb default. Call before `listen()`/`init()`: this parser
 * then runs first, and Nest's own parser skips a body already read.
 *
 * The parser is wrapped in a function of another name on purpose: Nest only
 * registers its own JSON parser when no middleware named `jsonParser` is
 * mounted yet, so mounting body-parser's function directly (even on two
 * paths) would leave every other route without a parsed body.
 */
export function applyBodyLimits(app: INestApplication): void {
  const parse = json({ limit: LARGE_JSON_LIMIT });
  app.use(LARGE_JSON_ROUTES, function largeJsonBody(req: never, res: never, next: never) {
    return parse(req, res, next);
  });
}
