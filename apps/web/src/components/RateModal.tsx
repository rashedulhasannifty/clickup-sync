import { useState, useEffect, useMemo, useRef } from 'react';
import {
	AlertTriangle,
	Check,
	DollarSign,
	Info,
	Trash2,
} from 'lucide-react';
import { parseRatesListResponse, type Rate } from '../api/rates';
import {
	useRates,
	useCreateRate,
	useUpdateRate,
	useDeleteRate,
	useWorkspaceMembers,
} from '../hooks/useRates';
import { useMissingRates } from '../hooks/useReports';
import { Modal } from './ui/Modal';
import { Field } from './ui/Field';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Select } from './ui/Select';

const MANUAL_VALUE = '__manual__';

type MissingAssigneeRow = {
	userId: string;
	userName: string;
	userEmail: string;
};

type AssigneeRow = {
	id: string;
	name: string;
	email: string | null;
};

export interface RatePresetAssignee {
	assigneeId: string;
	assigneeName: string | null;
	assigneeEmail: string | null;
}

interface RateModalProps {
	open: boolean;
	rate: Rate | null;
	/** Prefill assignee when creating from an assignee card */
	presetAssignee?: RatePresetAssignee | null;
	onClose: () => void;
}

type WorkspaceMemberRow = { id: string; name: string | null; email: string | null };

function buildAssigneeMap(
	ratesList: Rate[],
	missing: MissingAssigneeRow[],
	members: WorkspaceMemberRow[],
	rate: Rate | null,
	preset: RatePresetAssignee | null | undefined,
): Map<string, AssigneeRow> {
	const m = new Map<string, AssigneeRow>();
	for (const member of members) {
		m.set(member.id, {
			id: member.id,
			name: member.name ?? member.id,
			email: member.email,
		});
	}
	for (const r of ratesList) {
		if (!m.has(r.assigneeId)) {
			m.set(r.assigneeId, {
				id: r.assigneeId,
				name: r.assigneeName ?? r.assigneeId,
				email: r.assigneeEmail,
			});
		}
	}
	for (const row of missing) {
		if (!m.has(row.userId)) {
			m.set(row.userId, {
				id: row.userId,
				name: row.userName,
				email: row.userEmail || null,
			});
		}
	}
	if (preset?.assigneeId && !m.has(preset.assigneeId)) {
		m.set(preset.assigneeId, {
			id: preset.assigneeId,
			name: preset.assigneeName ?? preset.assigneeId,
			email: preset.assigneeEmail,
		});
	}
	if (rate && !m.has(rate.assigneeId)) {
		m.set(rate.assigneeId, {
			id: rate.assigneeId,
			name: rate.assigneeName ?? rate.assigneeId,
			email: rate.assigneeEmail,
		});
	}
	return m;
}

