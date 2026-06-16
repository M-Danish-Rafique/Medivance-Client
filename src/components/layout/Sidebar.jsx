import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useCompany } from '../../context/CompanyContext';
import CompanyLogo from '../common/CompanyLogo';

const navItems = [
  { section: 'Overview' },
  { path: '/', icon: 'dashboard', label: 'Dashboard', perm: null }, // always visible
  { section: 'Master Data' },
  { path: '/companies',  icon: 'domain',         label: 'Companies',           perm: 'perm_companies' },
  { path: '/products',   icon: 'inventory_2',    label: 'Products',            perm: 'perm_products' },
  { path: '/employees',  icon: 'groups',         label: 'Employees',           perm: 'perm_employees' },
  { path: '/geography',  icon: 'map',            label: 'Cities & Territories',perm: 'perm_geography' },
  { path: '/customers',  icon: 'person_search',  label: 'Customers',           perm: 'perm_customers' },
  { path: '/suppliers',  icon: 'local_shipping', label: 'Suppliers',           perm: 'perm_suppliers' },
  { section: 'Distribution' },
  { path: '/purchase',   icon: 'shopping_cart',  label: 'Purchase',            perm: 'perm_purchase' },
  { path: '/sale',       icon: 'sell',           label: 'Sale',                perm: 'perm_sale' },
  { path: '/inventory',  icon: 'inventory_2',    label: 'Inventory',           perm: 'perm_inventory' },
  { path: '/recovery',   icon: 'account_balance_wallet', label: 'Recovery & Return', perm: 'perm_recovery' },
  { section: 'Manufacturing' },
  { path: '/manufacturing/products',      icon: 'category',   label: 'Mfg. Products',    perm: 'perm_mfg_products' },
  { path: '/manufacturing/raw-materials', icon: 'science',    label: 'Raw Materials',     perm: 'perm_mfg_raw_materials' },
  { path: '/manufacturing/batches',       icon: 'warehouse',  label: 'Batches',           perm: 'perm_mfg_batches' },
  { path: '/manufacturing/yields',        icon: 'inventory_2',label: 'Yield (End Product)',perm: 'perm_mfg_yields' },
  { section: 'Finance & Reports' },
  { path: '/finance',                 icon: 'account_balance', label: 'Finance',          perm: 'perm_finance' },
  { path: '/reports',                 icon: 'bar_chart',       label: 'Ledger Reports',   perm: 'perm_reports' },
  { path: '/manufacturing/tax-ledger',icon: 'receipt_long',   label: 'FBR Tax Ledger',   perm: 'perm_tax_ledger' },
];

export default function Sidebar() {
  const { user, can, logout } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const { company } = useCompany();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  // Filter nav items based on permissions; sections are shown only if ≥1 visible item follows
  const visibleItems = navItems.reduce((acc, item, idx) => {
    if (item.section) {
      // Look ahead to see if any item in this section is visible
      let hasVisible = false;
      for (let j = idx + 1; j < navItems.length; j++) {
        if (navItems[j].section) break;
        if (!navItems[j].perm || can(navItems[j].perm)) { hasVisible = true; break; }
      }
      if (hasVisible) acc.push(item);
      return acc;
    }
    if (!item.perm || can(item.perm)) acc.push(item);
    return acc;
  }, []);

  return (
    <div className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-logo">
          <CompanyLogo logoUrl={company.logo_url} name={company.name} size={38} fontSize={18} />
          {!collapsed && (
            <div className="sidebar-logo-text">
              <div className="logo-text">{company.name}</div>
              <div className="logo-sub">Distribution System</div>
            </div>
          )}
        </div>
        <button className="sidebar-toggle-btn" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <span className="material-symbols-outlined">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {visibleItems.map((item, idx) => {
          if (item.section) {
            if (collapsed) return null;
            return <div key={idx} className="nav-section-title">{item.section}</div>;
          }
          return (
            <NavLink key={item.path} to={item.path} end={item.path === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              title={collapsed ? item.label : undefined}>
              <span className="nav-icon material-symbols-outlined">{item.icon}</span>
              {!collapsed && item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* User footer */}
      <div style={{ padding: collapsed ? '12px 0' : '14px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'flex-start', gap: 10 }}>
        {/* Profile / Settings link */}
        <NavLink to="/profile"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start', marginBottom: 2 }}
          title={collapsed ? 'Profile & Settings' : undefined}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, #3b82f6, #0d9488)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: 13, flexShrink: 0
          }}>
            {user?.full_name?.[0] || 'A'}
          </div>
          {!collapsed && (
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ color: 'white', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.full_name}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textTransform: 'capitalize' }}>
                {user?.role} · Profile & Settings
              </div>
            </div>
          )}
        </NavLink>

        {!collapsed && (
          <button className="btn btn-ghost w-full" onClick={handleLogout}
            style={{ color: 'rgba(255,255,255,0.5)', justifyContent: 'center', fontSize: 12, padding: '6px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6 }}>logout</span>
            Sign Out
          </button>
        )}
        {collapsed && (
          <button onClick={handleLogout} title="Sign Out"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 16, cursor: 'pointer', padding: 4 }}>
            <span className="material-symbols-outlined">logout</span>
          </button>
        )}
      </div>
    </div>
  );
}
