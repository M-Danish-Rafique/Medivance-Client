import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import CompanyLogo from '../../components/common/CompanyLogo';
import { Building2, Users, UserCircle, ScrollText } from 'lucide-react';
import { formatDatePKT } from '../../utils/dateUtils';

const ALL_PERMS = [
  { key: 'perm_companies',         label: 'Companies',            section: 'Master Data' },
  { key: 'perm_products',          label: 'Products',             section: 'Master Data' },
  { key: 'perm_employees',         label: 'Employees',            section: 'Master Data' },
  { key: 'perm_geography',         label: 'Cities & Territories', section: 'Master Data' },
  { key: 'perm_customers',         label: 'Customers',            section: 'Master Data' },
  { key: 'perm_suppliers',         label: 'Suppliers',            section: 'Master Data' },
  { key: 'perm_purchase',          label: 'Purchase',             section: 'Distribution' },
  { key: 'perm_view_purchase_rate', label: 'View Purchase Rate',   section: 'Distribution' },
  { key: 'perm_sale',              label: 'Sale',                 section: 'Distribution' },
  { key: 'perm_inventory',         label: 'Inventory',            section: 'Distribution' },
  { key: 'perm_recovery',          label: 'Recovery & Return',    section: 'Distribution' },
  { key: 'perm_mfg_products',      label: 'Mfg. Products',        section: 'Manufacturing' },
  { key: 'perm_mfg_raw_materials', label: 'Raw Materials',        section: 'Manufacturing' },
  { key: 'perm_mfg_batches',       label: 'Batches',              section: 'Manufacturing' },
  { key: 'perm_mfg_yields',        label: 'Yield (End Products)', section: 'Manufacturing' },
  { key: 'perm_finance',           label: 'Finance',              section: 'Finance & Reports' },
  { key: 'perm_reports',           label: 'Reports',       section: 'Finance & Reports' },
  { key: 'perm_tax_ledger',        label: 'FBR Tax Ledger',       section: 'Finance & Reports' },
];
const PERM_SECTIONS = ['Master Data', 'Distribution', 'Manufacturing', 'Finance & Reports'];
const emptyPerms = () => Object.fromEntries(ALL_PERMS.map(p => [p.key, false]));

