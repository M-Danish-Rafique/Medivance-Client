import React, { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../../components/layout/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';
import { formatDatePKT, todayPKT } from '../../utils/dateUtils';

const fmt = formatCurrency;

// Entities available for the layered Sale Summary report, in the order
// they're offered when a layer slot is open.
const SUMMARY_ENTITY_OPTIONS = [
  { key: 'salesman', label: 'Sales Man' },
  { key: 'company', label: 'Company' },
  { key: 'product', label: 'Product' },
  { key: 'customer', label: 'Customer' },
];
const SUMMARY_ENTITY_LABEL = Object.fromEntries(SUMMARY_ENTITY_OPTIONS.map(o => [o.key, o.label]));

const SUMMARY_VALUE_COLUMN_OPTIONS = [
  { key: 'gross_qty', label: 'Gross Qty', type: 'qty' },
  { key: 'ret_qty', label: 'Ret Qty', type: 'qty' },
  { key: 'net_qty', label: 'Net Qty', type: 'qty' },
  { key: 'gross', label: 'Gross Sale', type: 'money' },
  { key: 'disc', label: 'Discount', type: 'money' },
  { key: 'ret', label: 'Return', type: 'money' },
  { key: 'net', label: 'Net Sale', type: 'money' },
  { key: 'rec', label: 'Recovered', type: 'money' },
];

const SUMMARY_DEFAULT_VALUE_VISIBILITY = {
  gross_qty: false,
  ret_qty: false,
  net_qty: true,
  gross: true,
  disc: true,
  ret: true,
  net: true,
  rec: true,
};

function SearchableMultiSelect({ options, value, onChange, placeholder = 'Search and select…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);
  const selected = value || [];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => String(o.label || '').toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = (() => {
    if (selected.length === 0) return 'All';
    if (selected.length === 1) {
      const one = options.find(o => String(o.value) === String(selected[0]));
      return one?.label || '1 selected';
    }
    return `${selected.length} selected`;
  })();

  const toggleValue = (v) => {
    const exists = selected.some(x => String(x) === String(v));
    if (exists) onChange(selected.filter(x => String(x) !== String(v)));
    else onChange([...selected, String(v)]);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="form-control"
        onClick={() => setOpen(v => !v)}
        style={{
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLabel}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--gray-500)' }}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 40,
            background: 'white',
            border: '1px solid var(--gray-200)',
            borderRadius: 8,
            boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid var(--gray-100)' }}>
            <input
              className="form-control"
              placeholder={placeholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ fontSize: 12, padding: '7px 8px' }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--gray-500)', padding: 8 }}>No matches</div>
            ) : (
              filtered.map(opt => {
                const checked = selected.some(x => String(x) === String(opt.value));
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 6px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(opt.value)}
                      style={{ margin: 0, cursor: 'pointer' }}
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sale & Stock: in-flow display menu options ──────────────────────────
// Default mode remains "none" (hide Purchase + Adjustment columns).
// Operators can opt into either a split view or a combined view through
// a kebab menu in the table header.
const STOCK_COLUMN_OPTIONS = [
  {
    key: 'split',
    title: 'Show Purchase and Adjustment Separately',
    description: 'Displays dedicated Purchase and Adjustment columns.',
  },
  {
    key: 'combined',
    title: 'Show Purchase and Adjustment Combined',
    description: 'Displays one merged Purchase + Adjustment column.',
  },
];

function GroupByToggle({ value, onChange, options, ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 999,
        background: 'var(--gray-100, #eef1f5)',
        border: '1px solid var(--gray-200, #e2e6ec)',
      }}
    >
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              border: 0,
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: active ? 700 : 600,
              lineHeight: 1,
              background: active ? 'var(--white, #fff)' : 'transparent',
              color: active ? 'var(--gray-900, #0f172a)' : 'var(--gray-600, #4b5563)',
              boxShadow: active
                ? '0 1px 2px rgba(15,23,42,0.08), 0 0 0 1px rgba(15,23,42,0.06)'
                : 'none',
              transition: 'background 180ms ease, color 180ms ease, box-shadow 180ms ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// Given the flat, already-sorted rows returned by the API (sorted by
// layer1..layerN, matching the SQL ORDER BY), work out which cells should
// be merged (rowSpan) so repeated outer-group values show once instead of
// on every row — the standard "grouped ledger" look.
function buildSummarySpans(rows, nLayers) {
  const key = (row, i) => Array.from({ length: i + 1 }, (_, k) => row[`layer${k + 1}`] || '').join('\u241F');
  return rows.map((row, r) => Array.from({ length: nLayers }, (_, i) => {
    const isStart = r === 0 || key(row, i) !== key(rows[r - 1], i);
    if (!isStart) return { show: false, span: 0 };
    let span = 1;
    while (r + span < rows.length && key(rows[r + span], i) === key(row, i)) span++;
    return { show: true, span };
  }));
}

// Inline emphasis for the UI-only subtotal row (kept out of the printed
// PDF per feedback) — everything else uses the same .report-table /
// .report-tfoot-* classes as the other report tabs for visual consistency.
const summarySubtotalStyle = { fontWeight: 700, background: 'var(--gray-50, #f7f9fb)' };

// Vertical divider rule for the Sale Summary table body: with a single
// layer, no dividers at all (not even after Sr). With 2+ layers, a divider
// after Sr and after every layer column except the last one — e.g. with 3
// layers: Sr | L1 | L2 | L3 (dividers after Sr, L1, L2; none after L3).
// colIndex: 0 = Sr, 1..nLayers = L1..Ln. The header row never gets these —
// it stays completely free of vertical rules.
function summaryVLine(colIndex, nLayers) {
  if (nLayers <= 1) return false;
  return colIndex < nLayers;
}
const VLINE_STYLE = { borderRight: '1px solid var(--gray-300, #d7dee6)' };

function ReportFilterLayout({ fields, loading, onGenerate, onDownload, hasData, generateDisabled }) {
  return (
    <div className="report-filter-layout">
      <div className="report-filter-fields">{fields}</div>
      <div className="report-filter-actions">
        <button className="btn btn-primary" onClick={onGenerate} disabled={loading || generateDisabled}>
          {loading ? 'Loading...' : 'Generate'}
        </button>
        {hasData && (
          <button className="btn btn-outline" onClick={onDownload}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>
            Download PDF
          </button>
        )}
      </div>
    </div>
  );
}

function downloadBlob(res, filename) {
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export default function Reports() {
  const [reportTab, setReportTab] = useState('ledger');

  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [employeesSalesman, setEmployeesSalesman] = useState([]);
  const [employeesSupplier, setEmployeesSupplier] = useState([]);
  const [areas, setAreas] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Ledger state
  const [ledgerType, setLedgerType] = useState('customer');
  const [ledgerEntityId, setLedgerEntityId] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Sales report state
  const [salesFrom, setSalesFrom] = useState('');
  const [salesTo, setSalesTo] = useState('');
  const [salesSalesman, setSalesSalesman] = useState('');
  const [salesRows, setSalesRows] = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);

  // Recovery report state
  const [recFrom, setRecFrom] = useState('');
  const [recTo, setRecTo] = useState('');
  const [recSupplier, setRecSupplier] = useState('');
  const [recRows, setRecRows] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  // Sale Summary report state
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');
  const [summaryLayers, setSummaryLayers] = useState([]); // ordered array of entity keys, e.g. ['salesman','company']
  const [summaryData, setSummaryData] = useState(null);   // { rows, layers }
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryLayerFilters, setSummaryLayerFilters] = useState({});
  const [summaryValueVisibility, setSummaryValueVisibility] = useState(SUMMARY_DEFAULT_VALUE_VISIBILITY);
  const [summaryShowColumnMenu, setSummaryShowColumnMenu] = useState(false);
  const summaryColumnMenuRef = useRef(null);

  // Sale & Stock report state — dates are REQUIRED (see fetchSaleStock).
  // Pre-filled with a sensible default window (start of current month → today
  // in PKT) so operators aren't stared at by an empty form and, more
  // importantly, so the underlying report never runs unbounded — which
  // previously produced meaningless numbers (opening = current stock,
  // gross = every sale ever, closing = negative).
  //
  // PKT is used for BOTH endpoints (not `new Date()` browser-local): the
  // rest of the app stores dates as PKT via `todayPKT()`, so a browser
  // whose local time differs from PKT would otherwise drift the report
  // window by up to a day and silently exclude same-day activity — which
  // was the actual root cause of the "Purchase = 0" report bug.
  const _defaultStockRange = (() => {
    const today = todayPKT();                 // 'YYYY-MM-DD' in PKT
    const from  = `${today.slice(0, 7)}-01`;  // first of current PKT month
    return { from, to: today };
  })();
  const [companies, setCompanies] = useState([]);
  const [stockCompany, setStockCompany] = useState('');
  const [stockFrom, setStockFrom] = useState(_defaultStockRange.from);
  const [stockTo, setStockTo] = useState(_defaultStockRange.to);
  const [stockRows, setStockRows] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);
  // Stock in-flow display mode — controls whether Purchase/Adjustment
  // columns are shown separately, merged, or hidden. Default 'none' keeps
  // the initial view focused on sales; operator opts into inventory
  // context on demand. Sent through to the PDF endpoint so downloads
  // match the on-screen shape.
  const [stockDisplayMode, setStockDisplayMode] = useState('none');
  const [stockShowColumnMenu, setStockShowColumnMenu] = useState(false);
  const stockColumnMenuRef = useRef(null);

  // Batch Activity report state — product + batch are required, dates are
  // optional (open-ended window means "all activity ever for this batch").
  // Products come from the main /products list; batches load on demand for
  // the selected product via /inventory/product/:id, so we always show the
  // full batch list (including expired / zero-qty ones the batch may have
  // rolled off to) rather than filtering to active batches only — the
  // whole point of the report is auditing historical activity.
  const [products, setProducts] = useState([]);
  const [batchProductId, setBatchProductId] = useState('');
  const [batches, setBatches] = useState([]);
  const [batchNo, setBatchNo] = useState('');
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchFrom, setBatchFrom] = useState('');
  const [batchTo, setBatchTo] = useState('');
  const [batchData, setBatchData] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);

  // Profit report state — grouped revenue/cost/profit register
  // over a required date window. Default the window to current-PKT-month
  // start → today for the same reason Sale & Stock does: prevents the
  // operator from generating an unbounded report that would take seconds
  // to run and produce a meaningless "all time" number set.
  const [profitGroupBy, setProfitGroupBy] = useState('company');
  const [profitEntityIds, setProfitEntityIds] = useState([]);
  const [profitFrom, setProfitFrom] = useState(_defaultStockRange.from);
  const [profitTo, setProfitTo] = useState(_defaultStockRange.to);
  const [profitRows, setProfitRows] = useState(null);
  const [profitLoading, setProfitLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/customers'),
      api.get('/suppliers'),
      api.get('/employees?role=Salesman'),
      api.get('/employees?role=Supplier'),
      api.get('/geography/geo'),
      api.get('/companies'),
      api.get('/products'),
    ])
      .then(([c, s, e_sm, e_sp, g, co, pr]) => {
        setCustomers(c.data);
        setSuppliers(s.data);
        setEmployeesSalesman(e_sm.data);
        setEmployeesSupplier(e_sp.data);
        setAreas(g.data.areas);
        setTerritories(g.data.territories);
        setCompanies(co.data || []);
        // Sort products alphabetically for the Batch Activity picker so
        // long lists remain easy to scan/typeahead in a native <select>.
        setProducts((pr.data || []).slice().sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''))
        ));
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, []);

  useEffect(() => {
    if (!summaryShowColumnMenu) return;
    const onDocClick = (e) => {
      if (!summaryColumnMenuRef.current?.contains(e.target)) setSummaryShowColumnMenu(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setSummaryShowColumnMenu(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [summaryShowColumnMenu]);

  useEffect(() => {
    if (!stockShowColumnMenu) return;
    const onDocClick = (e) => {
      if (!stockColumnMenuRef.current?.contains(e.target)) setStockShowColumnMenu(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setStockShowColumnMenu(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [stockShowColumnMenu]);

  useEffect(() => {
    // Keep only filters for currently selected layer entities.
    setSummaryLayerFilters(prev => {
      const keep = Object.fromEntries(
        Object.entries(prev).filter(([k]) => summaryLayers.includes(k))
      );
      return keep;
    });
  }, [summaryLayers]);

  const fetchLedger = async () => {
    if (!ledgerEntityId) return toast.error('Please select a customer or supplier');
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams();
      if (ledgerType === 'customer') params.append('customer_id', ledgerEntityId);
      else params.append('supplier_id', ledgerEntityId);
      if (ledgerFrom) params.append('from_date', ledgerFrom);
      if (ledgerTo) params.append('to_date', ledgerTo);
      const endpoint = ledgerType === 'customer' ? '/reports/customer-ledger' : '/reports/supplier-ledger';
      const r = await api.get(`${endpoint}?${params}`);
      setLedger(r.data);
    } catch {
      toast.error('Error fetching ledger');
    } finally {
      setLedgerLoading(false);
    }
  };

  const downloadLedgerPDF = async () => {
    if (!ledgerEntityId) return toast.error('Please select a customer or supplier');
    const params = new URLSearchParams();
    if (ledgerType === 'customer') params.append('customer_id', ledgerEntityId);
    else params.append('supplier_id', ledgerEntityId);
    if (ledgerFrom) params.append('from_date', ledgerFrom);
    if (ledgerTo) params.append('to_date', ledgerTo);
    const endpoint = ledgerType === 'customer' ? 'customer-ledger' : 'supplier-ledger';
    try {
      const res = await api.get(`/reports/${endpoint}/pdf?${params}`, { responseType: 'blob' });
      const entity = (ledgerType === 'customer' ? customers : suppliers).find(x => String(x.id) === String(ledgerEntityId));
      downloadBlob(res, `${ledgerType}-ledger-${(entity?.name || ledgerType).replace(/[^a-z0-9]+/gi, '-')}.pdf`);
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const fetchSalesReport = async () => {
    setSalesLoading(true);
    try {
      const params = new URLSearchParams();
      if (salesFrom) params.append('from_date', salesFrom);
      if (salesTo) params.append('to_date', salesTo);
      if (salesSalesman) params.append('salesman_id', salesSalesman);
      const r = await api.get(`/reports/sales-report?${params}`);
      setSalesRows(r.data.rows || []);
    } catch {
      toast.error('Error fetching sales report');
    } finally {
      setSalesLoading(false);
    }
  };

  const downloadSalesPDF = async () => {
    const params = new URLSearchParams();
    if (salesFrom) params.append('from_date', salesFrom);
    if (salesTo) params.append('to_date', salesTo);
    if (salesSalesman) params.append('salesman_id', salesSalesman);
    try {
      const res = await api.get(`/reports/sales-report/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'sales-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const fetchRecoveryReport = async () => {
    setRecLoading(true);
    try {
      const params = new URLSearchParams();
      if (recFrom) params.append('from_date', recFrom);
      if (recTo) params.append('to_date', recTo);
      if (recSupplier) params.append('supplier_id', recSupplier);
      const r = await api.get(`/reports/recovery-report?${params}`);
      setRecRows(r.data.rows || []);
    } catch {
      toast.error('Error fetching recovery report');
    } finally {
      setRecLoading(false);
    }
  };

  const downloadRecoveryPDF = async () => {
    const params = new URLSearchParams();
    if (recFrom) params.append('from_date', recFrom);
    if (recTo) params.append('to_date', recTo);
    if (recSupplier) params.append('supplier_id', recSupplier);
    try {
      const res = await api.get(`/reports/recovery-report/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'recovery-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  // Sets/clears the layer at `index`, truncating any layers chosen after it
  // (choosing an earlier layer differently invalidates later selections).
  const setSummaryLayerAt = (index, key) => {
    setSummaryLayers(prev => {
      const next = prev.slice(0, index);
      if (key) next.push(key);
      return next;
    });
    setSummaryData(null);
  };

  const summaryVisibleValueColumns = SUMMARY_VALUE_COLUMN_OPTIONS.filter(c => summaryValueVisibility[c.key] !== false);
  const summaryMaxValueColumns = Math.max(0, 10 - summaryLayers.length);

  const toggleSummaryValueColumn = (key) => {
    setSummaryValueVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const resetSummaryValueColumns = () => {
    setSummaryValueVisibility(SUMMARY_DEFAULT_VALUE_VISIBILITY);
  };

  const toggleStockColumnOption = (nextMode) => {
    setStockDisplayMode(prev => (prev === nextMode ? 'none' : nextMode));
  };

  const appendSummaryLayerFilters = (params) => {
    if ((summaryLayerFilters.salesman || []).length) params.append('salesman_ids', summaryLayerFilters.salesman.join(','));
    if ((summaryLayerFilters.company || []).length) params.append('company_ids', summaryLayerFilters.company.join(','));
    if ((summaryLayerFilters.product || []).length) params.append('product_ids', summaryLayerFilters.product.join(','));
    if ((summaryLayerFilters.customer || []).length) params.append('customer_ids', summaryLayerFilters.customer.join(','));
  };

  const validateSummaryPdfColumnLimit = () => {
    const selectedValueCount = summaryVisibleValueColumns.length;
    if (selectedValueCount === 0) {
      toast.error('Please select at least one value column for PDF.');
      return false;
    }
    if (selectedValueCount <= summaryMaxValueColumns) return true;
    toast.error(
      `With ${summaryLayers.length} tier${summaryLayers.length !== 1 ? 's' : ''}, you can select only ${summaryMaxValueColumns} value column${summaryMaxValueColumns !== 1 ? 's' : ''}.`
    );
    return false;
  };

  const fetchSaleSummary = async () => {
    if (summaryLayers.length === 0) return toast.error('Please select at least Layer 1');
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams();
      if (summaryFrom) params.append('from_date', summaryFrom);
      if (summaryTo) params.append('to_date', summaryTo);
      params.append('layers', summaryLayers.join(','));
      appendSummaryLayerFilters(params);
      const r = await api.get(`/reports/sale-summary?${params}`);
      setSummaryData(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Error fetching sale summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const downloadSaleSummaryPDF = async () => {
    if (summaryLayers.length === 0) return toast.error('Please select at least Layer 1');
    if (!validateSummaryPdfColumnLimit()) return;
    const params = new URLSearchParams();
    if (summaryFrom) params.append('from_date', summaryFrom);
    if (summaryTo) params.append('to_date', summaryTo);
    params.append('layers', summaryLayers.join(','));
    params.append('value_cols', summaryVisibleValueColumns.map(c => c.key).join(','));
    appendSummaryLayerFilters(params);
    try {
      const res = await api.get(`/reports/sale-summary/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'sale-summary-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const fetchSaleStock = async () => {
    if (!stockFrom || !stockTo) {
      return toast.error('Please select both From Date and To Date');
    }
    if (stockFrom > stockTo) {
      return toast.error('From Date cannot be after To Date');
    }
    setStockLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('from_date', stockFrom);
      params.append('to_date', stockTo);
      if (stockCompany) params.append('company_id', stockCompany);
      const r = await api.get(`/reports/sale-stock-report?${params}`);
      setStockRows(r.data.rows || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Error fetching Sale & Stock report');
    } finally {
      setStockLoading(false);
    }
  };

  const downloadSaleStockPDF = async () => {
    if (!stockFrom || !stockTo) {
      return toast.error('Please select both From Date and To Date');
    }
    const params = new URLSearchParams();
    params.append('from_date', stockFrom);
    params.append('to_date', stockTo);
    if (stockCompany) params.append('company_id', stockCompany);
    // Mirror on-screen inflow view in the PDF so what the operator sees is
    // what gets printed.
    params.append('stock_mode', stockDisplayMode);
    try {
      const res = await api.get(`/reports/sale-stock-report/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'sale-stock-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  // When the operator picks a product for the Batch Activity report, load
  // its batches so the batch dropdown can populate. Reuses /inventory/product/:id
  // WITHOUT `active_only=1` because historical activity for expired /
  // zero-qty batches is a legitimate reason to run this report.
  useEffect(() => {
    if (!batchProductId) { setBatches([]); setBatchNo(''); setBatchData(null); return; }
    setBatchesLoading(true);
    api.get(`/inventory/product/${batchProductId}`)
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : [];
        // Sort: active/qty-carrying batches first, then by expiry desc so
        // recent batches land at the top — the ones an operator is most
        // likely to be auditing right after a sale round.
        list.sort((a, b) => {
          const aq = parseFloat(a.qty) || 0, bq = parseFloat(b.qty) || 0;
          if ((aq > 0) !== (bq > 0)) return aq > 0 ? -1 : 1;
          const ae = a.exp_date || '', be = b.exp_date || '';
          return be.localeCompare(ae);
        });
        setBatches(list);
        setBatchNo('');
        setBatchData(null);
      })
      .catch(() => { setBatches([]); setBatchNo(''); })
      .finally(() => setBatchesLoading(false));
  }, [batchProductId]);

  const fetchBatchActivity = async () => {
    if (!batchProductId) return toast.error('Please select a product');
    if (!batchNo)        return toast.error('Please select a batch');
    if (batchFrom && batchTo && batchFrom > batchTo) {
      return toast.error('From Date cannot be after To Date');
    }
    setBatchLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('product_id', batchProductId);
      params.append('batch_no', batchNo);
      if (batchFrom) params.append('from_date', batchFrom);
      if (batchTo)   params.append('to_date',   batchTo);
      const r = await api.get(`/reports/batch-activity?${params}`);
      setBatchData(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Error fetching Batch Activity report');
    } finally {
      setBatchLoading(false);
    }
  };

  const downloadBatchActivityPDF = async () => {
    if (!batchProductId || !batchNo) {
      return toast.error('Please select a product and batch');
    }
    const params = new URLSearchParams();
    params.append('product_id', batchProductId);
    params.append('batch_no', batchNo);
    if (batchFrom) params.append('from_date', batchFrom);
    if (batchTo)   params.append('to_date',   batchTo);
    try {
      const res = await api.get(`/reports/batch-activity/pdf?${params}`, { responseType: 'blob' });
      const safeBatch = String(batchNo).replace(/[^a-z0-9]+/gi, '-');
      downloadBlob(res, `batch-activity-${safeBatch}.pdf`);
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const fetchProfitReport = async () => {
    if (!profitFrom || !profitTo) {
      return toast.error('Please select both From Date and To Date');
    }
    if (profitFrom > profitTo) {
      return toast.error('From Date cannot be after To Date');
    }
    setProfitLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('from_date', profitFrom);
      params.append('to_date',   profitTo);
      params.append('group_by', profitGroupBy);
      if (profitEntityIds.length) params.append('entity_ids', profitEntityIds.join(','));
      const r = await api.get(`/reports/profit-report?${params}`);
      setProfitRows(r.data.rows || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Error fetching Profit report');
    } finally {
      setProfitLoading(false);
    }
  };

  const downloadProfitReportPDF = async () => {
    if (!profitFrom || !profitTo) {
      return toast.error('Please select both From Date and To Date');
    }
    const params = new URLSearchParams();
    params.append('from_date', profitFrom);
    params.append('to_date',   profitTo);
    params.append('group_by', profitGroupBy);
    if (profitEntityIds.length) params.append('entity_ids', profitEntityIds.join(','));
    try {
      const res = await api.get(`/reports/profit-report/pdf?${params}`, { responseType: 'blob' });
      downloadBlob(res, 'profit-report.pdf');
    } catch {
      toast.error('Error downloading PDF');
    }
  };

  const ledgerEntity = ledger?.customer || ledger?.supplier;
  const ledgerRows = ledger?.ledger || [];
  const ob = parseFloat(ledger?.openingBalance || 0);
  let runBal = ob;
  const rowsWithBalance = ledgerRows.map(r => {
    runBal += parseFloat(r.dr || 0) - parseFloat(r.cr || 0);
    return { ...r, _balance: runBal };
  });
  const finalBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1]._balance : ob;

  const salesTotals = (salesRows || []).reduce((t, r) => ({
    gross: t.gross + parseFloat(r.gross_amount || 0),
    ret: t.ret + parseFloat(r.return_amount || 0),
    disc: t.disc + parseFloat(r.discount || 0),
    net: t.net + parseFloat(r.net_amount || 0),
    rec: t.rec + parseFloat(r.recovered_amount || 0),
  }), { gross: 0, ret: 0, disc: 0, net: 0, rec: 0 });

  const recTotals = (recRows || []).reduce((t, r) => ({
    gross: t.gross + parseFloat(r.gross_amount || 0),
    rec: t.rec + parseFloat(r.recovered_amount || 0),
    ret: t.ret + parseFloat(r.return_amount || 0),
    disc: t.disc + parseFloat(r.discount || 0),
    pending: t.pending + parseFloat(r.net_pending || 0),
  }), { gross: 0, rec: 0, ret: 0, disc: 0, pending: 0 });

  const summaryRows = summaryData?.rows || [];
  const summaryLayerLabels = summaryData?.layers?.map(l => l.label) || summaryLayers.map(k => SUMMARY_ENTITY_LABEL[k]);
  const summaryTotals = summaryRows.reduce((t, r) => ({
    gross_qty: t.gross_qty + (parseInt(r.gross_qty, 10) || 0),
    ret_qty: t.ret_qty + (parseInt(r.return_qty, 10) || 0),
    net_qty: t.net_qty + (parseInt(r.net_qty, 10) || 0),
    gross: t.gross + parseFloat(r.gross_amount || 0),
    ret: t.ret + parseFloat(r.return_amount || 0),
    net: t.net + parseFloat(r.net_amount || 0),
    disc: t.disc + parseFloat(r.discount || 0),
    rec: t.rec + parseFloat(r.recovered_amount || 0),
  }), { gross_qty: 0, ret_qty: 0, net_qty: 0, gross: 0, ret: 0, net: 0, disc: 0, rec: 0 });

  const stockTotals = (stockRows || []).reduce((t, r) => ({
    opening:  t.opening  + (parseInt(r.opening_stock,   10) || 0),
    purchase: t.purchase + (parseInt(r.purchase_qty,    10) || 0),
    adjust:   t.adjust   + (parseInt(r.adjustment_qty,  10) || 0),
    gross:    t.gross    + (parseInt(r.gross_qty,       10) || 0),
    ret:      t.ret      + (parseInt(r.return_qty,      10) || 0),
    netU:     t.netU     + (parseInt(r.net_sale_unit,   10) || 0),
    netV:     t.netV     + (parseFloat(r.net_sale_value)    || 0),
    closing:  t.closing  + (parseInt(r.closing_stock,   10) || 0),
  }), { opening: 0, purchase: 0, adjust: 0, gross: 0, ret: 0, netU: 0, netV: 0, closing: 0 });

  const profitTotals = (profitRows || []).reduce((t, r) => ({
    revenue:      t.revenue      + (parseFloat(r.revenue)      || 0),
    cogs:         t.cogs         + (parseFloat(r.cogs)         || 0),
    gross_profit: t.gross_profit + (parseFloat(r.gross_profit) || 0),
  }), { revenue: 0, cogs: 0, gross_profit: 0 });
  // Any product with a NULL purchase_rate_snapshot on at least one line
  // will report an understated COGS (and an inflated Gross Profit). We
  const profitHasMissingCost = (profitRows || []).some(r => (r.missing_cost_lines || 0) > 0);

  if (dataLoading) {
    return (
      <Layout title="Reports">
        <div className="loading-center"><div className="spinner" /></div>
      </Layout>
    );
  }

  return (
    <Layout title="Reports">
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'ledger', label: 'Ledger Reports', icon: 'account_balance' },
          { id: 'sales', label: 'Sales Report', icon: 'sell' },
          { id: 'recovery', label: 'Recovery Report', icon: 'account_balance_wallet' },
          { id: 'summary', label: 'Sale Summary', icon: 'layers' },
          { id: 'saleStock', label: 'Sale & Stock', icon: 'inventory_2' },
          { id: 'batchActivity', label: 'Batch Activity', icon: 'science' },
          { id: 'profitReport', label: 'Profit Report', icon: 'bar_chart' },
        ].map(tab => (
          <button
            key={tab.id}
            className={`btn ${reportTab === tab.id ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setReportTab(tab.id)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Ledger Report ── */}
      {reportTab === 'ledger' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Generate Ledger Report</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {['customer', 'supplier'].map(t => (
                  <button key={t} className={`btn ${ledgerType === t ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => { setLedgerType(t); setLedgerEntityId(''); setLedger(null); }}>
                    {t === 'customer' ? 'Customer Ledger' : 'Supplier Ledger'}
                  </button>
                ))}
              </div>
              <div className="form-grid form-grid-4" style={{ alignItems: 'flex-end', gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">{ledgerType === 'customer' ? 'Customer' : 'Supplier'} *</label>
                  {ledgerType === 'customer' ? (
                    <CustomerAutocomplete
                      customers={customers}
                      areas={areas}
                      territories={territories}
                      value={ledgerEntityId}
                      onChange={id => { setLedgerEntityId(id); setLedger(null); }}
                      placeholder="Search customer by name…"
                      style={{ minWidth: 260 }}
                    />
                  ) : (
                    <select className="form-control" style={{ minWidth: 260 }} value={ledgerEntityId} onChange={e => { setLedgerEntityId(e.target.value); setLedger(null); }}>
                      <option value="">— Select —</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">From Date</label>
                  <input className="form-control" type="date" value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">To Date</label>
                  <input className="form-control" type="date" value={ledgerTo} onChange={e => setLedgerTo(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={fetchLedger} disabled={ledgerLoading || !ledgerEntityId}>
                    {ledgerLoading ? 'Loading...' : 'Generate'}
                  </button>
                  {ledger && (
                    <button className="btn btn-outline" onClick={downloadLedgerPDF}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>
                      Download PDF
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {ledger && (
            <div className="card">
              <div style={{ padding: '18px 22px', background: 'var(--blue-ultra)', borderBottom: '1px solid var(--blue-pale)' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>{ledgerEntity?.name}</div>
                <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
                  Balance: {fmt(Math.abs(finalBalance))} {finalBalance >= 0 ? 'Dr' : 'Cr'}
                </div>
              </div>
              {ob !== 0 && (
                <div style={{ padding: '10px 22px', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
                  Opening Balance: {fmt(Math.abs(ob))} {ob >= 0 ? 'Dr' : 'Cr'}
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th><th>Invoice No</th><th>Description</th>
                      <th style={{ textAlign: 'right' }}>Dr</th>
                      <th style={{ textAlign: 'right' }}>Cr</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithBalance.map((row, i) => (
                      <tr key={i}>
                        <td>{formatDatePKT(row.date)}</td>
                        <td>{row.invoice_no || '—'}</td>
                        <td>{row.description || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{parseFloat(row.dr) > 0 ? fmt(row.dr) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{parseFloat(row.cr) > 0 ? fmt(row.cr) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {fmt(Math.abs(row._balance))} {row._balance >= 0 ? 'Dr' : 'Cr'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sales Report ── */}
      {reportTab === 'sales' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Sales Report</div></div>
            <div className="card-body">
              <ReportFilterLayout
                loading={salesLoading}
                onGenerate={fetchSalesReport}
                onDownload={downloadSalesPDF}
                hasData={!!salesRows}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date</label>
                      <input className="form-control" type="date" value={salesFrom} onChange={e => setSalesFrom(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date</label>
                      <input className="form-control" type="date" value={salesTo} onChange={e => setSalesTo(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Salesman</label>
                      <select className="form-control" value={salesSalesman} onChange={e => setSalesSalesman(e.target.value)}>
                        <option value="">All</option>
                        {employeesSalesman.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {salesRows && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">{salesRows.length} sale{salesRows.length !== 1 ? 's' : ''}</div>
              </div>
              <div className="table-wrap">
                {salesRows.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-title">No sales in selected period</div></div>
                ) : (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '4%' }}>Sr</th>
                        <th style={{ width: '10%' }}>Date</th>
                        <th style={{ width: '10%' }}>Invoice No</th>
                        <th>Customer</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Gross</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Discount</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Return</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Net</th>
                        <th style={{ width: '11%', textAlign: 'right' }}>Recovered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRows.map((row, i) => (
                        <tr key={row.id}>
                          <td>{i + 1}</td>
                          <td>{formatDatePKT(row.date)}</td>
                          <td className="mono">{row.invoice_no}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.gross_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.discount) > 0 ? fmt(row.discount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.return_amount) > 0 ? fmt(row.return_amount) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(row.net_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.recovered_amount) > 0 ? fmt(row.recovered_amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.gross)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.disc)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.ret)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.net)}</td>
                        <td className="report-tfoot-num">{fmt(salesTotals.rec)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Recovery Report ── */}
      {reportTab === 'recovery' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Recovery Report</div></div>
            <div className="card-body">
              <ReportFilterLayout
                loading={recLoading}
                onGenerate={fetchRecoveryReport}
                onDownload={downloadRecoveryPDF}
                hasData={!!recRows}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date</label>
                      <input className="form-control" type="date" value={recFrom} onChange={e => setRecFrom(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date</label>
                      <input className="form-control" type="date" value={recTo} onChange={e => setRecTo(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Supplier</label>
                      <select className="form-control" value={recSupplier} onChange={e => setRecSupplier(e.target.value)}>
                        <option value="">All</option>
                        {employeesSupplier.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {recRows && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">{recRows.length} recover{recRows.length !== 1 ? 'ies' : 'y'}</div>
              </div>
              <div className="table-wrap">
                {recRows.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-title">No recoveries in selected period</div></div>
                ) : (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '5%' }}>Sr</th>
                        <th style={{ width: '12%' }}>Date</th>
                        <th style={{ width: '10%' }}>Invoice No</th>
                        <th>Customer</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Gross Pending</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Discount</th>
                        <th style={{ width: '10%', textAlign: 'right' }}>Return</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Recovered</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Net Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recRows.map((row, i) => (
                        <tr key={row.id}>
                          <td>{i + 1}</td>
                          <td>{formatDatePKT(row.date)}</td>
                          <td className="mono">{row.invoice_no}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.gross_amount)}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.discount) > 0 ? fmt(row.discount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(row.return_amount) > 0 ? fmt(row.return_amount) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row.recovered_amount)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: parseFloat(row.net_pending) > 0 ? 'var(--amber)' : 'var(--green)' }}>
                            {fmt(row.net_pending)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(recTotals.gross)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.disc)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.ret)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.rec)}</td>
                        <td className="report-tfoot-num">{fmt(recTotals.pending)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sale Summary Report (layered / multi-level) ── */}
      {reportTab === 'summary' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Sale Summary Report</div></div>
            <div className="card-body">
              <div className="form-grid form-grid-4" style={{ marginBottom: 20 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">From Date</label>
                  <input className="form-control" type="date" value={summaryFrom}
                    onChange={e => { setSummaryFrom(e.target.value); setSummaryData(null); }} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">To Date</label>
                  <input className="form-control" type="date" value={summaryTo}
                    onChange={e => { setSummaryTo(e.target.value); setSummaryData(null); }} />
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 10 }}>
                Choose how to group your sales — add up to 4 grouping levels.
              </div>

              <div className="form-grid form-grid-4" style={{ marginBottom: 10 }}>
                {[0, 1, 2, 3].map(idx => {
                  // Only render this slot if it's the first ("Group By"), or
                  // the previous slot has already been filled in.
                  if (idx > 0 && summaryLayers.length < idx) return null;
                  const usedElsewhere = summaryLayers.slice(0, idx);
                  const availableOptions = SUMMARY_ENTITY_OPTIONS.filter(o => !usedElsewhere.includes(o.key));
                  const currentValue = summaryLayers[idx] || '';
                  return (
                    <div className="form-group" style={{ margin: 0 }} key={idx}>
                      <label className="form-label">{idx === 0 ? 'Group By *' : 'Then By'}</label>
                      <select
                        className="form-control"
                        value={currentValue}
                        onChange={e => setSummaryLayerAt(idx, e.target.value)}
                      >
                        {idx === 0 && <option value="">— Select —</option>}
                        {idx > 0 && <option value="">— None —</option>}
                        {availableOptions.map(o => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {summaryLayers.length > 0 && (
                <div className="form-grid form-grid-4" style={{ marginBottom: 18 }}>
                  {summaryLayers.map(layerKey => {
                    const options = layerKey === 'salesman'
                      ? employeesSalesman.map(e => ({ value: String(e.id), label: e.name }))
                      : layerKey === 'company'
                      ? companies.map(c => ({ value: String(c.id), label: c.name }))
                      : layerKey === 'product'
                      ? products.map(p => ({ value: String(p.id), label: `${p.name}${p.pack_size ? ` · ${p.pack_size}` : ''}` }))
                      : customers.map(c => ({ value: String(c.id), label: c.name }));
                    return (
                      <div className="form-group" style={{ margin: 0 }} key={`filter-${layerKey}`}>
                        <label className="form-label">{SUMMARY_ENTITY_LABEL[layerKey]} Filter</label>
                        <SearchableMultiSelect
                          options={options}
                          value={summaryLayerFilters[layerKey] || []}
                          onChange={(ids) => {
                            setSummaryLayerFilters(prev => ({ ...prev, [layerKey]: ids }));
                            setSummaryData(null);
                          }}
                          placeholder={`Search ${SUMMARY_ENTITY_LABEL[layerKey]}…`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button className="btn btn-primary" onClick={fetchSaleSummary}
                  disabled={summaryLoading || summaryLayers.length === 0}>
                  {summaryLoading ? 'Loading...' : 'Generate'}
                </button>
                {summaryData && (
                  <button className="btn btn-outline" onClick={downloadSaleSummaryPDF}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>download</span>
                    Download PDF
                  </button>
                )}
              </div>
            </div>
          </div>

          {summaryData && (() => {
            const nLayers = summaryLayerLabels.length;
            const spans = buildSummarySpans(summaryRows, nLayers);
            let runningSubtotal = { gross_qty: 0, ret_qty: 0, net_qty: 0, gross: 0, ret: 0, net: 0, disc: 0, rec: 0 };

            const summaryValueReaders = {
              gross_qty: (row) => parseInt(row.gross_qty, 10) || 0,
              ret_qty: (row) => parseInt(row.return_qty, 10) || 0,
              net_qty: (row) => parseInt(row.net_qty, 10) || 0,
              gross: (row) => parseFloat(row.gross_amount || 0),
              disc: (row) => parseFloat(row.discount || 0),
              ret: (row) => parseFloat(row.return_amount || 0),
              net: (row) => parseFloat(row.net_amount || 0),
              rec: (row) => parseFloat(row.recovered_amount || 0),
            };

            const summaryValueFormatter = (key, val) => {
              if (key.endsWith('_qty')) return val > 0 ? String(val) : (key === 'net_qty' ? '0' : '—');
              if (key === 'disc' || key === 'ret' || key === 'rec') return val > 0 ? fmt(val) : '—';
              return fmt(val);
            };

            return (
              <div className="card">
                <div
                  className="card-header"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}
                >
                  <div className="card-title">
                    {summaryRows.length} group{summaryRows.length !== 1 ? 's' : ''}
                    <span style={{ fontWeight: 400, color: 'var(--gray-500)', marginLeft: 8 }}>
                      Grouped By: {summaryLayerLabels.join(', ')}
                    </span>
                  </div>
                  <div ref={summaryColumnMenuRef} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      title="Table Column Options"
                      aria-label="Table Column Options"
                      aria-haspopup="true"
                      aria-expanded={summaryShowColumnMenu}
                      onClick={(e) => { e.stopPropagation(); setSummaryShowColumnMenu(v => !v); }}
                      className="btn btn-outline"
                      style={{ padding: '6px 8px', minWidth: 36 }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>more_vert</span>
                    </button>
                    {summaryShowColumnMenu && (
                      <div
                        role="menu"
                        style={{
                          position: 'absolute',
                          top: 38,
                          right: 0,
                          zIndex: 40,
                          background: 'white',
                          border: '1px solid var(--gray-200)',
                          borderRadius: 8,
                          boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
                          minWidth: 220,
                          padding: 6,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)' }}>
                          VALUE COLUMNS
                        </div>
                        {SUMMARY_VALUE_COLUMN_OPTIONS.map(col => {
                          const checked = summaryValueVisibility[col.key] !== false;
                          return (
                            <label
                              key={col.key}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSummaryValueColumn(col.key)}
                                style={{ margin: 0 }}
                              />
                              <span style={{ flex: 1 }}>{col.label}</span>
                            </label>
                          );
                        })}
                        <div style={{ borderTop: '1px solid var(--gray-100)', marginTop: 6, paddingTop: 6, textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={resetSummaryValueColumns}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', fontSize: 11 }}
                          >
                            Reset to default
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="table-wrap">
                  {summaryRows.length === 0 ? (
                    <div className="empty-state"><div className="empty-state-title">No sales in selected period</div></div>
                  ) : (
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th style={{ width: '4%' }}>Sr</th>
                          {summaryLayerLabels.map((lbl, i) => <th key={i}>{lbl}</th>)}
                          {summaryVisibleValueColumns.map(col => (
                            <th key={col.key} style={{ width: '10%', textAlign: 'right' }}>{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summaryRows.map((row, r) => {
                          const rowValues = Object.fromEntries(
                            SUMMARY_VALUE_COLUMN_OPTIONS.map(c => [c.key, summaryValueReaders[c.key](row)])
                          );
                          runningSubtotal = {
                            gross_qty: runningSubtotal.gross_qty + rowValues.gross_qty,
                            ret_qty: runningSubtotal.ret_qty + rowValues.ret_qty,
                            net_qty: runningSubtotal.net_qty + rowValues.net_qty,
                            gross: runningSubtotal.gross + rowValues.gross,
                            ret: runningSubtotal.ret + rowValues.ret,
                            net: runningSubtotal.net + rowValues.net,
                            disc: runningSubtotal.disc + rowValues.disc,
                            rec: runningSubtotal.rec + rowValues.rec,
                          };

                          const isLastRow = r === summaryRows.length - 1;
                          const layer1Ends = nLayers > 1 && (isLastRow || (row.layer1 || '') !== (summaryRows[r + 1].layer1 || ''));
                          const subtotalToRender = layer1Ends ? runningSubtotal : null;
                          if (layer1Ends) runningSubtotal = { gross_qty: 0, ret_qty: 0, net_qty: 0, gross: 0, ret: 0, net: 0, disc: 0, rec: 0 };

                          return (
                            <React.Fragment key={r}>
                              <tr>
                                <td style={{ verticalAlign: 'top', ...(summaryVLine(0, nLayers) ? VLINE_STYLE : null) }}>{r + 1}</td>
                                {Array.from({ length: nLayers }, (_, li) => (
                                  spans[r][li].show ? (
                                    <td key={li} rowSpan={spans[r][li].span}
                                      style={{
                                        verticalAlign: 'top',
                                        fontWeight: li === 0 ? 600 : undefined,
                                        ...(summaryVLine(li + 1, nLayers) ? VLINE_STYLE : null),
                                      }}>
                                      {row[`layer${li + 1}`] || '—'}
                                    </td>
                                  ) : null
                                ))}
                                {summaryVisibleValueColumns.map(col => (
                                  <td
                                    key={col.key}
                                    style={{
                                      textAlign: 'right',
                                      verticalAlign: 'top',
                                      fontWeight: col.key === 'net' || col.key === 'net_qty' ? 700 : undefined,
                                    }}
                                  >
                                    {summaryValueFormatter(col.key, rowValues[col.key])}
                                  </td>
                                ))}
                              </tr>
                              {subtotalToRender && (
                                <tr style={summarySubtotalStyle}>
                                  <td colSpan={1 + nLayers} style={summarySubtotalStyle}>
                                    {row.layer1 ? `Subtotal — ${row.layer1}` : 'Subtotal'}
                                  </td>
                                  {summaryVisibleValueColumns.map(col => (
                                    <td key={col.key} style={{ ...summarySubtotalStyle, textAlign: 'right' }}>
                                      {summaryValueFormatter(col.key, subtotalToRender[col.key])}
                                    </td>
                                  ))}
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={1 + nLayers} className="report-tfoot-label">Grand Total</td>
                          {summaryVisibleValueColumns.map(col => (
                            <td key={col.key} className="report-tfoot-num">
                              {summaryValueFormatter(col.key, summaryTotals[col.key])}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── Sale & Stock Report ── */}
      {reportTab === 'saleStock' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Sale &amp; Stock Report</div></div>
            <div className="card-body">
              <ReportFilterLayout
                loading={stockLoading}
                onGenerate={fetchSaleStock}
                onDownload={downloadSaleStockPDF}
                hasData={!!stockRows}
                generateDisabled={!stockFrom || !stockTo}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Company</label>
                      <select
                        className="form-control"
                        value={stockCompany}
                        onChange={e => { setStockCompany(e.target.value); setStockRows(null); }}
                      >
                        <option value="">All Companies</option>
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date *</label>
                      <input className="form-control" type="date" value={stockFrom} required
                        onChange={e => { setStockFrom(e.target.value); setStockRows(null); }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date *</label>
                      <input className="form-control" type="date" value={stockTo} required
                        onChange={e => { setStockTo(e.target.value); setStockRows(null); }} />
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {stockRows && (
            <div className="card">
              {/* Scoped animation used when Purchase/Adjustment cells mount
                  after a segmented-control change — a quick fade+slide-in
                  removes the jarring "columns just teleported in" feel. */}
              <style>{`
                @keyframes stockColEnter {
                  from { opacity: 0; transform: translateY(-2px); }
                  to   { opacity: 1; transform: none; }
                }
                .stock-col-enter { animation: stockColEnter 220ms ease-out both; }
                .report-table td, .report-table th {
                  transition: background-color 220ms ease;
                }
              `}</style>
              <div
                className="card-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div className="card-title">
                  {stockRows.length} product{stockRows.length !== 1 ? 's' : ''}
                  {stockCompany && (() => {
                    const c = companies.find(x => String(x.id) === String(stockCompany));
                    return c ? (
                      <span style={{ fontWeight: 400, color: 'var(--gray-500)', marginLeft: 8 }}>
                        · {c.name}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div ref={stockColumnMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    aria-label="Purchase and Adjustment Column Layout"
                    title="Purchase and Adjustment Column Layout"
                    aria-haspopup="true"
                    aria-expanded={stockShowColumnMenu}
                    onClick={(e) => { e.stopPropagation(); setStockShowColumnMenu(v => !v); }}
                    style={{ padding: '6px 10px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
                  </button>
                  {stockShowColumnMenu && (
                    <div
                      role="menu"
                      style={{
                        position: 'absolute',
                        top: 38,
                        right: 0,
                        zIndex: 40,
                        background: 'white',
                        border: '1px solid var(--gray-200)',
                        borderRadius: 8,
                        boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
                        minWidth: 320,
                        padding: 6,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)' }}>
                        PURCHASE & ADJUSTMENT COLUMNS
                      </div>
                      {STOCK_COLUMN_OPTIONS.map(opt => {
                        const checked = stockDisplayMode === opt.key;
                        return (
                          <label
                            key={opt.key}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 8,
                              padding: '6px 8px',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleStockColumnOption(opt.key)}
                              style={{ marginTop: 3 }}
                            />
                            <div>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gray-700)' }}>{opt.title}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>{opt.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="table-wrap">
                {stockRows.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-title">No product activity in selected period</div>
                    <div className="empty-state-subtitle">Try widening the date range or clearing the company filter.</div>
                  </div>
                ) : (() => {
                  // Column-shape derived from the segmented control.
                  const showSplit    = stockDisplayMode === 'split';
                  const showCombined = stockDisplayMode === 'combined';

                  // Subtle background tints for the in-flow columns —
                  // green = inflow (purchase / combined),
                  // amber = manual intervention (adjustment).
                  // Alphas stay low so numbers remain the dominant signal.
                  const TINT_PUR      = 'rgba(16,185,129,0.06)';
                  const TINT_ADJ      = 'rgba(245,158,11,0.06)';
                  const TINT_COMBINED = 'rgba(16,185,129,0.05)';
                  const HEADER_TINT_PUR      = 'rgba(16,185,129,0.10)';
                  const HEADER_TINT_ADJ      = 'rgba(245,158,11,0.10)';
                  const HEADER_TINT_COMBINED = 'rgba(16,185,129,0.09)';

                  return (
                    <table className="report-table" style={{ transition: 'all 220ms ease' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '4%' }}>Sr</th>
                          <th>Product</th>
                          <th style={{ width: '8%' }}>Pack Size</th>
                          <th style={{ width: '7%', textAlign: 'right' }}>Opening</th>

                          {showSplit && (
                            <>
                                <th className="stock-col-enter" style={{ width: '7%', textAlign: 'right' }} >
                                  Purchase
                                </th>
                                <th className="stock-col-enter" style={{ width: '7%', textAlign: 'right' }} >
                                  Adjustment
                                </th>
                            </>
                          )}

                          {showCombined && (
                            <th className="stock-col-enter" style={{ width: '7%', textAlign: 'right' }} >
                                Pur. / Adj.
                            </th>
                          )}

                          <th style={{ width: '8%', textAlign: 'right' }}>Gross Sale</th>
                          <th style={{ width: '6%', textAlign: 'right' }}>Return</th>
                          <th style={{ width: '9%', textAlign: 'right' }}>Net Sale (Unit)</th>
                          <th style={{ width: '11%', textAlign: 'right' }}>Net Sale (Value)</th>
                          <th style={{ width: '7%', textAlign: 'right' }}>Closing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockRows.map((row, i) => {
                          const closingNeg = row.closing_stock < 0;
                          const adj        = parseInt(row.adjustment_qty, 10) || 0;
                          const pur        = parseInt(row.purchase_qty, 10)   || 0;
                          const inflow     = pur + adj;
                          return (
                            <tr key={row.product_id}>
                              <td>{i + 1}</td>
                              <td style={{ fontWeight: 600 }}>{row.product_name}</td>
                              <td style={{ color: 'var(--gray-500)' }}>{row.pack_size || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{row.opening_stock}</td>

                              {showSplit && (
                                <>
                                  <td
                                    className="stock-col-enter"
                                    style={{ textAlign: 'right'}}
                                  >
                                    {pur > 0 ? pur : '—'}
                                  </td>
                                  <td
                                    className="stock-col-enter"
                                    style={{
                                      textAlign: 'right',
                                      color: adj < 0 ? 'var(--amber)' : undefined,
                                      fontWeight: adj !== 0 ? 600 : undefined,
                                    }}
                                  >
                                    {adj === 0 ? '—' : adj}
                                  </td>
                                </>
                              )}

                              {showCombined && (
                                <td
                                  className="stock-col-enter"
                                  style={{
                                    textAlign: 'right',
                                    fontWeight: inflow !== 0 ? 600 : undefined,
                                    color: inflow < 0 ? 'var(--amber)' : undefined,
                                  }}
                                  title={`Purchase ${pur}  +  Adjustment ${adj}`}
                                >
                                  {inflow === 0 ? '—' : inflow}
                                </td>
                              )}

                              <td style={{ textAlign: 'right' }}>{row.gross_qty > 0 ? row.gross_qty : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{row.return_qty > 0 ? row.return_qty : '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.net_sale_unit}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(row.net_sale_value)}</td>
                              <td style={{
                                textAlign: 'right',
                                fontWeight: 700,
                                color: closingNeg ? 'var(--amber)' : undefined,
                              }} title={closingNeg ? 'Negative closing stock — data integrity check needed' : undefined}>
                                {row.closing_stock}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} className="report-tfoot-label">Total</td>
                          <td className="report-tfoot-num">{stockTotals.opening}</td>

                          {showSplit && (
                            <>
                              <td className="report-tfoot-num stock-col-enter" >
                                {stockTotals.purchase}
                              </td>
                              <td className="report-tfoot-num stock-col-enter">
                                {stockTotals.adjust === 0 ? '—' : stockTotals.adjust}
                              </td>
                            </>
                          )}

                          {showCombined && (
                            <td className="report-tfoot-num stock-col-enter">
                              {(stockTotals.purchase + stockTotals.adjust) === 0
                                ? '—'
                                : stockTotals.purchase + stockTotals.adjust}
                            </td>
                          )}

                          <td className="report-tfoot-num">{stockTotals.gross}</td>
                          <td className="report-tfoot-num">{stockTotals.ret}</td>
                          <td className="report-tfoot-num">{stockTotals.netU}</td>
                          <td className="report-tfoot-num">{fmt(stockTotals.netV)}</td>
                          <td className="report-tfoot-num">{stockTotals.closing}</td>
                        </tr>
                      </tfoot>
                    </table>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Batch Activity Report ── */}
      {reportTab === 'batchActivity' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Batch Activity Report</div></div>
            <div className="card-body">
              <ReportFilterLayout
                loading={batchLoading}
                onGenerate={fetchBatchActivity}
                onDownload={downloadBatchActivityPDF}
                hasData={!!batchData}
                generateDisabled={!batchProductId || !batchNo}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Product *</label>
                      <select
                        className="form-control"
                        value={batchProductId}
                        onChange={e => {
                          setBatchProductId(e.target.value);
                          setBatchData(null);
                        }}
                      >
                        <option value="">— Select product —</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}{p.pack_size ? ` · ${p.pack_size}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Batch *</label>
                      <select
                        className="form-control"
                        value={batchNo}
                        onChange={e => { setBatchNo(e.target.value); setBatchData(null); }}
                        disabled={!batchProductId || batchesLoading}
                      >
                        <option value="">
                          {!batchProductId ? '— Pick a product first —'
                            : batchesLoading   ? 'Loading batches…'
                            : batches.length === 0 ? 'No batches found'
                            : '— Select batch —'}
                        </option>
                        {batches.map(b => {
                          const q = parseInt(b.qty, 10) || 0;
                          const expLabel = b.exp_date ? ` · exp ${formatDatePKT(b.exp_date)}` : '';
                          return (
                            <option key={b.batch_no} value={b.batch_no}>
                              {b.batch_no}  ·  qty {q}{expLabel}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date</label>
                      <input className="form-control" type="date" value={batchFrom}
                        onChange={e => { setBatchFrom(e.target.value); setBatchData(null); }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date</label>
                      <input className="form-control" type="date" value={batchTo}
                        onChange={e => { setBatchTo(e.target.value); setBatchData(null); }} />
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {batchData && (() => {
            const batchRows   = batchData.rows   || [];
            const batchTotals = batchData.totals || { gross_qty: 0, return_qty: 0, received_qty: 0 };
            return (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">{batchRows.length} row{batchRows.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="table-wrap">
                  {batchRows.length === 0 ? (
                    <div className="empty-state"><div className="empty-state-title">No activity for this batch in selected period</div></div>
                  ) : (
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th style={{ width: '4%' }}>Sr</th>
                          <th style={{ width: '10%' }}>Date</th>
                          <th style={{ width: '10%' }}>Invoice No</th>
                          <th>Customer</th>
                          <th style={{ width: '27%' }}>Ship-To Address</th>
                          <th style={{ width: '10%', textAlign: 'right' }}>Gross Qty</th>
                          <th style={{ width: '10%', textAlign: 'right' }}>Return Qty</th>
                          <th style={{ width: '11%', textAlign: 'right' }}>Received Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchRows.map((row, i) => {
                          const ret = parseInt(row.return_qty, 10) || 0;
                          return (
                            <tr key={`${row.sale_id}-${i}`}>
                              <td>{i + 1}</td>
                              <td>{formatDatePKT(row.date)}</td>
                              <td className="mono">{row.invoice_no}</td>
                              <td style={{ fontWeight: 600 }}>{row.customer_name}</td>
                              <td>{row.ship_to || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{parseInt(row.gross_qty, 10) || 0}</td>
                              <td style={{ textAlign: 'right' }}>{ret > 0 ? ret : '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{parseInt(row.received_qty, 10) || 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5} className="report-tfoot-label">Total</td>
                          <td className="report-tfoot-num">{batchTotals.gross_qty || 0}</td>
                          <td className="report-tfoot-num">{batchTotals.return_qty || 0}</td>
                          <td className="report-tfoot-num">{batchTotals.received_qty || 0}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── Profit Report ── */}
      {reportTab === 'profitReport' && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div
              className="card-header"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}
            >
              <div className="card-title">Profit Report</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <GroupByToggle
                  value={profitGroupBy}
                  onChange={(key) => {
                    setProfitGroupBy(key);
                    setProfitEntityIds([]);
                    setProdSalesRows(null);
                  }}
                  options={[{ key: 'company', label: 'Company' }, { key: 'salesman', label: 'Salesman' }]}
                  ariaLabel="Profit report grouping"
                />
              </div>
            </div>
            <div className="card-body">
              <ReportFilterLayout
                loading={prodSalesLoading}
                onGenerate={fetchProductSales}
                onDownload={downloadProductSalesPDF}
                hasData={!!prodSalesRows}
                generateDisabled={!prodSalesFrom || !prodSalesTo}
                fields={
                  <>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">{profitGroupBy === 'company' ? 'Company' : 'Salesman'} Filter</label>
                      <SearchableMultiSelect
                        options={(profitGroupBy === 'company' ? companies : employeesSalesman).map(x => ({ value: String(x.id), label: x.name }))}
                        value={profitEntityIds}
                        onChange={(ids) => {
                          setProfitEntityIds(ids);
                          setProdSalesRows(null);
                        }}
                        placeholder={`Search ${profitGroupBy === 'company' ? 'company' : 'salesman'}…`}
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">From Date *</label>
                      <input className="form-control" type="date" value={prodSalesFrom} required
                        onChange={e => { setProdSalesFrom(e.target.value); setProdSalesRows(null); }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">To Date *</label>
                      <input className="form-control" type="date" value={prodSalesTo} required
                        onChange={e => { setProdSalesTo(e.target.value); setProdSalesRows(null); }} />
                    </div>
                  </>
                }
              />
            </div>
          </div>

          {prodSalesRows && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  {prodSalesRows.length} row{prodSalesRows.length !== 1 ? 's' : ''}
                  <span style={{ fontWeight: 400, color: 'var(--gray-500)', marginLeft: 8 }}>
                    · Grouped by {profitGroupBy === 'company' ? 'Company' : 'Salesman'}
                  </span>
                  {prodSalesHasMissingCost && (
                    <span
                      title="Some sold lines have no purchase_rate_snapshot recorded (legacy pre-2026 data). COGS is understated and Gross Profit is inflated for the affected group rows. Values are shown as-is; no silent adjustment is applied."
                      style={{
                        marginLeft: 10, fontSize: 12, fontWeight: 600,
                        color: 'var(--amber, #d97706)',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>
                      COGS partially unknown
                    </span>
                  )}
                </div>
              </div>
              <div className="table-wrap">
                {prodSalesRows.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-title">No profit rows in selected period</div>
                    <div className="empty-state-subtitle">Try widening the date range or clearing the selected filters.</div>
                  </div>
                ) : (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '4%' }}>Sr</th>
                        <th>{profitGroupBy === 'company' ? 'Company' : 'Salesman'}</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Revenue</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>COGS</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Gross Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodSalesRows.map((row, i) => {
                        const gp        = parseFloat(row.gross_profit) || 0;
                        const missing   = (row.missing_cost_lines || 0) > 0;
                        return (
                          <tr key={`${row.group_id || 'null'}-${i}`}>
                            <td>{i + 1}</td>
                            <td style={{ fontWeight: 600 }}>
                              {row.group_name || '—'}
                              {missing && (
                                <span
                                  title={`${row.missing_cost_lines} line${row.missing_cost_lines !== 1 ? 's' : ''} in this period have no purchase-rate snapshot; COGS below excludes their cost.`}
                                  style={{ marginLeft: 6, color: 'var(--amber, #d97706)', cursor: 'help', fontSize: 12 }}
                                >⚠</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>{fmt(row.revenue)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(row.cogs)}</td>
                            <td style={{
                              textAlign: 'right', fontWeight: 700,
                              color: gp < 0 ? 'var(--amber, #d97706)' : undefined,
                            }}>
                              {fmt(row.gross_profit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="report-tfoot-label">Total</td>
                        <td className="report-tfoot-num">{fmt(prodSalesTotals.revenue)}</td>
                        <td className="report-tfoot-num">{fmt(prodSalesTotals.cogs)}</td>
                        <td className="report-tfoot-num">{fmt(prodSalesTotals.gross_profit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
