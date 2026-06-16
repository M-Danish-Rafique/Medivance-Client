import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/formatters';
import Pagination from '../../components/common/Pagination';
import usePagination from '../../hooks/usePagination';

const today = () => new Date().toISOString().split('T')[0];
const emptyForm = { date: today(), category: 'Expense', description: '', expense_type_id: '', supplier_id: '', customer_id: '', amount: '', payment_type: '' };

export default function Finance() {
  const [data, setData] = useState([]);
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, pageItems: pagedData } = usePagination(data, 25);
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [expTypeModal, setExpTypeModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [balance, setBalance] = useState(null);
  const [newExpType, setNewExpType] = useState('');
  const [savingExpType, setSavingExpType] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/finance'), api.get('/suppliers'), api.get('/customers'), api.get('/finance/expense-types')])
      .then(([f, s, c, et]) => { setData(f.data); setSuppliers(s.data); setCustomers(c.data); setExpenseTypes(et.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const fetchBalance = async (type, id) => {
    if (!id) { setBalance(null); return; }
    try {
      if (type === 'supplier') {
        const r = await api.get(`/suppliers/${id}/balance`);
        setBalance({ label: 'Supplier Balance', value: r.data.balance });
      } else {
        const r = await api.get(`/customers/${id}/balance`);
        setBalance({ label: 'Customer Balance', value: r.data.balance });
      }
    } catch { setBalance(null); }
  };

  const handleCategoryChange = (cat) => {
    setForm(p => ({ ...p, category: cat, supplier_id: '', customer_id: '', payment_type: '' }));
    setBalance(null);
  };

  const handleSave = async () => {
    if (!form.date || !form.category || !form.amount) return toast.error('Date, category and amount required');
    if (form.category === 'Payment to Supplier' && !form.supplier_id) return toast.error('Select a supplier');
    if (form.category === 'Payment from Customer' && !form.customer_id) return toast.error('Select a customer');
    setSaving(true);
    try {
      await api.post('/finance', form);
      toast.success('Transaction saved');
      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/finance/${selected.id}`);
      toast.success('Transaction deleted'); setDeleteModal(false); load();
    } catch (err) { toast.error('Error'); } finally { setDeleting(false); }
  };

  const saveExpType = async () => {
    if (!newExpType) return toast.error('Name required');
    setSavingExpType(true);
    try {
      await api.post('/finance/expense-types', { name: newExpType });
      const r = await api.get('/finance/expense-types');
      setExpenseTypes(r.data); setNewExpType('');
      toast.success('Expense type added');
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSavingExpType(false); }
  };

  const deleteExpType = async (id) => {
    try {
      await api.delete(`/finance/expense-types/${id}`);
      const r = await api.get('/finance/expense-types');
      setExpenseTypes(r.data);
      toast.success('Deleted');
    } catch { toast.error('Error deleting'); }
  };

  const fmt = formatCurrency;
  const catColor = { 'Expense': 'badge-red', 'Payment to Supplier': 'badge-amber', 'Payment from Customer': 'badge-green' };

  return (
    <Layout title="Finance">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Finance Transactions</div>
            <div className="text-sm text-muted mt-1">{data.length} transactions</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={() => setExpTypeModal(true)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>settings</span>Expense Types</button>
            <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setBalance(null); setModal(true); }}>+ New Transaction</button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : data.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>account_balance_wallet</span></div><div className="empty-state-title">No transactions yet</div></div>
          ) : (
            <table>
              <thead>
                <tr><th>Date</th><th>Category</th><th>Description</th><th>Party</th><th>Amount</th><th>Payment Type</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
              </thead>
              <tbody>
                {pagedData.map(t => (
                  <tr key={t.id}>
                    <td>{new Date(t.date).toLocaleDateString()}</td>
                    <td><span className={`badge ${catColor[t.category] || 'badge-gray'}`} style={{ fontSize: 11 }}>{t.category}</span></td>
                    <td style={{ maxWidth: 200, color: 'var(--gray-600)', fontSize: 12 }}>{t.description || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{t.supplier_name || t.customer_name || (t.expense_type_name ? <span className="badge badge-gray">{t.expense_type_name}</span> : '—')}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(t.amount)}</td>
                    <td>{t.payment_type ? <span className="badge badge-blue" style={{ fontSize: 11 }}>{t.payment_type}</span> : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-danger btn-sm" onClick={() => { setSelected(t); setDeleteModal(true); }}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems}
          pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Transaction Modal */}
      <Modal isOpen={modal} onClose={() => setModal(false)} title="New Finance Transaction" size="md"
        footer={<><button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Transaction'}</button></>}>

        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-control" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Category *</label>
            <select className="form-control" value={form.category} onChange={e => handleCategoryChange(e.target.value)}>
              <option value="Expense">Expense</option>
              <option value="Payment to Supplier">Payment to Supplier</option>
              <option value="Payment from Customer">Payment from Customer</option>
            </select>
          </div>
        </div>

        {form.category === 'Expense' && (
          <div className="form-group">
            <div className="flex items-center justify-between mb-1">
              <label className="form-label" style={{ margin: 0 }}>Expense Type</label>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--blue)', padding: '2px 8px' }}
                onClick={() => setExpTypeModal(true)}>+ Manage Types</button>
            </div>
            <select className="form-control" value={form.expense_type_id} onChange={e => setForm(p => ({ ...p, expense_type_id: e.target.value }))}>
              <option value="">— Select Type —</option>
              {expenseTypes.map(et => <option key={et.id} value={et.id}>{et.name}</option>)}
            </select>
          </div>
        )}

        {form.category === 'Payment to Supplier' && (
          <div className="form-group">
            <label className="form-label">Supplier *</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <select className="form-control" value={form.supplier_id}
                onChange={e => { setForm(p => ({ ...p, supplier_id: e.target.value })); fetchBalance('supplier', e.target.value); }}>
                <option value="">— Select Supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {balance && (
                <div style={{ minWidth: 160, padding: '8px 12px', background: 'var(--blue-ultra)', border: '1px solid var(--blue-pale)', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ color: 'var(--gray-500)' }}>{balance.label}</div>
                  <div style={{ fontWeight: 700, color: parseFloat(balance.value) > 0 ? 'var(--red)' : 'var(--green)' }}>
                    {formatCurrency(Math.abs(balance.value))}
                    {parseFloat(balance.value) > 0 ? ' (Payable)' : ' (Paid)'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {form.category === 'Payment from Customer' && (
          <div className="form-group">
            <label className="form-label">Customer *</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <select className="form-control" value={form.customer_id}
                onChange={e => { setForm(p => ({ ...p, customer_id: e.target.value })); fetchBalance('customer', e.target.value); }}>
                <option value="">— Select Customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {balance && (
                <div style={{ minWidth: 160, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ color: 'var(--gray-500)' }}>{balance.label}</div>
                  <div style={{ fontWeight: 700, color: parseFloat(balance.value) > 0 ? 'var(--red)' : 'var(--green)' }}>
                    {formatCurrency(Math.abs(balance.value))}
                    {parseFloat(balance.value) > 0 ? ' (Receivable)' : ' (Settled)'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Description</label>
          <input className="form-control" placeholder="Optional description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </div>

        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Amount (PKR) *</label>
            <input className="form-control" type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          </div>

          {(form.category === 'Payment to Supplier' || form.category === 'Payment from Customer') && (
            <div className="form-group">
              <label className="form-label">Payment Type</label>
              <select className="form-control" value={form.payment_type} onChange={e => setForm(p => ({ ...p, payment_type: e.target.value }))}>
                <option value="">— Select —</option>
                {form.category === 'Payment from Customer'
                  ? ['Cash', 'Online', 'Cheque'].map(t => <option key={t}>{t}</option>)
                  : ['Cash', 'Online', 'Claim', 'Adjustment'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Expense Types Modal */}
      <Modal isOpen={expTypeModal} onClose={() => setExpTypeModal(false)} title="Manage Expense Types" size="sm">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input className="form-control" placeholder="New expense type..." value={newExpType} onChange={e => setNewExpType(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveExpType(); }} />
          <button className="btn btn-primary" onClick={saveExpType} disabled={savingExpType}>Add</button>
        </div>
        <div>
          {expenseTypes.length === 0 ? (
            <div className="text-sm text-muted" style={{ textAlign: 'center', padding: 20 }}>No expense types yet</div>
          ) : expenseTypes.map(et => (
            <div key={et.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
              <span style={{ fontSize: 14 }}>{et.name}</span>
              <button className="btn btn-danger btn-sm" onClick={() => deleteExpType(et.id)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting}
        message="Delete this transaction? Ledger balances will be reversed." />
    </Layout>
  );
}
