/** Cap matches the preview endpoint: a comma-separated id list in a query
 *  string is bounded by URL length, and 500 is far above any hand-built
 *  selection the UI can produce. */
export const MAX_CHARGEABLE_TASK_IDS = 500;

/** Same reasoning as MAX_CHARGEABLE_TASK_IDS, for the per-entry override: a
 *  bulk selection on the Time Entries page is bounded by what a person can
 *  plausibly select, and the recalc job's payload has to stay a sane size. */
export const MAX_CHARGEABLE_TIME_ENTRY_IDS = 500;
