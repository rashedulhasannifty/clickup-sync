/**
 * Visually-hidden data table that gives screen-reader users a real, navigable
 * alternative to an SVG/div chart (which is otherwise opaque to assistive tech).
 * Render it as a sibling of the (aria-hidden) visual so AT reads the table while
 * sighted users see the chart. The first column of each row is treated as the
 * row header.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  // The wrapper is position:relative so the position:absolute .sr-only table
  // resolves against it (a 0-height in-flow box at the chart's location) instead
  // of escaping to the document's initial containing block — which, on a tall
  // page, stretched the scroll area and produced phantom blank space below the
  // real content. The wrapper itself takes no layout space (its only child is
  // out of flow).
  return (
    <div style={{ position: 'relative' }}>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row">{cell}</th>
                ) : (
                  <td key={ci}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
