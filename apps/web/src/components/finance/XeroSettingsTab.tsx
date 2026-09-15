import { useEffect, useState } from 'react';
import { AlertTriangle, CircleCheck, Link2, Lock, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { Callout } from '../ui/Callout';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useConnectXero, useDisconnectXero, useXeroStatus, useXeroSyncNow } from '../../hooks/useFinance';
import { fmt } from '../../lib/formatters';
import type { XeroEntityState } from '../../api/finance';

export type XeroFlash = { result: 'connected' | 'error'; reason?: string } | null;

/** Axios-style error → response.data.message, without `any`. */
function apiErrorMessage(e: unknown): string | undefined {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
}

/** Copy for the ?xero=error&reason= codes produced by XeroAuthService.handleCallback. */
const REASONS: Record<string, string> = {
  cancelled: "The Xero consent screen was cancelled, so nothing was saved. Select Connect to Xero to try again.",
  state: 'That connect link expired or was already used. Start again from this page.',
  exchange: "Xero didn't finish the sign-in. Try again. If it keeps failing, check that the redirect URI on the Xero app matches exactly.",
  no_tenant: 'No Xero organisation was chosen. On the Xero screen, pick your organisation.',
  multiple_tenants: 'More than one organisation was chosen. Clicksy supports one. Reconnect and pick just one.',
  different_org: "That's a different Xero organisation from the one already synced. Mixing two sets of books isn't allowed. See the OPERATIONS runbook to switch organisations.",
  xero_error: 'Xero returned an error. Try again in a minute.',
};

const ENTITY_LABELS: Record<string, string> = {
  contacts: 'Contacts', invoices: 'Invoices & bills', creditNotes: 'Credit notes', bankTransactions: 'Bank transactions',
  payments: 'Payments', attachments: 'Attachment lists',
};

function XeroMark({ size = 44 }: { size?: number }) {
  return (
    <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: '#13B5EA', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.48, flexShrink: 0 }}>
      x
    </div>
  );
}

function entityPill(s: XeroEntityState) {
  if (s.status === 'RUNNING') return <Pill tone="blue">Syncing</Pill>;
  if (s.status === 'OK') return <Pill tone="green">Up to date</Pill>;
  if (s.status === 'RATE_LIMITED') return <Pill tone="amber">Paused · daily limit</Pill>;
  if (s.status === 'NEEDS_RECONNECT') return <Pill tone="red">Paused</Pill>;
  if (s.status === 'FAILED') return <Pill tone="red">Failed · retrying</Pill>;
  return <Pill tone="gray">Queued</Pill>;
}

