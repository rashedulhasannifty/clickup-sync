import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { adminApi } from '../api/admin';
import { reportsApi } from '../api/reports';
import { fmt } from '../lib/formatters';

/**
 * Confirms a chargeability change before it happens — required on every route
 * that sets the flag. The counts come from the server: a Tasks row carries
 * ClickUp's rolled-up `time_spent`, not our own entry count.
 */
export function ChargeableConfirmModal({
  taskIds, chargeable, onClose,
}: { taskIds: string[]; chargeable: boolean; onClose: (changed: boolean) => void }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['chargeable-preview', taskIds, chargeable],
    queryFn: () => reportsApi.chargeablePreview(taskIds, chargeable),
  });

  const apply = useMutation({
    mutationFn: () => adminApi.setTasksChargeable(taskIds, chargeable),
    onSuccess: () => {
      // Cost, hours and the flag itself all move — drop every report cache
      // rather than trying to enumerate which ones are stale.
      qc.invalidateQueries();
      onClose(true);
    },
  });

  const label = chargeable ? 'chargeable' : 'non-chargeable';
  const p = preview.data;

  // The title is the first thing read, so it must never claim a count we
  // don't actually know yet: while the preview is loading or failed, it
  // stays count-free; once it resolves, it leads with `changing` (how many
  // would ACTUALLY flip), never `taskIds.length` (how many are selected) —
  // those two numbers can differ whenever some selected tasks already match.
  const title = p
    ? `Mark ${fmt.number(p.changing)} task${p.changing === 1 ? '' : 's'} ${label}?`
    : `Mark selected tasks ${label}?`;

  // Three states must all keep the confirm button disabled, each for its own
  // reason: still loading (don't know the count yet), errored (couldn't get
  // the count at all), or loaded with changing === 0 (there is nothing to do).
  const confirmDisabled = apply.isPending || preview.isLoading || preview.isError || !p || p.changing === 0;

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button
            variant="default"
            loading={apply.isPending}
            disabled={confirmDisabled}
            onClick={() => apply.mutate()}
          >
            {`Mark ${label}`}
          </Button>
        </>
      }
    >
      {preview.isLoading && <p style={{ color: 'var(--text-muted)' }}>Checking what this affects…</p>}
      {preview.isError && (
        <p style={{ color: 'var(--red, var(--text))', fontSize: 12 }}>
          Could not load the preview. Try again.
        </p>
      )}
      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <p>
            <strong>{fmt.number(p.changing)}</strong> of {fmt.number(p.tasks)} task
            {p.tasks === 1 ? '' : 's'} will change · <strong>{fmt.number(p.timeEntries)}</strong> time
            {' '}entr{p.timeEntries === 1 ? 'y' : 'ies'} · <strong>{fmt.hours(p.hours)}</strong>
          </p>
          {p.changing === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              Every selected task is already {label}. Nothing to do.
            </p>
          )}
          {p.changing > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              {chargeable
                ? 'Their time moves to Chargeable in all reports and its cost is calculated from assignee rates again.'
                : 'Their time moves to Non-chargeable in all reports and its cost becomes zero.'}
              {' '}Any assignee with their own chargeability rule on a task keeps that rule instead.
              {' '}Costs are recalculated in the background.
            </p>
          )}
        </div>
      )}
      {apply.isError && (
        <p style={{ color: 'var(--red, var(--text))', fontSize: 12 }}>Could not apply the change. Try again.</p>
      )}
    </Modal>
  );
}
