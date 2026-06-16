import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Simple client-side pagination control.
 *
 * Usage:
 *   const { page, setPage, pageSize, setPageSize, totalPages, pageItems } = usePagination(data);
 *   ...render pageItems instead of data...
 *   <Pagination page={page} totalPages={totalPages} totalItems={data.length}
 *     pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
 */
export default function Pagination({ page, totalPages, totalItems, pageSize, onPageChange, onPageSizeChange, pageSizeOptions = [10, 25, 50, 100] }) {
  if (totalItems === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const goto = (p) => {
    const next = Math.max(1, Math.min(totalPages, p));
    if (next !== page) onPageChange(next);
  };

  // Compact page-number list with ellipses for large page counts
  const pages = [];
  const windowSize = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - windowSize && p <= page + windowSize)) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 12, padding: '12px 16px',
      borderTop: '1px solid var(--gray-100)', fontSize: 12.5, color: 'var(--gray-600)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>
          Showing <strong>{start}</strong>–<strong>{end}</strong> of <strong>{totalItems}</strong>
        </span>
        {onPageSizeChange && (
          <select className="form-control" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
            value={pageSize} onChange={e => onPageSizeChange(parseInt(e.target.value))}>
            {pageSizeOptions.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <PageBtn onClick={() => goto(1)} disabled={page === 1} title="First page"><ChevronsLeft size={15} /></PageBtn>
          <PageBtn onClick={() => goto(page - 1)} disabled={page === 1} title="Previous page"><ChevronLeft size={15} /></PageBtn>
          {pages.map((p, idx) => p === '…'
            ? <span key={`e${idx}`} style={{ padding: '0 4px', color: 'var(--gray-400)' }}>…</span>
            : (
              <PageBtn key={p} onClick={() => goto(p)} active={p === page}>{p}</PageBtn>
            ))}
          <PageBtn onClick={() => goto(page + 1)} disabled={page === totalPages} title="Next page"><ChevronRight size={15} /></PageBtn>
          <PageBtn onClick={() => goto(totalPages)} disabled={page === totalPages} title="Last page"><ChevronsRight size={15} /></PageBtn>
        </div>
      )}
    </div>
  );
}

function PageBtn({ children, onClick, disabled, active, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      minWidth: 28, height: 28, padding: '0 6px',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid ' + (active ? 'var(--primary)' : 'var(--gray-200)'),
      background: active ? 'var(--primary)' : 'white',
      color: active ? 'white' : disabled ? 'var(--gray-300)' : 'var(--gray-600)',
      borderRadius: 6, fontSize: 12, fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer',
      transition: 'all .12s',
    }}>
      {children}
    </button>
  );
}
