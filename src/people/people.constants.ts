/**
 * Policy constants for the People module (spec decisions 8 and 9, KPI table).
 * Constants for now; per-designation targets are slice 6.
 */

/** Late = first entry after 09:30 Dhaka (09:00 start + 30 min grace). */
export const LATE_AFTER_MINUTES = 9 * 60 + 30;
/** Dummy-provider and display reference; the office day nominally starts here. */
export const OFFICE_START_MINUTES = 9 * 60;
export const WORKING_DAY_HOURS = 8;

export const KPI_TARGETS = {
  utilisation: 85,
  chargeable: 70,
  onTimeDelivery: 85,
  punctuality: 90,
} as const;

/** Calendar-year entitlement in days. */
export const LEAVE_ENTITLEMENT = { casual: 10, sick: 14 } as const;

export const DEFAULT_PERIOD_DAYS = 90;
export const TREND_MONTHS = 6;
export const STRIP_BUSINESS_DAYS = 30;

export const BAND_ON_TRACK_MIN = 80;
export const BAND_WATCH_MIN = 60;

export const SYNC_DEFAULT_LOOKBACK_DAYS = 90;
export const SYNC_MAX_LOOKBACK_DAYS = 400;
/** What the daily cron re-syncs: matches the spec's "last 7 days". */
export const SYNC_CRON_LOOKBACK_DAYS = 7;
/** What the hourly office-hours cron re-syncs: today only, so the door log is live during the day. */
export const SYNC_INTRADAY_LOOKBACK_DAYS = 1;

/** Source stamped on rows created by the manual leave path. */
export const MANUAL_SOURCE = 'manual';

/** Used by the people controllers' listing endpoints; keeps one response bounded. */
export const LEAVE_LIST_LIMIT = 1000;
