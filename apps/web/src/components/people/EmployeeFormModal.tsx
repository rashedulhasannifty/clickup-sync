import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import type { CreateEmployeeBody, EmployeeProfile, UpdateEmployeeBody } from '../../api/people';
import { dhakaToday } from '../../lib/people';
import { monthsText } from '../../lib/appraisals';
import { FormRow } from './FormBits';

export type PickOption = { value: string; label: string };

type Values = {
  fullName: string;
  email: string;
  employeeCode: string;
  designation: string;
  grade: string;
  department: string;
  teamId: string;
  managerId: string;
  joinDate: string;
  clickupUserId: string;
  concernName: string;
  academicQualification: string;
  experienceBeforeJoiningMonths: string;
  startingSalary: string;
  grossSalary: string;
};

/** The whole-number fields: typed as text, sent as numbers. */
const NUMERIC = ['experienceBeforeJoiningMonths', 'startingSalary', 'grossSalary'] as const;
const WHOLE = /^\d+$/;
const num = (v: number | null | undefined) => (v == null ? '' : String(v));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialValues(e: EmployeeProfile | undefined): Values {
  return {
    fullName: e?.fullName ?? '',
    email: e?.email ?? '',
    employeeCode: e?.employeeCode ?? '',
    designation: e?.designation ?? '',
    grade: e?.grade ?? '',
    department: e?.department ?? '',
    teamId: e?.teamId ?? '',
    managerId: e?.managerId ?? '',
    joinDate: e?.joinDate ?? dhakaToday(),
    clickupUserId: e?.clickupUserId ?? '',
    concernName: e?.concernName ?? '',
    academicQualification: e?.academicQualification ?? '',
    experienceBeforeJoiningMonths: num(e?.experienceBeforeJoiningMonths),
    startingSalary: num(e?.startingSalary),
    grossSalary: num(e?.grossSalary),
  };
}

/** Create body: empty optionals are omitted, because the API rejects empty strings for them. */
function toCreateBody(v: Values): CreateEmployeeBody {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    fullName: v.fullName.trim(),
    email: v.email.trim(),
    designation: v.designation.trim(),
    joinDate: v.joinDate,
    employeeCode: opt(v.employeeCode),
    grade: opt(v.grade),
    department: opt(v.department),
    teamId: opt(v.teamId),
    managerId: opt(v.managerId),
    clickupUserId: opt(v.clickupUserId),
    concernName: opt(v.concernName),
    academicQualification: opt(v.academicQualification),
    ...Object.fromEntries(NUMERIC.filter((k) => v[k].trim()).map((k) => [k, Number(v[k].trim())])),
  };
}

/** Update body: only what changed; for the nullable fields an emptied input sends `null` to clear. */
function toUpdateBody(v: Values, initial: Values): UpdateEmployeeBody {
  const body: UpdateEmployeeBody = {};
  const changed = (k: keyof Values) => v[k].trim() !== initial[k].trim();
  if (changed('fullName')) body.fullName = v.fullName.trim();
  if (changed('email')) body.email = v.email.trim();
  if (changed('designation')) body.designation = v.designation.trim();
  if (v.joinDate !== initial.joinDate) body.joinDate = v.joinDate;
  if (changed('employeeCode')) body.employeeCode = v.employeeCode.trim() || null;
  if (changed('grade')) body.grade = v.grade.trim() || null;
  if (changed('department')) body.department = v.department.trim() || null;
  if (v.teamId !== initial.teamId) body.teamId = v.teamId || null;
  if (v.managerId !== initial.managerId) body.managerId = v.managerId || null;
  if (changed('clickupUserId')) body.clickupUserId = v.clickupUserId.trim() || null;
  if (changed('concernName')) body.concernName = v.concernName.trim() || null;
  if (changed('academicQualification')) body.academicQualification = v.academicQualification.trim() || null;
  for (const k of NUMERIC) if (changed(k)) body[k] = v[k].trim() ? Number(v[k].trim()) : null;
  return body;
}

/**
 * Create / edit an employee. Mount it only while open: the form state is
 * seeded once from `employee`, so a fresh mount is what resets it.
 * Status is deliberately not editable here; it moves through employment events.
 */
