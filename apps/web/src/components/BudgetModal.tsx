import { useState, useEffect } from 'react';
import { Check, DollarSign } from 'lucide-react';
import { type Budget } from '../api/budgets';
import { Modal } from './ui/Modal';
import { Field } from './ui/Field';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

interface BudgetModalProps {
	open: boolean;
	/** When present, edit mode (prefill); when null/absent, create mode */
	initial?: Budget | null;
	/** Options for the client autocomplete datalist */
	clientOptions: string[];
	/** Pre-populate the client field in create mode (ignored when initial is set) */
	presetClient?: string;
	onClose: () => void;
	onSubmit: (data: {
		client: string;
		monthlyAmountCents: number;
		currency: string;
		validFrom: string;
		validTo: string | null;
		notes: string | null;
	}) => void;
	/** Disables the submit button while a mutation is in flight */
	submitting?: boolean;
}

export function BudgetModal({
	open,
	initial,
	clientOptions,
	presetClient,
	onClose,
	onSubmit,
	submitting,
}: BudgetModalProps) {
	const [client, setClient] = useState('');
	const [monthlyAmountDollars, setMonthlyAmountDollars] = useState('');
	const [currency, setCurrency] = useState('USD');
	const [validFrom, setValidFrom] = useState('');
	const [validTo, setValidTo] = useState('');
	const [notes, setNotes] = useState('');
	const [formError, setFormError] = useState('');

	const isNew = !initial;

	useEffect(() => {
		if (!open) return;
		if (initial) {
			setClient(initial.client);
			setMonthlyAmountDollars(String(initial.monthlyAmountCents / 100));
			setCurrency(initial.currency ?? 'USD');
			setValidFrom(initial.validFrom ? initial.validFrom.slice(0, 10) : '');
			setValidTo(initial.validTo ? initial.validTo.slice(0, 10) : '');
			setNotes(initial.notes ?? '');
		} else {
			setClient(presetClient ?? '');
			setMonthlyAmountDollars('');
			setCurrency('USD');
			setValidFrom('');
			setValidTo('');
			setNotes('');
		}
		setFormError('');
	}, [open, initial, presetClient]);

	function handleSave() {
		if (!client.trim()) {
			setFormError('Enter a client name.');
			return;
		}
		if (!validFrom) {
			setFormError('Set a "valid from" date.');
			return;
		}
		const parsed = parseFloat(monthlyAmountDollars);
		if (monthlyAmountDollars === '' || isNaN(parsed) || parsed < 0) {
			setFormError('Enter a valid monthly amount.');
			return;
		}
		setFormError('');
		const monthlyAmountCents = Math.round(parsed * 100);
		onSubmit({
			client: client.trim(),
			monthlyAmountCents,
			currency: currency.trim() || 'USD',
			validFrom,
			validTo: validTo || null,
			notes: notes.trim() || null,
		});
	}

	const datalistId = 'budget-modal-client-options';

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
			{formError && (
				<span style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }} role="alert">
					{formError}
				</span>
			)}
			<Button type="button" variant="default" onClick={onClose}>
				Cancel
			</Button>
			<Button
				type="submit"
				variant="accent"
				loading={submitting}
				icon={<Check size={13} strokeWidth={2} />}
			>
				{isNew ? 'Create budget' : 'Save changes'}
			</Button>
		</div>
	);

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={isNew ? 'New budget' : 'Edit budget'}
			subtitle={
				isNew
					? 'Add a monthly budget for a client.'
					: 'Update an existing client budget.'
			}
			width={480}
			footer={footer}
			onSubmit={handleSave}
		>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
				<Field label="Client" required>
					<datalist id={datalistId}>
						{clientOptions.map((opt) => (
							<option key={opt} value={opt} />
						))}
					</datalist>
					<Input
						value={client}
						onChange={(e) => setClient(e.target.value)}
						placeholder="Client name"
						list={datalistId}
					/>
				</Field>

				<div
					style={{
						display: 'grid',
						gridTemplateColumns: '1fr 110px',
						gap: 10,
					}}
				>
					<Field label="Monthly amount">
						<Input
							type="number"
							step={0.01}
							min={0}
							value={monthlyAmountDollars}
							onChange={(e) => setMonthlyAmountDollars(e.target.value)}
							placeholder="e.g. 5000"
							icon={<DollarSign size={14} strokeWidth={2} />}
						/>
					</Field>
					<Field label="Currency">
						<Input
							value={currency}
							onChange={(e) => setCurrency(e.target.value)}
							placeholder="USD"
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

				<Field label="Notes">
					<textarea
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						placeholder="Optional notes"
						rows={3}
						style={{
							width: '100%',
							boxSizing: 'border-box',
							padding: '7px 10px',
							borderRadius: 6,
							border: '1px solid var(--border)',
							background: 'var(--input-bg, var(--surface))',
							color: 'var(--text)',
							fontSize: 13,
							fontFamily: 'inherit',
							resize: 'vertical',
							outline: 'none',
						}}
					/>
				</Field>
			</div>
		</Modal>
	);
}
