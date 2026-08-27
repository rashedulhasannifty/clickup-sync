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

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={`Mark ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} ${label}?`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button
            variant="default"
            loading={apply.isPending}
            disabled={apply.isPending || preview.isLoading || p?.changing === 0}
            onClick={() => apply.mutate()}
          >
            {`Mark ${label}`}
          </Button>
        </>
      }
    >
      {preview.isLoading && <p style={{ color: 'var(--text-muted)' }}>Checking what this affects…</p>}
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
