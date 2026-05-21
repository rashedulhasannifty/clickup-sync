export const fmt = {
  money(cents: number, currency = 'AUD') {
    // Default currency is AUD because every backend cost column we surface
    // (clickup_time_entries.cost_cents, assignee_rates.hourly_rate_cents,
    // /reports/* `totalCostAud`) is denominated in AUD. Older callers that
    // passed USD by default happened to render the right glyph ($) on en-US
    // but the formatter's currency code was lying.
    //
    // Always show 2 fractional digits (standard currency display). The previous
    // 0-digit rounding hid sub-dollar values entirely — e.g. a 9-minute entry
    // at $1.38/h (21 cents) rendered as "$0" instead of "$0.21".
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      // `narrowSymbol` strips the regional prefix that en-US prepends for
      // non-USD currencies — so AUD renders as `$` instead of `A$`.
      // Browser support: Chrome 64+, Firefox 78+, Safari 14.1+ (universal
      // among any browser we'd support).
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  },
  number(n: number) {
    return new Intl.NumberFormat('en-US').format(n);
  },
  hours(h: number) {
    return `${h.toFixed(1)}h`;
  },
  shortHours(h: number) {
    if (h < 1) return `${Math.round(h * 60)}m`;
    return `${h.toFixed(1)}h`;
  },
  /** Human duration from decimal hours: 0.1h→"6m", 0.25h→"15m", 1.5h→"1h 30m", 2h→"2h". */
  duration(h: number) {
    const totalMin = Math.round((Number(h) || 0) * 60);
    if (totalMin <= 0) return '0m';
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hrs === 0) return `${mins}m`;
    if (mins === 0) return `${hrs}h`;
    return `${hrs}h ${mins}m`;
  },
  relative(iso: string | Date) {
    const ms = Date.now() - new Date(iso).getTime();
    // Future dates: a due date 3 days from now used to render as "just now"
    // because the `m < 1` branch caught any small magnitude including negative.
    // Symmetric handling here so future and past read naturally.
    if (ms < 0) {
      const future = -ms;
      const m = Math.floor(future / 60000);
      if (m < 1) return 'in a moment';
      if (m < 60) return `in ${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `in ${h}h`;
      return `in ${Math.floor(h / 24)}d`;
    }
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  },
  date(iso: string | Date) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  },
  shortDate(iso: string | Date) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
  },
  dateTime(iso: string | Date) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  },
  time(iso: string | Date) {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  },
};
