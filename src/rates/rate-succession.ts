export interface RateInterval {
	rateId: bigint;
	validFrom: Date;
	validTo: Date | null;
}

export type SuccessionPlan =
	| { ok: true; caps: { rateId: bigint; validTo: Date }[] }
	| { ok: false; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC date minus one day. Rates are @db.Date at UTC midnight. */
export function dayBefore(d: Date): Date {
	return new Date(d.getTime() - DAY_MS);
}

/**
 * Given all of ONE assignee's existing rates (excluding the row being created),
 * decide which rates to cap so the new rate can be inserted without overlap.
 * Closed-closed [from, to]; null = unbounded. A rate that overlaps and starts
 * before the new start is capped to newStart-1; an overlap that starts on/after
 * the new start cannot be capped and blocks the create.
 */
export function planRateSuccession(input: {
	existing: RateInterval[];
	newValidFrom: Date;
	newValidTo: Date | null;
}): SuccessionPlan {
	const { existing, newValidFrom, newValidTo } = input;
	const caps: { rateId: bigint; validTo: Date }[] = [];
	for (const r of existing) {
		const startsBeforeNewEnds = newValidTo === null || r.validFrom.getTime() <= newValidTo.getTime();
		const endsAfterNewStarts = r.validTo === null || r.validTo.getTime() >= newValidFrom.getTime();
		if (!(startsBeforeNewEnds && endsAfterNewStarts)) continue; // no overlap
		if (r.validFrom.getTime() >= newValidFrom.getTime()) {
			return {
				ok: false,
				reason: 'New rate starts on or before an existing rate for this assignee; adjust the dates.',
			};
		}
		caps.push({ rateId: r.rateId, validTo: dayBefore(newValidFrom) });
	}
	return { ok: true, caps };
}
