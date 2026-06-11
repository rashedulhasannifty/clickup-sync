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

describe('WebhookParserService.parse — fingerprint (dedupe key)', () => {
  const svc = new WebhookParserService();

  it('tier 1: uses the history-item id when present (id:<eventId>)', () => {
    const out = svc.parse({ event: 'taskUpdated', task_id: 't1', history_items: [{ id: 'hist_99' }] });
    expect(out.fingerprint).toBe('id:hist_99');
  });

  it('tier 1: falls back to event_id then top-level id', () => {
    expect(svc.parse({ event: 'taskUpdated', event_id: 'ev_7' }).fingerprint).toBe('id:ev_7');
    expect(svc.parse({ event: 'taskUpdated', id: 'top_3' }).fingerprint).toBe('id:top_3');
  });

  it('tier 2: no event id but taskId+eventType present → event:<type>:<taskId>:<date>', () => {
    const out = svc.parse({ event: 'taskTimeTrackedUpdated', task_id: 'abc', date: '1716470400000' });
    expect(out.fingerprint).toBe('event:taskTimeTrackedUpdated:abc:1716470400000');
  });

  it('tier 3: nothing identifying → hash:<sha256>', () => {
    const out = svc.parse({ something: 'random' });
    expect(out.fingerprint).toMatch(/^hash:[0-9a-f]{64}$/);
  });

  it('distinct events get distinct fingerprints (no accidental collision → no lost events)', () => {
    const a = svc.parse({ event: 'taskUpdated', task_id: 't1', history_items: [{ id: 'h1' }] });
    const b = svc.parse({ event: 'taskUpdated', task_id: 't1', history_items: [{ id: 'h2' }] });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe('WebhookParserService.parse — taskId + loggedUserId extraction', () => {
  const svc = new WebhookParserService();

  it('extracts taskId from the various payload shapes', () => {
    expect(svc.parse({ task_id: 'a' }).taskId).toBe('a');
    expect(svc.parse({ data: { task_id: 'b' } }).taskId).toBe('b');
    expect(svc.parse({ history_items: [{ task_id: 'c' }] }).taskId).toBe('c');
  });

  it('unwraps a nested { body } envelope', () => {
    const out = svc.parse({ body: { event: 'taskUpdated', task_id: 'wrapped' } });
    expect(out.eventType).toBe('taskUpdated');
    expect(out.taskId).toBe('wrapped');
  });

  it('captures loggedUserId from history_items[0].user.id (the assignee for time-entry sync), coerced to string', () => {
    const out = svc.parse({ event: 'taskTimeTrackedUpdated', task_id: 't', history_items: [{ id: 'h', user: { id: 778899 } }] });
    expect(out.loggedUserId).toBe('778899');
    expect(typeof out.loggedUserId).toBe('string');
  });

  it('loggedUserId is null when no logging user is present', () => {
    expect(svc.parse({ event: 'taskUpdated', task_id: 't', history_items: [{ id: 'h' }] }).loggedUserId).toBeNull();
  });
});