export function XeroSettingsTab({ flash, onFlashShown }: { flash: XeroFlash; onFlashShown: () => void }) {
  const { hasRole } = useAuth();
  const isOwner = hasRole('OWNER');
  const toast = useToast();
  const status = useXeroStatus();
  const connect = useConnectXero();
  const disconnect = useDisconnectXero();
  const syncNow = useXeroSyncNow();
  const [banner] = useState<XeroFlash>(flash); // keep the banner after the URL param is cleared
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!flash) return;
    if (flash.result === 'connected') toast.show('Connected to Xero. The first sync has started.', 'green');
    onFlashShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = status.data;
  if (status.isLoading || !s) return <Card><div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading Xero status…</div></Card>;

  if (!s.configured) {
    return (
      <Callout tone="neutral" icon={<Lock size={13} />}>
        Xero isn't configured on this server. Set <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code>, register the redirect URI{' '}
        <code>{s.redirectUri}</code> on the Xero app, then restart the backend.
      </Callout>
    );
  }

  const errorBanner = banner?.result === 'error' && (
    <Callout tone="red" icon={<AlertTriangle size={13} />}>
      <b>Xero didn't finish connecting.</b> {REASONS[banner.reason ?? ''] ?? REASONS.xero_error}
    </Callout>
  );
  const viewOnly = !isOwner && (
    <Callout tone="amber" icon={<Lock size={13} />}>
      <b>View only.</b> Only an Owner can connect or disconnect Xero. You can still see sync status and use the Finance page.
    </Callout>
  );
  const connectBtn = (label: string) => (
    <Button variant="accent" size="lg" icon={<Link2 size={15} />} loading={connect.isPending} disabled={!isOwner || !s.encryptionEnabled}
      onClick={() => connect.mutate(undefined, { onError: (e: unknown) => toast.show(apiErrorMessage(e) ?? "Couldn't start the Xero connection.", 'red') })}>
      {label}
    </Button>
  );

  if (s.status === 'DISCONNECTED') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {viewOnly}
        {errorBanner}
        {!s.encryptionEnabled && (
          <Callout tone="amber" icon={<AlertTriangle size={13} />}>
            <code>APP_ENCRYPTION_KEY</code> isn't set, so the Xero sign-in can't be stored securely. Set it and restart the backend before connecting.
          </Callout>
        )}
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 18 }}>
            <XeroMark size={52} />
            <div>
              <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>Connect your Xero organisation</h2>
              <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', maxWidth: '60ch' }}>
                Bring every client's invoices, supplier bills and bank spending into Clicksy. The data is copied on a schedule, so the Finance
                page loads instantly and Grafana can report on it.
              </p>
              <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 18px' }}>
                {[
                  ['Contacts', 'Customers and suppliers, with balances'],
                  ['Invoices, bills & credit notes', 'Including line items and tax'],
                  ['Spend & receive money', 'Bank transactions and reconciliation state'],
                  ['Payments & attachment names', 'Files stay in Xero; we only link to them'],
                ].map(([t, sub]) => (
                  <li key={t} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border-soft)', fontSize: 13 }}>
                    {t}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {connectBtn('Connect to Xero')}
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>You'll sign in on Xero and choose the organisation.</span>
              </div>
              <p style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0' }}>
                <ShieldCheck size={14} /> <span><b style={{ color: 'var(--text)' }}>Read-only.</b> Clicksy can't create, edit or delete anything in Xero. The Xero sign-in is stored encrypted.</span>
              </p>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '18px 0 8px' }}>Permissions requested</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.scopes.map((sc) => (
                  <code key={sc} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: 'var(--muted-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-soft)' }}>{sc}</code>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const needsReconnect = s.status === 'NEEDS_RECONNECT';
  const firstSync = s.syncing && s.entities.every((e) => !e.lastSuccessAt);
  const pill = needsReconnect ? <Pill tone="red">Needs reconnect</Pill> : firstSync ? <Pill tone="blue">First sync running</Pill> : <Pill tone="green">Connected</Pill>;
  const used = s.dayCallsRemaining == null ? null : 5000 - s.dayCallsRemaining;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {viewOnly}
      {errorBanner}
      {needsReconnect && (
        <Callout tone="red" icon={<AlertTriangle size={13} />}>
          <b>Xero stopped accepting our connection.</b> This happens if someone removed the app in Xero, or the sign-in went unused for 60 days.
          Synced data is kept. Reconnect with the same organisation to carry on. {isOwner && <span style={{ marginLeft: 8 }}>{connectBtn('Reconnect')}</span>}
        </Callout>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title={s.tenantName ?? 'Xero organisation'} subtitle={`Connected ${s.connectedAt ? fmt.relative(s.connectedAt) : ''}${s.connectedByEmail ? ` by ${s.connectedByEmail}` : ''}`} action={pill}>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '8px 16px', fontSize: 13, margin: 0 }}>
              <dt style={{ color: 'var(--text-muted)' }}>Base currency</dt><dd style={{ margin: 0 }}>{s.baseCurrency ?? '—'}</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Tenant ID</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, overflowWrap: 'anywhere' }}>{s.tenantId}</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Access</dt><dd style={{ margin: 0 }}>Read-only · {s.scopes.length} permissions</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Callback URL</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, overflowWrap: 'anywhere' }}>{s.redirectUri}</dd>
            </dl>
          </Card>
          <Card
            title="Data sync"
            subtitle={firstSync ? 'Copying everything from Xero for the first time.' : 'Changes are pulled every hour. Unpaid invoices and balances are re-checked nightly at 02:00 (Dhaka).'}
            action={
              <Button size="sm" icon={<RefreshCw size={14} />} loading={syncNow.isPending} disabled={needsReconnect || s.syncing}
                onClick={() => syncNow.mutate(undefined, {
                  onSuccess: () => toast.show('Sync queued.', 'green'),
                  onError: (e: unknown) => toast.show(apiErrorMessage(e) ?? "Couldn't start a sync.", 'red'),
                })}>
                {s.syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            }
          >
            {s.entities.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Waiting for the first sync to start…</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ textAlign: 'left', padding: '0 0 8px' }}>Data</th><th style={{ textAlign: 'right' }}>Records</th>
                    <th style={{ textAlign: 'left', paddingLeft: 16 }}>Last success</th><th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.entities.map((e) => (
                    <tr key={e.entity} style={{ borderTop: '1px solid var(--border-soft)' }} title={e.lastError ?? undefined}>
                      <td style={{ padding: '9px 0', fontWeight: 500 }}>{ENTITY_LABELS[e.entity] ?? e.entity}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(e.recordsUpserted)}</td>
                      <td style={{ paddingLeft: 16, color: 'var(--text-muted)' }}>{e.lastSuccessAt ? fmt.relative(e.lastSuccessAt) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{entityPill(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Connection health">
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '8px 16px', fontSize: 13, margin: 0 }}>
              <dt style={{ color: 'var(--text-muted)' }}>Sign-in renewed</dt>
              <dd style={{ margin: 0, textAlign: 'right', color: needsReconnect ? 'var(--red)' : undefined }}>
                {needsReconnect ? 'Rejected by Xero' : s.refreshedAt ? fmt.relative(s.refreshedAt) : '—'}
              </dd>
              <dt style={{ color: 'var(--text-muted)' }}>API calls today</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{used == null ? '—' : `${fmt.number(used)} of 5,000`}</dd>
            </dl>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
              Xero allows 60 calls a minute and 5,000 a day. Syncs pace themselves and pause when fewer than 500 calls remain.
            </p>
          </Card>
          <Card title="Disconnect" subtitle="Stops syncing and deletes the stored Xero sign-in. Data already copied stays in Finance.">
            <Button variant="danger" icon={<Unplug size={14} />} disabled={!isOwner} onClick={() => setConfirmOpen(true)}>Disconnect Xero</Button>
          </Card>
        </div>
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Disconnect Xero?"
        subtitle="Syncing stops and the stored Xero sign-in is deleted. Contacts and transactions already copied stay in Finance and reports. You can reconnect any time."
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmOpen(false)}>Keep connected</Button>
            <Button variant="danger" icon={<Unplug size={14} />} loading={disconnect.isPending}
              onClick={() => disconnect.mutate(undefined, { onSuccess: () => { setConfirmOpen(false); toast.show('Xero disconnected.', 'green'); } })}>
              Disconnect
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}><CircleCheck size={14} /> Nothing in Xero is changed.</div>
      </Modal>
    </div>
  );
}
