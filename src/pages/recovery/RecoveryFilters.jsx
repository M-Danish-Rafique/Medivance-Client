import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, PackageX, RotateCcw } from 'lucide-react';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';

// Small pill-style shortcut used for Quick Recovery / Returns in the header.
// The icon sits inside a subtly-tinted rounded tile so it reads as a proper
// action chip instead of a floating glyph next to the label.
function ShortcutButton({ to, icon: Icon, label, tone }) {
  const tones = {
    green: { bg: 'var(--green-pale, #e6f7ee)', fg: 'var(--green, #16a34a)' },
    navy:  { bg: 'var(--blue-pale, #e5efff)',  fg: 'var(--navy-mid, #1e40af)' },
  };
  const t = tones[tone] || tones.green;
  return (
    <Link
      to={to}
      className="btn btn-outline"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px 6px 6px',
        height: 36,
        fontWeight: 600,
        color: 'var(--gray-700)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          background: t.bg,
          color: t.fg,
          borderRadius: 6,
        }}
      >
        <Icon size={14} strokeWidth={2.25} />
      </span>
      <span>{label}</span>
    </Link>
  );
}

export default function RecoveryFilters({
  cities,
  filteredAreas,
  filteredTerritories,
  filteredCustomers,
  areas,
  territories,
  employees,
  suppliers,
  filterCity,
  filterArea,
  filterTerritory,
  filterSalesman,
  filterSupplier,
  filterCustomer,
  onCityChange,
  onAreaChange,
  onTerritoryChange,
  onSalesmanChange,
  onSupplierChange,
  onCustomerChange,
  onReset,
}) {
  const hasAnyFilter = Boolean(
    filterCity || filterArea || filterTerritory ||
    filterSalesman || filterSupplier || filterCustomer
  );

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div
        className="card-header"
        style={{
          padding: '14px 22px',
          minHeight: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div className="card-title">Filter Invoices</div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShortcutButton to="/recovery/quick"        icon={Zap}      label="Quick Recovery" tone="green" />
          <ShortcutButton to="/recovery/quick-return" icon={PackageX} label="Returns"        tone="navy"  />
        </div>
      </div>

      <div className="card-body" style={{ paddingTop: 16 }}>
        {/* Row 1 — Geography */}
        <div
          className="form-grid"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">City</label>
            <select className="form-control" value={filterCity}
              onChange={e => onCityChange(e.target.value)}>
              <option value="">All Cities</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Area</label>
            <select className="form-control" value={filterArea}
              onChange={e => onAreaChange(e.target.value)}
              disabled={!filterCity}>
              <option value="">All Areas</option>
              {filteredAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Territory</label>
            <select className="form-control" value={filterTerritory}
              onChange={e => onTerritoryChange(e.target.value)}
              disabled={!filterArea}>
              <option value="">All Territories</option>
              {filteredTerritories.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2 — People (Salesman + Supplier + Customer) */}
        <div
          className="form-grid"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Salesman</label>
            <select className="form-control" value={filterSalesman}
              onChange={e => onSalesmanChange(e.target.value)}>
              <option value="">All Salesmen</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Supplier</label>
            <select className="form-control" value={filterSupplier}
              onChange={e => onSupplierChange(e.target.value)}>
              <option value="">All Suppliers</option>
              {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Customer</label>
            <CustomerAutocomplete
              customers={filteredCustomers}
              areas={areas}
              territories={territories}
              value={filterCustomer}
              onChange={onCustomerChange}
              placeholder="Search customer by name…"
              allowClear
              clearLabel="All Customers"
            />
          </div>
        </div>

        {/* Action row — right-aligned Reset that only lights up when there's
            something to reset. Keeps the filter block clean and predictable. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            paddingTop: 12,
            borderTop: '1px dashed var(--gray-200)',
          }}
        >
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onReset}
            disabled={!hasAnyFilter}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: hasAnyFilter ? 1 : 0.55,
              cursor: hasAnyFilter ? 'pointer' : 'not-allowed',
              color: 'var(--gray-700)',
            }}
            title={hasAnyFilter ? 'Clear all filters' : 'No filters applied'}
          >
            <RotateCcw size={14} />
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
}