export function RateModal({
	open,
	rate,
	presetAssignee,
	onClose,
}: RateModalProps) {
	const { data: allRates } = useRates();
	const { data: missingRaw } = useMissingRates();
	const { data: membersRaw } = useWorkspaceMembers();
	const createRate = useCreateRate();
	const updateRate = useUpdateRate();
	const deleteRate = useDeleteRate();

	const [assigneeId, setAssigneeId] = useState('');
	const [assigneeName, setAssigneeName] = useState('');
	const [assigneeEmail, setAssigneeEmail] = useState('');
	const [hourlyRateDollars, setHourlyRateDollars] = useState('');
	const [currency, setCurrency] = useState('USD');
	const [validFrom, setValidFrom] = useState('');
	const [validTo, setValidTo] = useState('');
	const [assigneePicker, setAssigneePicker] = useState('');
	const [manualAssignee, setManualAssignee] = useState(false);
	const [formError, setFormError] = useState('');
	/** True only when "new rate" opened with zero assignee options (map still loading). */
	const newRateStartedWithEmptyAssigneeList = useRef(false);

	const ratesList = parseRatesListResponse(allRates ?? []);
	const missingList = (missingRaw as MissingAssigneeRow[] | undefined) ?? [];
	const membersList = (membersRaw as WorkspaceMemberRow[] | undefined) ?? [];

	const assigneeMap = useMemo(
		() => buildAssigneeMap(ratesList, missingList, membersList, rate, presetAssignee),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ratesList, missingList, membersList, rate, presetAssignee],
	);

	const assigneeSelectOptions = useMemo(() => {
		const rows = Array.from(assigneeMap.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		const opts = rows.map((a) => ({
			value: a.id,
			label: a.email ? `${a.name} · ${a.email}` : `${a.name} · ${a.id}`,
		}));
		if (!rate) {
			opts.push({ value: MANUAL_VALUE, label: 'Enter assignee manually…' });
		}
		return opts;
	}, [assigneeMap, rate]);

	const currencyOptions = useMemo(
		() =>
			[
				{ value: 'USD', label: 'USD' },
				{ value: 'EUR', label: 'EUR' },
				{ value: 'GBP', label: 'GBP' },
				{ value: 'AUD', label: 'AUD' },
			] as { value: string; label: string }[],
		[],
	);

	useEffect(() => {
		if (!open) {
			newRateStartedWithEmptyAssigneeList.current = false;
			return;
		}
		if (rate) {
			newRateStartedWithEmptyAssigneeList.current = false;
			setAssigneeId(rate.assigneeId);
			setAssigneeName(rate.assigneeName ?? '');
			setAssigneeEmail(rate.assigneeEmail ?? '');
			setHourlyRateDollars(String(rate.hourlyRateCents / 100));
			setCurrency(rate.currency ?? 'USD');
			setValidFrom(rate.validFrom ? rate.validFrom.slice(0, 10) : '');
			setValidTo(rate.validTo ? rate.validTo.slice(0, 10) : '');
			setAssigneePicker(rate.assigneeId);
			setManualAssignee(false);
		} else {
			newRateStartedWithEmptyAssigneeList.current = false;
			setHourlyRateDollars('');
			setCurrency('USD');
			setValidFrom('');
			setValidTo('');
			if (presetAssignee?.assigneeId) {
				setAssigneeId(presetAssignee.assigneeId);
				setAssigneeName(presetAssignee.assigneeName ?? '');
				setAssigneeEmail(presetAssignee.assigneeEmail ?? '');
				setAssigneePicker(presetAssignee.assigneeId);
				setManualAssignee(false);
			} else {
				setAssigneeId('');
				setAssigneeName('');
				setAssigneeEmail('');
				const firstReal = assigneeSelectOptions.find((o) => o.value !== MANUAL_VALUE);
				if (firstReal) {
					const row = assigneeMap.get(firstReal.value);
					if (row) {
						setAssigneeId(row.id);
						setAssigneeName(row.name);
						setAssigneeEmail(row.email ?? '');
					}
					setAssigneePicker(firstReal.value);
					setManualAssignee(false);
				} else {
					newRateStartedWithEmptyAssigneeList.current = true;
					setAssigneePicker(MANUAL_VALUE);
					setManualAssignee(true);
				}
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, rate?.id, presetAssignee?.assigneeId]);

	/** If the assignee list was empty on open and loads later, pick the first assignee (not user-chosen manual). */
	useEffect(() => {
		if (!newRateStartedWithEmptyAssigneeList.current) return;
		if (!open || rate || presetAssignee?.assigneeId) return;
		const firstReal = assigneeSelectOptions.find((o) => o.value !== MANUAL_VALUE);
		if (!firstReal) return;
		const row = assigneeMap.get(firstReal.value);
		if (!row) return;
		if (assigneeId || assigneeName || assigneeEmail) return;
		newRateStartedWithEmptyAssigneeList.current = false;
		setManualAssignee(false);
		setAssigneePicker(firstReal.value);
		setAssigneeId(row.id);
		setAssigneeName(row.name);
		setAssigneeEmail(row.email ?? '');
	}, [
		open,
		rate,
		presetAssignee?.assigneeId,
		assigneeSelectOptions,
		assigneeMap,
		assigneeId,
		assigneeName,
		assigneeEmail,
	]);

	function applyAssigneeFromPicker(value: string) {
		if (value === MANUAL_VALUE) {
			newRateStartedWithEmptyAssigneeList.current = false;
			setManualAssignee(true);
			setAssigneePicker(MANUAL_VALUE);
			return;
		}
		newRateStartedWithEmptyAssigneeList.current = false;
		setManualAssignee(false);
		setAssigneePicker(value);
		const row = assigneeMap.get(value);
		if (row) {
			setAssigneeId(row.id);
			setAssigneeName(row.name);
			setAssigneeEmail(row.email ?? '');
		}
	}

	// Closed-closed `[from, to]` to match the cost calculator. Whichever rate
	// has the later validFrom wins on overlap, but we still warn so the user
	// can fix it before saving rather than discovering misattributed costs.
	const hasOverlap =
		validFrom.length > 0 &&
		ratesList.some((r) => {
			if (rate && r.id === rate.id) return false;
			if (r.assigneeId !== assigneeId) return false;
			const from = new Date(r.validFrom);
			const to = r.validTo ? new Date(r.validTo) : null;
			const check = new Date(validFrom);
			return check >= from && (to === null || check <= to);
		});

	const isPending = createRate.isPending || updateRate.isPending;
	const isNew = !rate;

	function handleSave() {
		// Surface validation instead of silently no-op'ing the Save button.
		if (!assigneeId) { setFormError('Select an assignee.'); return; }
		if (!validFrom) { setFormError('Set a "valid from" date.'); return; }
		const parsed = parseFloat(hourlyRateDollars);
		if (isNaN(parsed) || parsed < 0) { setFormError('Enter a valid hourly rate.'); return; }
		setFormError('');
		const hourlyRateCents = Math.round(parsed * 100);
		const payload = {
			assigneeId,
			assigneeName: assigneeName || null,
			assigneeEmail: assigneeEmail || null,
			currency,
			hourlyRateCents,
			validFrom,
			validTo: validTo || null,
		};
		if (rate) {
			updateRate.mutate(
				{ id: rate.id, data: payload },
				{ onSuccess: () => onClose() },
			);
		} else {
			createRate.mutate(payload, { onSuccess: () => onClose() });
		}
	}

	function handleDelete() {
		if (!rate) return;
		if (!window.confirm('Delete this rate? This cannot be undone.')) return;
		deleteRate.mutate(rate.id, { onSuccess: () => onClose() });
	}

	const footer = (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'flex-end',
				gap: 8,
				flexWrap: 'wrap',
			}}
		>
			{rate && (
				<Button
					variant="ghost"
					size="sm"
					icon={<Trash2 size={13} strokeWidth={2} />}
					onClick={handleDelete}
					loading={deleteRate.isPending}
					style={{ marginRight: 'auto', color: 'var(--red)' }}
				>
					Delete
				</Button>
			)}
			{formError && (
				<span style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }} role="alert">
					{formError}
				</span>
			)}
			<Button variant="default" onClick={onClose}>
				Cancel
			</Button>
			<Button
				variant="accent"
				onClick={handleSave}
				loading={isPending}
				icon={<Check size={13} strokeWidth={2} />}
			>
				{isNew ? 'Create rate' : 'Save changes'}
			</Button>
		</div>
	);

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={isNew ? 'New rate' : 'Edit rate'}
			subtitle={
				isNew
					? 'Add a new effective rate for an assignee.'
					: 'Update an existing rate.'
			}
			width={480}
			footer={footer}
		>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
				{rate ? (
					<>
						<Field label="Assignee">
							<Select
								fullWidth
								size="md"
								value={assigneePicker}
								onChange={() => undefined}
								options={assigneeSelectOptions.filter((o) => o.value !== MANUAL_VALUE)}
								disabled
							/>
						</Field>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
							<Field label="Name">
								<Input
									value={assigneeName}
									onChange={(e) => setAssigneeName(e.target.value)}
									placeholder="Display name"
								/>
							</Field>
							<Field label="Email">
								<Input
									value={assigneeEmail}
									onChange={(e) => setAssigneeEmail(e.target.value)}
									placeholder="Email"
									type="email"
								/>
							</Field>
						</div>
					</>
				) : (
					<>
						<Field label="Assignee">
							<Select
								fullWidth
								size="md"
								value={manualAssignee ? MANUAL_VALUE : assigneePicker}
								onChange={(v) => applyAssigneeFromPicker(v)}
								options={assigneeSelectOptions}
								placeholder="Choose assignee"
							/>
						</Field>
						{manualAssignee && (
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 12,
									padding: 12,
									borderRadius: 8,
									border: '1px solid var(--border-soft)',
									background: 'var(--muted-bg)',
								}}
							>
								<Field label="Assignee ID" required>
									<Input
										value={assigneeId}
										onChange={(e) => setAssigneeId(e.target.value)}
										placeholder="ClickUp member ID"
									/>
								</Field>
								<Field label="Name">
									<Input
										value={assigneeName}
										onChange={(e) => setAssigneeName(e.target.value)}
										placeholder="Display name (optional)"
									/>
								</Field>
								<Field label="Email">
									<Input
										value={assigneeEmail}
										onChange={(e) => setAssigneeEmail(e.target.value)}
										placeholder="Email (optional)"
										type="email"
									/>
								</Field>
							</div>
						)}
					</>
				)}

				<div
					style={{
						display: 'grid',
						gridTemplateColumns: '1fr 110px',
						gap: 10,
					}}
				>
					<Field label="Hourly rate">
						<Input
							type="number"
							step={0.5}
							value={hourlyRateDollars}
							onChange={(e) => setHourlyRateDollars(e.target.value)}
							placeholder="e.g. 75"
							icon={<DollarSign size={14} strokeWidth={2} />}
						/>
					</Field>
					<Field label="Currency">
						<Select
							fullWidth
							size="md"
							value={currency}
							onChange={setCurrency}
							options={currencyOptions}
						/>
					</Field>
				</div>

				<div
					style={{
						display: 'grid',
						gridTemplateColumns: '1fr 1fr',
						gap: 10,
					}}
				>
					<Field label="Effective from" hint="Inclusive">
						<Input
							type="date"
							value={validFrom}
							onChange={(e) => setValidFrom(e.target.value)}
						/>
					</Field>
					<Field label="Effective to" hint="Leave blank for ongoing">
						<Input
							type="date"
							value={validTo}
							onChange={(e) => setValidTo(e.target.value)}
						/>
					</Field>
				</div>

				<Callout tone="blue" icon={<Info size={13} strokeWidth={2} />}>
					Rates use inclusive date ranges:{' '}
					<code
						style={{
							fontFamily: 'ui-monospace, monospace',
							fontSize: 12,
						}}
					>
						[from, to]
					</code>
					. Both endpoints count — a rate ending Dec 31 covers Dec 31 entries.
					Set the next rate&apos;s &quot;Effective from&quot; to Jan 1 to keep
					a clean handoff with no overlap.
				</Callout>

				{hasOverlap && (
					<Callout tone="amber" icon={<AlertTriangle size={13} strokeWidth={2} />}>
						The &quot;Effective from&quot; date falls within an existing rate range
						for this assignee. Review for overlaps before saving.
					</Callout>
				)}
			</div>
		</Modal>
	);
}
