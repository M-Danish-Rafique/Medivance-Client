import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, PackageX  } from 'lucide-react';
import CustomerAutocomplete from '../../components/common/CustomerAutocomplete';

export default function RecoveryFilters({
  cities,
  filteredAreas,
  filteredTerritories,
  filteredCustomers,
  areas,
  territories,
  employees,
  filterCity,
  filterArea,
  filterTerritory,
  filterSalesman,
  filterCustomer,
  onCityChange,
  onAreaChange,
  onTerritoryChange,
  onSalesmanChange,
  onCustomerChange,
  onReset,
}) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
    <div className="card-header" style={{ padding: '14px 22px', minHeight: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="card-title">Filter Invoices</div>
      
      {/* Right-aligned side-by-side button group */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <Link to="/recovery/quick" className="btn" style={{ flexShrink: 0, color: 'var(--green-light)' }}>
          <Zap size={14} />
          Quick Recovery
        </Link>

        <Link to="/recovery/quick-return"  className="btn" style={{ flexShrink: 0, color: 'var(--navy-mid)' }}>
          <PackageX size={14} />
          Returns
        </Link>
      </div>
    </div>
      <div className="card-body" style={{ paddingTop: 16 }}>
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
        <div
          className="form-grid"
          style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end', gap: 16 }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Salesman</label>
            <select className="form-control" value={filterSalesman} onChange={e => onSalesmanChange(e.target.value)}>
              <option value="">All Salesmen</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
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
          <button
            type="button"
            className="btn btn-outline"
            onClick={onReset}
            style={{ flexShrink: 0, height: 38, color: 'var(--gray-600)' }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
