import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import LookupCrudPage from './LookupCrudPage';
import { HrStyles } from './HrKit';

// ─── Departments & Designations ────────────────────────────────────────────
// Both lists exist for one reason: to fill the two dropdowns on an employee's
// profile. They are configuration, not a place anyone works, so they no longer
// hold two sidebar slots of their own — they live on one page reached from the
// Workforce screen's menu, which is where a missing designation is noticed.
//
// The lists themselves are unchanged: each tab renders the shared
// LookupCrudPage in `embedded` mode (no Layout, no page chrome of its own).
//
// /hr/departments and /hr/designations still resolve here, on the matching
// tab, so older links and bookmarks keep working.
const TABS = [
  { id: 'departments', label: 'Departments', path: '/hr/departments' },
  { id: 'designations', label: 'Designations', path: '/hr/designations' },
];

export default function JobSetup() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [tab, setTab] = useState(
    pathname.endsWith('/designations') ? 'designations' : 'departments'
  );

  return (
    <Layout title="Departments & Designations">
      <HrStyles />

      <div className="hr-lookup-head">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => navigate('/hr/employees')}
          aria-label="Back to Workforce"
          title="Back to Workforce"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden="true">arrow_back</span>
        </button>
        <div className="tabs" role="tablist" aria-label="Employee lists" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => { setTab(t.id); window.history.replaceState(null, '', t.path); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'departments' ? (
        <LookupCrudPage
          embedded
          title="Departments"
          singular="department"
          icon="corporate_fare"
          endpoint="/departments"
          addHint="The team or function an employee belongs to, e.g. Sales or Warehouse."
          examples="Sales, Distribution, Warehouse or Accounts"
        />
      ) : (
        <LookupCrudPage
          embedded
          title="Designations"
          singular="designation"
          icon="badge"
          endpoint="/designations"
          addHint="The employee's job title, e.g. Sales Officer or Delivery Rider."
          examples="Sales Officer, Order Booker or Accountant"
        />
      )}
    </Layout>
  );
}
