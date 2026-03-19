/**
 * Reusable data table component with dark theme styling
 *
 * @param {Array<{key: string, label: string, className?: string, render?: (row, index) => JSX}>} columns
 * @param {Array<object>} data
 * @param {string} emptyText
 */
export default function DataTable({ columns, data, emptyText = 'No data available' }) {
  if (!data?.length) {
    return <div className="p-4 text-xs text-slate-400">{emptyText}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-slate-700">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left text-[10px] text-slate-500 font-medium"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/30 hover:bg-slate-800/50 transition-colors">
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-1.5 ${col.className || ''}`}>
                  {col.render ? col.render(row, i) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