export default function Profile() {
  const { user } = useAuth();
  const { refresh: refreshCompany } = useCompany();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('company');

  const [company, setCompany] = useState({ name: '', address: '', phone: '', email: '' });
  const [savingCompany, setSavingCompany] = useState(false);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userModal, setUserModal] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', is_active: 1, permissions: emptyPerms() });
  const [savingUser, setSavingUser] = useState(false);

  const [logs, setLogs] = useState([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logFilter, setLogFilter] = useState({ module: '', action: '', from: '', to: '' });
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [policy, setPolicy] = useState({ logging_enabled: true, retention_days: 90, auto_rotate_enabled: true });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [rotating, setRotating] = useState(false);
  const LOG_LIMIT = 50;

  const loadCompany = useCallback(async () => {
    try {
      const r = await api.get('/admin/company');
      const { name, address, phone, email } = r.data || {};
      setCompany({ name: name || '', address: address || '', phone: phone || '', email: email || '' });
    } catch (_) {}
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    try { const r = await api.get('/admin/users'); setUsers(r.data); } catch (_) {}
    setLoadingUsers(false);
  }, [isAdmin]);

  const loadLogs = useCallback(async (page = 1) => {
    if (!isAdmin) return;
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams({ page, limit: LOG_LIMIT });
      if (logFilter.module) params.set('module', logFilter.module);
      if (logFilter.action) params.set('action', logFilter.action);
      if (logFilter.from)   params.set('from', logFilter.from);
      if (logFilter.to)     params.set('to', logFilter.to);
      const r = await api.get('/admin/logs?' + params.toString());
      setLogs(r.data.rows); setLogTotal(r.data.total); setLogPage(page);
    } catch (_) {}
    setLoadingLogs(false);
  }, [isAdmin, logFilter]);

  const loadPolicy = useCallback(async () => {
    if (!isAdmin) return;
    try { const r = await api.get('/admin/logs/policy'); setPolicy(r.data); } catch (_) {}
  }, [isAdmin]);

  useEffect(() => { loadCompany(); }, [loadCompany]);
  useEffect(() => { if (tab === 'users') loadUsers(); }, [tab, loadUsers]);
  useEffect(() => { if (tab === 'logs') { loadLogs(1); loadPolicy(); } }, [tab, loadLogs, loadPolicy]);

  const saveCompany = async () => {
    if (!company.name?.trim()) return toast.error('Company name is required');
    setSavingCompany(true);
    try {
      const { name, address, phone, email } = company;
      await api.put('/admin/company', { name, address, phone, email });
      toast.success('Company details updated');
      refreshCompany(); // update sidebar/login branding immediately
    }
    catch (err) { toast.error(err.response?.data?.message || 'Error saving'); }
    setSavingCompany(false);
  };

  const openCreateUser = () => {
    setEditUser(null);
    setUserForm({ username: '', password: '', full_name: '', is_active: 1, permissions: emptyPerms() });
    setUserModal('create');
  };

  const openEditUser = (u) => {
    setEditUser(u);
    const perms = emptyPerms();
    ALL_PERMS.forEach(p => { perms[p.key] = !!u[p.key]; });
    setUserForm({ username: u.username, password: '', full_name: u.full_name, is_active: u.is_active, permissions: perms });
    setUserModal('edit');
  };

  const toggleAllSection = (section, val) => {
    const keys = ALL_PERMS.filter(p => p.section === section).map(p => p.key);
    setUserForm(prev => ({ ...prev, permissions: { ...prev.permissions, ...Object.fromEntries(keys.map(k => [k, val])) } }));
  };

  const toggleAllPerms = (val) => {
    setUserForm(prev => ({ ...prev, permissions: Object.fromEntries(ALL_PERMS.map(p => [p.key, val])) }));
  };

  const saveUser = async () => {
    if (!userForm.full_name.trim()) return toast.error('Name is required');
    if (userModal === 'create' && (!userForm.username.trim() || !userForm.password.trim()))
      return toast.error('Username and password are required');
    setSavingUser(true);
    try {
      if (userModal === 'create') {
        await api.post('/admin/users', { ...userForm });
        toast.success('User created successfully');
      } else {
        await api.put('/admin/users/' + editUser.id, { ...userForm });
        toast.success('User updated successfully');
      }
      setUserModal(null); loadUsers();
    } catch (err) { toast.error(err.response?.data?.message || 'Error saving user'); }
    setSavingUser(false);
  };

  const deleteUser = async (u) => {
    if (!window.confirm('Delete user "' + u.username + '"? This cannot be undone.')) return;
    try { await api.delete('/admin/users/' + u.id); toast.success('User deleted'); loadUsers(); }
    catch (err) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const savePolicy = async () => {
    setSavingPolicy(true);
    try { await api.put('/admin/logs/policy', policy); toast.success('Retention policy updated'); }
    catch (_) { toast.error('Error saving policy'); }
    setSavingPolicy(false);
  };

  const runRotation = async () => {
    setRotating(true);
    try { const r = await api.post('/admin/logs/rotate'); toast.success('Rotation complete — ' + r.data.deleted + ' old entries deleted'); loadLogs(1); }
    catch (_) { toast.error('Rotation failed'); }
    setRotating(false);
  };

  const totalPages = Math.ceil(logTotal / LOG_LIMIT);

  const PermGroup = ({ section }) => {
    const sectionPerms = ALL_PERMS.filter(p => p.section === section);
    const allOn = sectionPerms.every(p => userForm.permissions[p.key]);
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{section}</div>
          <button type="button" style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--gray-300)', borderRadius: 4, cursor: 'pointer', background: 'white', color: 'var(--gray-600)' }}
            onClick={() => toggleAllSection(section, !allOn)}>{allOn ? 'Deselect all' : 'Select all'}</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sectionPerms.map(p => (
            <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, padding: '5px 10px', border: '1.5px solid ' + (userForm.permissions[p.key] ? 'var(--primary)' : 'var(--gray-200)'), borderRadius: 6, cursor: 'pointer', background: userForm.permissions[p.key] ? 'var(--blue-ultra)' : 'white', userSelect: 'none' }}>
              <input type="checkbox" checked={!!userForm.permissions[p.key]}
                onChange={e => setUserForm(prev => ({ ...prev, permissions: { ...prev.permissions, [p.key]: e.target.checked } }))}
                style={{ accentColor: 'var(--primary)', width: 13, height: 13 }} />
              {p.label}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const tabStyle = (t) => ({
    padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: 'none', background: 'none', display: 'inline-flex', alignItems: 'center',
    borderBottom: '2.5px solid ' + (tab === t ? 'var(--primary)' : 'transparent'),
    color: tab === t ? 'var(--primary)' : 'var(--gray-500)',
  });

  return (
    <Layout title="Profile & Settings">
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--gray-200)', marginBottom: 24 }}>
        <button style={tabStyle('company')} onClick={() => setTab('company')}>
          <Building2 size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Company Details
        </button>
        {isAdmin && (
          <button style={tabStyle('users')} onClick={() => setTab('users')}>
            <Users size={15} style={{ marginRight: 6, verticalAlign: -2 }} />User Management
          </button>
        )}
        <button style={tabStyle('me')} onClick={() => setTab('me')}>
          <UserCircle size={15} style={{ marginRight: 6, verticalAlign: -2 }} />My Profile
        </button>
        {isAdmin && (
          <button style={tabStyle('logs')} onClick={() => setTab('logs')}>
            <ScrollText size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Audit Logs
          </button>
        )}
      </div>

      {tab === 'company' && (
        <div className="card" style={{ maxWidth: 680 }}>
          <div className="card-header"><div className="card-title">Company Information</div></div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: 14, background: 'var(--gray-50)', borderRadius: 10 }}>
              <CompanyLogo name={company.name} size={56} fontSize={22} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{company.name || 'Company Name'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>
                  Logo is loaded from <code>client/public/logo-light.png</code> (app) and <code>logo-dark.png</code> (invoices &amp; reports).
                </div>
              </div>
            </div>
            <div className="form-grid form-grid-2">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Company Name *</label>
                <input className="form-control" value={company.name || ''} disabled={!isAdmin}
                  onChange={e => setCompany(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Address</label>
                <textarea className="form-control" rows={3} value={company.address || ''} disabled={!isAdmin}
                  onChange={e => setCompany(p => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-control" value={company.phone || ''} disabled={!isAdmin}
                  onChange={e => setCompany(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-control" type="email" value={company.email || ''} disabled={!isAdmin}
                  onChange={e => setCompany(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
            {isAdmin ? (
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={saveCompany} disabled={savingCompany}>
                  {savingCompany ? 'Saving...' : 'Save Company Details'}
                </button>
              </div>
            ) : (
              <div className="alert alert-info" style={{ marginTop: 12, fontSize: 12 }}>Only admins can edit company details.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'me' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-header"><div className="card-title">My Account</div></div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div><div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 3 }}>Full Name</div><div style={{ fontWeight: 700, fontSize: 16 }}>{user?.full_name}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 3 }}>Username</div><div className="mono" style={{ fontSize: 14 }}>{user?.username}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 3 }}>Role</div><span className={'badge ' + (user?.role === 'admin' ? 'badge-blue' : 'badge-green')} style={{ textTransform: 'capitalize' }}>{user?.role}</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && isAdmin && (
        <>
          <div className="card">
            <div className="card-header">
              <div className="card-title">System Users</div>
              <button className="btn btn-primary btn-sm" onClick={openCreateUser}>+ Add User</button>
            </div>
            <div className="table-wrap">
              {loadingUsers ? <div className="loading-center"><div className="spinner" /></div>
              : users.length === 0 ? <div className="empty-state"><div className="empty-state-title">No users</div></div>
              : (
                <table>
                  <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                        <td className="mono">{u.username}</td>
                        <td><span className={'badge ' + (u.role === 'admin' ? 'badge-blue' : 'badge-gray')} style={{ textTransform: 'capitalize' }}>{u.role}</span></td>
                        <td>{u.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-amber">Inactive</span>}</td>
                        <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{formatDatePKT(u.created_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEditUser(u)}>Edit</button>
                          {u.id !== user?.id && u.role !== 'admin' && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteUser(u)}>Delete</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <Modal isOpen={!!userModal} onClose={() => setUserModal(null)}
            title={userModal === 'create' ? 'Add New User' : 'Edit User — ' + (editUser?.username || '')}
            size="lg"
            footer={
              <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setUserModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveUser} disabled={savingUser}>
                  {savingUser ? 'Saving...' : userModal === 'create' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            }>
            <div>
              <div className="form-grid form-grid-2" style={{ marginBottom: 16 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" value={userForm.full_name}
                    onChange={e => setUserForm(p => ({ ...p, full_name: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">{userModal === 'edit' ? 'Username (read-only)' : 'Username *'}</label>
                  <input className="form-control" value={userForm.username} disabled={userModal === 'edit'}
                    onChange={e => setUserForm(p => ({ ...p, username: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">{userModal === 'create' ? 'Password *' : 'New Password (leave blank to keep)'}</label>
                  <input className="form-control" type="password" value={userForm.password}
                    onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))} />
                </div>
                {userModal === 'edit' && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Account Status</label>
                    <select className="form-control" value={userForm.is_active}
                      onChange={e => setUserForm(p => ({ ...p, is_active: parseInt(e.target.value) }))}>
                      <option value={1}>Active</option><option value={0}>Inactive</option>
                    </select>
                  </div>
                )}
              </div>
              <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>Module Permissions</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" style={{ fontSize: 11, padding: '3px 9px', border: '1px solid var(--gray-300)', borderRadius: 5, cursor: 'pointer', background: 'white' }} onClick={() => toggleAllPerms(true)}>Grant All</button>
                    <button type="button" style={{ fontSize: 11, padding: '3px 9px', border: '1px solid var(--gray-300)', borderRadius: 5, cursor: 'pointer', background: 'white' }} onClick={() => toggleAllPerms(false)}>Revoke All</button>
                  </div>
                </div>
                {PERM_SECTIONS.map(s => <PermGroup key={s} section={s} />)}
              </div>
            </div>
          </Modal>
        </>
      )}

      {tab === 'logs' && isAdmin && (
        <>
          {/* Master Logging Switch */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Audit Logging</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
                    Audit logging is currently {policy.logging_enabled ? <span style={{ color: 'var(--green)' }}>enabled</span> : <span style={{ color: 'var(--red)' }}>disabled</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                    When disabled, no Create/Update/Delete/Login actions will be recorded for any user.
                  </div>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 26, flexShrink: 0, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!policy.logging_enabled}
                    onChange={async e => {
                      const next = { ...policy, logging_enabled: e.target.checked ? 1 : 0 };
                      setPolicy(next);
                      try {
                        await api.put('/admin/logs/policy', next);
                        toast.success(`Audit logging ${e.target.checked ? 'enabled' : 'disabled'}`);
                      } catch (_) { toast.error('Failed to update logging setting'); }
                    }}
                    style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: 999,
                    background: policy.logging_enabled ? 'var(--primary)' : 'var(--gray-300)',
                    transition: 'background .15s'
                  }} />
                  <span style={{
                    position: 'absolute', top: 3, left: policy.logging_enabled ? 23 : 3,
                    width: 20, height: 20, borderRadius: '50%', background: 'white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left .15s'
                  }} />
                </label>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Log Rotation & Retention Policy</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
                <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
                  <label className="form-label">Retain logs for (days)</label>
                  <input className="form-control" type="number" min={7} max={3650} value={policy.retention_days}
                    onChange={e => setPolicy(p => ({ ...p, retention_days: parseInt(e.target.value) || 90 }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Auto-rotate</label>
                  <select className="form-control" value={policy.auto_rotate_enabled ? 1 : 0}
                    onChange={e => setPolicy(p => ({ ...p, auto_rotate_enabled: parseInt(e.target.value) === 1 }))}>
                    <option value={1}>Enabled</option><option value={0}>Disabled</option>
                  </select>
                </div>
                <button className="btn btn-outline btn-sm" onClick={savePolicy} disabled={savingPolicy}>{savingPolicy ? 'Saving...' : 'Save Policy'}</button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--amber)' }} onClick={runRotation} disabled={rotating}>{rotating ? 'Rotating...' : 'Run Rotation Now'}</button>
              </div>
              {policy.last_rotated_at && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gray-500)' }}>Last rotated: {policy.last_rotated_at} PKT</div>}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">Filter Logs</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div className="form-group" style={{ margin: 0, flex: '1 1 160px' }}>
                  <label className="form-label">Module</label>
                  <input className="form-control" placeholder="e.g. sale, purchase, users…" value={logFilter.module}
                    onChange={e => setLogFilter(p => ({ ...p, module: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0, flex: '1 1 140px' }}>
                  <label className="form-label">Action</label>
                  <select className="form-control" value={logFilter.action} onChange={e => setLogFilter(p => ({ ...p, action: e.target.value }))}>
                    <option value="">All Actions</option>
                    {['LOGIN','CREATE','UPDATE','DELETE','ROTATE'].map(a => <option key={a}>{a}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0, flex: '1 1 150px' }}>
                  <label className="form-label">From Date</label>
                  <input className="form-control" type="date" value={logFilter.from} onChange={e => setLogFilter(p => ({ ...p, from: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0, flex: '1 1 150px' }}>
                  <label className="form-label">To Date</label>
                  <input className="form-control" type="date" value={logFilter.to} onChange={e => setLogFilter(p => ({ ...p, to: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => loadLogs(1)}>Search</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setLogFilter({ module:'', action:'', from:'', to:'' }); setTimeout(() => loadLogs(1), 50); }}>↺ Reset</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Audit Logs</div><div className="text-sm text-muted mt-1">{logTotal} total entries</div></div>
            </div>
            <div className="table-wrap">
              {loadingLogs ? <div className="loading-center"><div className="spinner" /></div>
              : logs.length === 0 ? <div className="empty-state"><div className="empty-state-title">No log entries found</div></div>
              : (
                <table>
                  <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Description</th><th>IP</th></tr></thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontSize: 12, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>{l.created_at} <span style={{ color: 'var(--gray-400)' }}>PKT</span></td>
                        <td style={{ fontWeight: 600 }}>{l.username || '—'}</td>
                        <td><span className={'badge ' + (l.action === 'DELETE' ? 'badge-red' : l.action === 'CREATE' ? 'badge-green' : l.action === 'LOGIN' ? 'badge-blue' : 'badge-gray')}>{l.action}</span></td>
                        <td className="mono" style={{ fontSize: 12 }}>{l.module}</td>
                        <td className="mono" style={{ fontSize: 12, color: 'var(--gray-600)' }}>{l.record_id || '—'}</td>
                        <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>{l.description || '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--gray-400)' }}>{l.ip_address || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {totalPages > 1 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" disabled={logPage <= 1} onClick={() => loadLogs(logPage - 1)}>← Prev</button>
                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>Page {logPage} of {totalPages}</span>
                <button className="btn btn-ghost btn-sm" disabled={logPage >= totalPages} onClick={() => loadLogs(logPage + 1)}>Next →</button>
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
