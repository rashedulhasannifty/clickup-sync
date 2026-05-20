export const fmt = {
  money(cents: number, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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
