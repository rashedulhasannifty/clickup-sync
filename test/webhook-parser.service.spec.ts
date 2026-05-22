import * as path from 'path';
import * as fs from 'fs';
import { WebhookParserService } from '../src/webhooks/webhook-parser.service';

const fixturePath = path.join(__dirname, 'fixtures', 'clickup-status-update.fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

describe('WebhookParserService.extractStatusChanges', () => {
  const svc = new WebhookParserService();

  it('emits one record per status history_item, ignoring non-status items', () => {
    const out = svc.extractStatusChanges(fixture);
    expect(out).toHaveLength(1);
    expect(out[0].before).toEqual({ status: 'open', color: '#94a3b8', type: 'open' });
    expect(out[0].after).toEqual({ status: 'in progress', color: '#3b82f6', type: 'custom' });
    expect(out[0].changedByUserId).toBe('12345');
    expect(out[0].changedByUserName).toBe('Rashedul Hasan');
    expect(out[0].occurredAt.getTime()).toBe(1716470400000);
  });

  it('coerces integer user.id to string', () => {
    const out = svc.extractStatusChanges(fixture);
    expect(typeof out[0].changedByUserId).toBe('string');
  });

  it('returns [] when history_items is missing', () => {
    expect(svc.extractStatusChanges({ event: 'taskStatusUpdated' })).toEqual([]);
  });

  it('returns [] when history_items is empty', () => {
    expect(svc.extractStatusChanges({ event: 'taskStatusUpdated', history_items: [] })).toEqual([]);
  });

  it('tolerates before or after missing (initial status assignment)', () => {
    const out = svc.extractStatusChanges({
      event: 'taskStatusUpdated',
      history_items: [{
        date: '1716470400000', field: 'status',
        user: { id: 9 }, before: null, after: { status: 'open' },
      }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].before).toBeNull();
    expect(out[0].after).toEqual({ status: 'open' });
  });
});
