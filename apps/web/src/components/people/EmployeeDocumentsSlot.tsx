import { FileText } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

/**
 * Placeholder for the employee's Documents tab. Slice 2 (documents, stored in
 * MinIO) replaces the body of this component; keep the single `employeeId`
 * prop so the page that renders it does not change.
 */
export function EmployeeDocumentsSlot({ employeeId }: { employeeId: string }) {
  return (
    <Card>
      <div data-employee-id={employeeId}>
        <EmptyState
          icon={<FileText size={20} strokeWidth={1.5} />}
          title="Documents are coming"
          body="Contracts, ID copies and certificates will live here, with expiry reminders."
        />
      </div>
    </Card>
  );
}
