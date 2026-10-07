import { Check, Minus } from 'lucide-react';
import { Pill } from '../ui/Pill';
import type {
  AttendanceSource,
  Band,
  EmployeeLinks,
  EmployeeStatusValue,
  LeaveStatusValue,
  LeaveTypeValue,
  TodayState,
} from '../../api/people';
import {
  BAND_LABEL,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  STATUS_LABEL,
  TODAY_LABEL,
  bandTone,
  leaveStatusTone,
  leaveTypeTone,
  statusTone,
  todayTone,
} from '../../lib/people';

/**
 * Overall score with its band colour: "86 · On track", or "No data" when there
 * is no score. A partial score (not linked to ClickUp, so attendance only) is
 * neutral grey and says "Partial" — never a green "On track" it hasn't earned.
 */
export function ScoreBandPill({ score, band, partial = false }: { score: number | null; band: Band; partial?: boolean }) {
  if (partial) {
    return (
      <span title="Not linked to ClickUp — this score covers attendance only.">
        <Pill tone="gray" size="xs">
          {score == null ? 'Partial' : `${score} · Partial`}
        </Pill>
      </span>
    );
  }
  if (score == null) {
    return (
      <Pill tone="gray" size="xs">
        No data
      </Pill>
    );
  }
  return (
    <Pill tone={bandTone(band)} size="xs">
      {score} · {BAND_LABEL[band]}
    </Pill>
  );
}

export function TodayStatePill({ state }: { state: TodayState }) {
  return (
    <Pill tone={todayTone(state)} size="xs">
      {TODAY_LABEL[state]}
    </Pill>
  );
}

export function EmployeeStatusPill({ status }: { status: EmployeeStatusValue }) {
  return (
    <Pill tone={statusTone(status)} size="xs">
      {STATUS_LABEL[status]}
    </Pill>
  );
}

export function LeaveTypePill({ type }: { type: LeaveTypeValue }) {
  return (
    <Pill tone={leaveTypeTone(type)} size="xs">
      {LEAVE_TYPE_LABEL[type]}
    </Pill>
  );
}

export function LeaveStatusPill({ status }: { status: LeaveStatusValue }) {
  return (
    <Pill tone={leaveStatusTone(status)} size="xs">
      {LEAVE_STATUS_LABEL[status]}
    </Pill>
  );
}

/** Shown whenever the attendance rows came from the dummy provider, so nobody mistakes them for real door data. */
export function DemoDataBadge({ source }: { source: AttendanceSource | undefined }) {
  if (source !== 'dummy') return null;
  return (
    <span title="Attendance and leave on this page are generated demo data, not real office records.">
      <Pill tone="purple" size="xs">
        Demo data
      </Pill>
    </span>
  );
}

/** Whether the employee is linked to a ClickUp user (for KPIs) and a login account. */
export function LinkedIndicators({ linked }: { linked: EmployeeLinks }) {
  const item = (on: boolean, label: string, title: string) => (
    <span title={title}>
      <Pill tone={on ? 'green' : 'gray'} size="xs" icon={on ? <Check size={10} strokeWidth={3} /> : <Minus size={10} strokeWidth={3} />}>
        {label}
      </Pill>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {item(linked.clickup, 'ClickUp', linked.clickup ? 'Linked to a ClickUp user' : 'Not linked to ClickUp')}
      {item(linked.user, 'Login', linked.user ? 'Has a login account' : 'No login account')}
    </span>
  );
}
