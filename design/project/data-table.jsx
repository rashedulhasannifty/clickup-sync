// DataTable: sortable, paginated, column visibility
function DataTable({
  data,
  columns,
  rowKey = 'id',
  onRowClick,
  initialSort,
  pageSize: initialPageSize = 25,
  density: initialDensity,
  searchable = false,
  emptyState,
  stickyFirst = false,
}) {
  const [sort, setSort] = React.useState(initialSort || null);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const [page, setPage] = React.useState(0);
  const [hiddenCols, setHiddenCols] = React.useState({});
  const [colMenuOpen, setColMenuOpen] = React.useState(false);
  const colMenuRef = React.useRef(null);
  const tweaks = window.__appTweaks || {};
  const density = initialDensity || tweaks.density || 'compact';

  React.useEffect(() => {
    if (!colMenuOpen) return;
    const onClick = (e) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [colMenuOpen]);

  React.useEffect(() => { setPage(0); }, [data?.length, sort?.key, sort?.dir, pageSize]);

  const visibleCols = columns.filter(c => !hiddenCols[c.key]);

  const sorted = React.useMemo(() => {
    if (!sort) return data;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return data;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const accessor = col.sortAccessor || col.accessor || ((r) => r[sort.key]);
    return [...data].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [data, sort, columns]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const slice = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const rowH = density === 'compact' ? 36 : density === 'comfortable' ? 48 : 40;
  const headPad = density === 'compact' ? '8px 12px' : '10px 14px';
  const cellPad = density === 'compact' ? '6px 12px' : '10px 14px';

  const onSort = (col) => {
    if (col.sortable === false) return;
    setSort(s => {
      if (s?.key !== col.key) return { key: col.key, dir: 'asc' };
      if (s.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null;
    });
  };

  if (data.length === 0 && emptyState) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {emptyState}
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: visibleCols.reduce((s, c) => s + (c.width || 120), 0) }}>
          <thead>
            <tr style={{ background: 'var(--table-head-bg)' }}>
              {visibleCols.map((col, i) => (
                <th key={col.key} onClick={() => onSort(col)} style={{
                  padding: headPad, textAlign: col.align || 'left',
                  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  borderBottom: '1px solid var(--border)',
                  cursor: col.sortable === false ? 'default' : 'pointer',
                  userSelect: 'none', whiteSpace: 'nowrap',
                  position: stickyFirst && i === 0 ? 'sticky' : 'static',
                  left: stickyFirst && i === 0 ? 0 : 'auto',
                  background: stickyFirst && i === 0 ? 'var(--table-head-bg)' : undefined,
                  zIndex: stickyFirst && i === 0 ? 2 : 1,
                  width: col.width,
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start' }}>
                    {col.header}
                    {sort?.key === col.key && (sort.dir === 'asc' ? <Icons.ChevronUp size={12}/> : <Icons.ChevronDown size={12}/>)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, idx) => (
              <tr key={row[rowKey] ?? idx}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  height: rowH,
                  background: idx % 2 === 0 ? 'transparent' : 'var(--table-zebra)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--table-zebra)'; }}
              >
                {visibleCols.map((col, i) => {
                  const v = col.accessor ? col.accessor(row) : row[col.key];
                  return (
                    <td key={col.key} style={{
                      padding: cellPad, textAlign: col.align || 'left',
                      borderBottom: '1px solid var(--border-soft)',
                      verticalAlign: 'middle',
                      color: 'var(--text)',
                      whiteSpace: col.wrap ? 'normal' : 'nowrap',
                      maxWidth: col.maxWidth,
                      overflow: col.wrap ? 'visible' : 'hidden',
                      textOverflow: col.wrap ? 'clip' : 'ellipsis',
                      position: stickyFirst && i === 0 ? 'sticky' : 'static',
                      left: stickyFirst && i === 0 ? 0 : 'auto',
                      background: stickyFirst && i === 0 ? (idx % 2 === 0 ? 'var(--surface)' : 'var(--table-zebra)') : undefined,
                      zIndex: stickyFirst && i === 0 ? 1 : 0,
                    }}>
                      {col.cell ? col.cell(row, v) : (v ?? <span style={{ color: 'var(--text-faint)' }}>—</span>)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', borderTop: '1px solid var(--border)',
        fontSize: 12, color: 'var(--text-muted)', gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {total === 0 ? '0' : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)}`}
            </span> of <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 }}>{total}</span>
          </span>
          <Select size="sm" value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={[
            { value: '10', label: '10 / page' },
            { value: '25', label: '25 / page' },
            { value: '50', label: '50 / page' },
            { value: '100', label: '100 / page' },
          ]}/>
          <div ref={colMenuRef} style={{ position: 'relative' }}>
            <Button size="sm" variant="ghost" icon={<Icons.Sliders size={13}/>} onClick={() => setColMenuOpen(o => !o)}>
              Columns
            </Button>
            {colMenuOpen && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 20,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 6, minWidth: 180,
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
              }}>
                {columns.map(c => (
                  <label key={c.key} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 8px', fontSize: 12, color: 'var(--text)',
                    cursor: 'pointer', borderRadius: 5,
                  }}>
                    <input
                      type="checkbox"
                      checked={!hiddenCols[c.key]}
                      onChange={(e) => setHiddenCols(h => ({ ...h, [c.key]: !e.target.checked }))}
                    />
                    {c.headerLabel || (typeof c.header === 'string' ? c.header : c.key)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} icon={<Icons.ChevronLeft size={14}/>}/>
          <span style={{ minWidth: 60, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {page + 1} / {pageCount}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} icon={<Icons.ChevronRight size={14}/>}/>
        </div>
      </div>
    </div>
  );
}

window.DataTable = DataTable;
