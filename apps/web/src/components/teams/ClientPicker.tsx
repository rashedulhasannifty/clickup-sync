import { useMemo, useState } from 'react';
import { ArrowRightLeft, Search, Square, SquareCheck } from 'lucide-react';
import type { ClientOption } from '../../api/teams';

export interface ClientPickerResult {
  optionIds: string[];
  /** True when the selection includes at least one option currently owned by
   *  another team — the caller must confirm before sending `move: true`. */
  move: boolean;
}

interface ClientGroup {
  /** Grouped by name: selecting "Acme" selects every option id sharing that name. */
  name: string;
  optionIds: string[];
  archived: boolean;
  ownedTeamId: string | null;
  ownedTeamName: string | null;
}

function buildGroups(options: ClientOption[], teamId: string | undefined, selected: Set<string>): ClientGroup[] {
  const byName = new Map<string, ClientOption[]>();
  for (const o of options) {
    // Non-archived only, plus archived options already on this team (so
    // existing history stays visible and removable).
    if (o.archived && !selected.has(o.optionId)) continue;
    const arr = byName.get(o.name) ?? [];
    arr.push(o);
    byName.set(o.name, arr);
  }
  return [...byName.entries()]
    .map(([name, opts]) => {
      const foreign = opts.find((o) => o.teamId && o.teamId !== teamId);
      return {
        name,
        optionIds: opts.map((o) => o.optionId),
        archived: opts.every((o) => o.archived),
        ownedTeamId: foreign?.teamId ?? null,
        ownedTeamName: foreign?.teamName ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Multi-select over `clickup_client_options`, grouped by name (a client can
 * have more than one option row — e.g. an archived one kept for history).
 * Options owned by another team render disabled with a "Move here" action
 * that stages them into the selection and flags the result as a move; the
 * caller (TeamsPage) is responsible for confirming before actually sending
 * `move: true` to `PUT /teams/:id/clients` — see that page's conflict flow.
 */
export function ClientPicker({
  options,
  teamId,
  value,
  onChange,
  allowMove = true,
}: {
  options: ClientOption[];
  /** The team being edited; omit for a not-yet-created team (no move support — the
   *  create endpoint has no `move` param, so foreign-owned clients must stay disabled). */
  teamId?: string;
  value: string[];
  onChange: (result: ClientPickerResult) => void;
  allowMove?: boolean;
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(value), [value]);
  const groups = useMemo(() => buildGroups(options, teamId, selected), [options, teamId, selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  function emit(nextIds: string[]) {
    const idSet = new Set(nextIds);
    const move = options.some((o) => idSet.has(o.optionId) && !!o.teamId && o.teamId !== teamId);
    onChange({ optionIds: nextIds, move });
  }

  function toggleGroup(g: ClientGroup) {
    const isSelected = g.optionIds.every((id) => selected.has(id));
    emit(isSelected ? value.filter((id) => !g.optionIds.includes(id)) : [...value, ...g.optionIds.filter((id) => !selected.has(id))]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <span
          style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-faint)', display: 'flex', pointerEvents: 'none',
          }}
        >
          <Search size={13} strokeWidth={1.75} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          aria-label="Search clients"
          className="input-3d"
          style={{
            width: '100%', height: 34, padding: '0 10px 0 30px', fontSize: 13,
            background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)',
            borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 280, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '16px 10px', fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>
            No matching clients
          </div>
        ) : (
          filtered.map((g) => {
            const checked = g.optionIds.every((id) => selected.has(id));
            const foreignBlocked = !!g.ownedTeamId && !checked;
            return (
              <div
                key={g.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderBottom: '1px solid var(--border-soft)', opacity: foreignBlocked ? 0.7 : 1,
                }}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={g.name}
                  disabled={foreignBlocked}
                  onClick={() => !foreignBlocked && toggleGroup(g)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
                    background: 'none', border: 0, padding: 0, textAlign: 'left', fontFamily: 'inherit',
                    cursor: foreignBlocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', flexShrink: 0, color: checked ? 'var(--accent)' : 'var(--text-faint)' }}>
                    {checked ? <SquareCheck size={15} strokeWidth={2} /> : <Square size={15} strokeWidth={2} />}
                  </span>
                  <span
                    style={{
                      fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', textDecoration: g.archived ? 'line-through' : 'none',
                    }}
                  >
                    {g.name}
                  </span>
                  {g.archived && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', flexShrink: 0 }}>archived</span>
                  )}
                </button>
                {foreignBlocked && (
                  <>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      owned by {g.ownedTeamName}
                    </span>
                    {allowMove && (
                      <button
                        type="button"
                        onClick={() => emit([...value, ...g.optionIds])}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
                          color: 'var(--accent-strong)', background: 'none', border: 0, cursor: 'pointer',
                          flexShrink: 0, padding: '2px 4px',
                        }}
                      >
                        <ArrowRightLeft size={11} strokeWidth={2} /> Move here
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
