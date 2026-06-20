import { useNavigate } from 'react-router-dom';
import { Plug, DatabaseZap, DollarSign, Check, ArrowRight, Sparkles, Lock } from 'lucide-react';
import { Button } from './ui/Button';

export interface OnboardingStepsState {
  /** A webhook has been registered / events are arriving. */
  webhook: boolean;
  /** At least one task has been synced (a backfill ran). */
  backfill: boolean;
  /** Assignee rates exist so time can be costed. */
  rates: boolean;
}

interface StepDef {
  key: keyof OnboardingStepsState;
  title: string;
  body: string;
  cta: string;
  target: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  {
    key: 'webhook',
    title: 'Connect ClickUp & register the webhook',
    body: 'Add your API token and register the webhook so task and time changes stream in live.',
    cta: 'Open connection settings',
    target: '/settings',
    icon: <Plug size={16} strokeWidth={1.75} />,
  },
  {
    key: 'backfill',
    title: 'Run your first backfill',
    body: 'Pull existing tasks and tracked time for your spaces so the dashboards have history to show.',
    cta: 'Go to spaces',
    target: '/spaces',
    icon: <DatabaseZap size={16} strokeWidth={1.75} />,
  },
  {
    key: 'rates',
    title: 'Set assignee rates',
    body: 'Add hourly rates so tracked time is costed automatically and budgets light up.',
    cta: 'Manage rates',
    target: '/assignee-rates',
    icon: <DollarSign size={16} strokeWidth={1.75} />,
  },
];

/**
 * First-run guided checklist. Shown on the Overview when the workspace has no
 * synced data yet, instead of a dashboard full of zeros. Each step shows a
 * completion check when its precondition is met, and the first incomplete step
 * is highlighted as the suggested next action.
 *
 * The CTAs route to admin-gated pages (/settings, /spaces, /assignee-rates);
 * non-admins see a hint that an Owner/Admin needs to do the setup.
 */
export function Onboarding({ steps, canSetup }: { steps: OnboardingStepsState; canSetup: boolean }) {
  const navigate = useNavigate();
  const firstIncomplete = STEPS.findIndex((s) => !steps[s.key]);
  const doneCount = STEPS.filter((s) => steps[s.key]).length;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {/* Hero header with the accent gradient wash (matches MetricCard accent). */}
      <div style={{ position: 'relative', padding: '28px 24px 22px', borderBottom: '1px solid var(--border)' }}>
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, background: 'var(--accent-grad)', opacity: 0.07, pointerEvents: 'none' }}
        />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Sparkles size={22} strokeWidth={1.75} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              Let’s get your ClickUp data flowing
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
              No data has synced yet. Three quick steps and your dashboards come alive.
              {' '}
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{doneCount}/{STEPS.length} done.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {STEPS.map((s, i) => {
          const done = steps[s.key];
          const isNext = !done && i === firstIncomplete;
          return (
            <div
              key={s.key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px 24px',
                borderBottom: i < STEPS.length - 1 ? '1px solid var(--border-soft)' : 0,
                background: isNext ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              {/* Status node */}
              <span
                style={{
                  width: 30, height: 30, borderRadius: 9, flexShrink: 0, marginTop: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? 'var(--pill-green-bg)' : 'var(--muted-bg)',
                  color: done ? 'var(--pill-green-text)' : isNext ? 'var(--accent)' : 'var(--text-muted)',
                  border: isNext ? '1px solid var(--accent)' : '1px solid transparent',
                }}
              >
                {done ? <Check size={16} strokeWidth={2.5} /> : s.icon}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>
                    {s.title}
                  </span>
                  {isNext && (
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                      Next step
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
                  {s.body}
                </div>

                {!done && (
                  <div style={{ marginTop: 10 }}>
                    {canSetup ? (
                      <Button
                        size="sm"
                        variant={isNext ? 'primary' : 'subtle'}
                        onClick={() => navigate(s.target)}
                        icon={<ArrowRight size={13} strokeWidth={2} />}
                      >
                        {s.cta}
                      </Button>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-faint)' }}>
                        <Lock size={12} strokeWidth={1.75} /> An Owner or Admin needs to complete this
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
