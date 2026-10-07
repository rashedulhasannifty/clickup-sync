import { Pill } from '../ui/Pill';
import { EXIT_STATUS_LABEL, EXIT_STATUS_TONE, type ExitStatusValue } from '../../api/exits';

export function ExitStatusPill({ status, size = 'xs' }: { status: ExitStatusValue; size?: 'xs' | 'sm' }) {
  return (
    <Pill tone={EXIT_STATUS_TONE[status]} size={size}>
      {EXIT_STATUS_LABEL[status]}
    </Pill>
  );
}