export function EmployeeFormModal({
  employee,
  teams,
  managers,
  pending,
  error,
  onClose,
  onCreate,
  onUpdate,
}: {
  /** Present: edit mode. Absent: create mode. */
  employee?: EmployeeProfile;
  teams: PickOption[];
  /** Candidate managers (the employee themselves is filtered out here). */
  managers: PickOption[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate?: (body: CreateEmployeeBody) => void;
  onUpdate?: (body: UpdateEmployeeBody) => void;
}) {
  const [initial] = useState(() => initialValues(employee));
  const [v, setV] = useState<Values>(initial);
  const [formError, setFormError] = useState('');
  const isEdit = !!employee;
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((p) => ({ ...p, [k]: val }));

  function submit() {
    if (!v.fullName.trim()) return setFormError('Enter the full name.');
    if (!EMAIL_RE.test(v.email.trim())) return setFormError('Enter a valid work email.');
    if (!v.designation.trim()) return setFormError('Enter a designation.');
    if (!v.joinDate) return setFormError('Set the join date.');
    if (v.clickupUserId.trim() && !/^\d+$/.test(v.clickupUserId.trim())) {
      return setFormError('ClickUp user id must be numeric.');
    }
    for (const k of NUMERIC) {
      if (v[k].trim() && !WHOLE.test(v[k].trim())) {
        return setFormError(k === 'experienceBeforeJoiningMonths' ? 'Experience must be a whole number of months.' : 'Salaries are whole taka (no decimals or commas).');
      }
    }
    setFormError('');
    if (isEdit) {
      const body = toUpdateBody(v, initial);
      if (Object.keys(body).length === 0) return onClose();
      onUpdate?.(body);
    } else {
      onCreate?.(toCreateBody(v));
    }
  }

  const message = formError || error;
  const teamOptions: PickOption[] = [{ value: '', label: 'No team' }, ...teams];
  const managerOptions: PickOption[] = [
    { value: '', label: 'No manager' },
    ...managers.filter((m) => m.value !== employee?.id),
  ];

  return (
    <Modal
      onClose={onClose}
      title={isEdit ? 'Edit profile' : 'Add employee'}
      subtitle={isEdit ? 'Status changes through employment events, not here.' : 'Creates the record and its “Joined” event.'}
      width={560}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {message && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {message}
            </span>
          )}
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={pending} icon={<Check size={13} strokeWidth={2} />}>
            {isEdit ? 'Save changes' : 'Add employee'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormRow>
          <Field label="Full name" required>
            <Input value={v.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Work email" required hint="Links the record to a login with the same email.">
            <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} maxLength={254} autoComplete="off" />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Designation" required>
            <Input value={v.designation} onChange={(e) => set('designation', e.target.value)} maxLength={120} placeholder="e.g. Senior Developer" />
          </Field>
          <Field label="Join date" required>
            <Input type="date" value={v.joinDate} onChange={(e) => set('joinDate', e.target.value)} />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Team">
            <Select fullWidth searchable options={teamOptions} value={v.teamId} onChange={(x) => set('teamId', x)} />
          </Field>
          <Field label="Manager">
            <Select fullWidth searchable options={managerOptions} value={v.managerId} onChange={(x) => set('managerId', x)} />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Department">
            <Input value={v.department} onChange={(e) => set('department', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Grade">
            <Input value={v.grade} onChange={(e) => set('grade', e.target.value)} maxLength={60} placeholder="e.g. L3" />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Employee code">
            <Input value={v.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} maxLength={50} />
          </Field>
          <Field
            label="ClickUp user id"
            hint={isEdit ? 'Clear it to unlink from ClickUp.' : 'Optional. Defaults to the linked login’s ClickUp id.'}
          >
            <Input
              inputMode="numeric"
              value={v.clickupUserId}
              onChange={(e) => set('clickupUserId', e.target.value)}
              placeholder="e.g. 3450636"
            />
          </Field>
        </FormRow>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>Appraisal form details</div>
        <FormRow>
          <Field label="Concern name" hint="The company within the group.">
            <Input value={v.concernName} onChange={(e) => set('concernName', e.target.value)} maxLength={200} />
          </Field>
          <Field label="Academic qualification">
            <Input value={v.academicQualification} onChange={(e) => set('academicQualification', e.target.value)} maxLength={300} placeholder="e.g. BSc in CSE" />
          </Field>
        </FormRow>
        <FormRow>
          <Field
            label="Experience before joining (months)"
            hint={WHOLE.test(v.experienceBeforeJoiningMonths.trim()) ? `${monthsText(Number(v.experienceBeforeJoiningMonths))}; total experience adds the tenure here.` : 'Total experience adds the tenure here.'}
          >
            <Input inputMode="numeric" value={v.experienceBeforeJoiningMonths} onChange={(e) => set('experienceBeforeJoiningMonths', e.target.value)} placeholder="e.g. 30" />
          </Field>
          <Field label="Starting salary (BDT)" hint="Whole taka. Owner/Admin only.">
            <Input inputMode="numeric" value={v.startingSalary} onChange={(e) => set('startingSalary', e.target.value)} placeholder="e.g. 50000" />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Present gross salary (BDT)" hint="Whole taka. An approved appraisal increment updates it.">
            <Input inputMode="numeric" value={v.grossSalary} onChange={(e) => set('grossSalary', e.target.value)} placeholder="e.g. 80000" />
          </Field>
          <div />
        </FormRow>
      </div>
    </Modal>
  );
}
