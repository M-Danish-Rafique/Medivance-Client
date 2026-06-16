import { useState, useMemo, useEffect } from 'react';

/**
 * Client-side pagination helper.
 * Resets to page 1 whenever the input array length changes
 * (e.g. after a new search/filter is applied).
 */
export default function usePagination(items, defaultPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const totalItems = items?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Reset to first page when the dataset size changes (e.g. new filter applied)
  useEffect(() => { setPage(1); }, [totalItems]);

  // Clamp page if it's now out of range (e.g. page size changed)
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return (items || []).slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems };
}
