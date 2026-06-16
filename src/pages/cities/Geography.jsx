import React, { useState, useEffect } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';

export default function Geography() {
  const [geo, setGeo] = useState({ cities: [], areas: [], territories: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('cities');
  const [modal, setModal] = useState(null); // 'city' | 'area' | 'territory'
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/geography/geo').then(r => { setGeo(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  // ---- City ----
  const openAddCity = () => { setSelected(null); setForm({ name: '' }); setModal('city'); };
  const openEditCity = (c) => { setSelected(c); setForm({ name: c.name }); setModal('city'); };
  const saveCity = async () => {
    if (!form.name) return toast.error('City name required');
    setSaving(true);
    try {
      if (selected) await api.put(`/geography/cities/${selected.id}`, form);
      else await api.post('/geography/cities', form);
      toast.success(selected ? 'City updated' : 'City added');
      setModal(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  // ---- Area ----
  const openAddArea = () => { setSelected(null); setForm({ name: '', city_id: '' }); setModal('area'); };
  const openEditArea = (a) => { setSelected(a); setForm({ name: a.name, city_id: a.city_id }); setModal('area'); };
  const saveArea = async () => {
    if (!form.name || !form.city_id) return toast.error('Name and city required');
    setSaving(true);
    try {
      if (selected) await api.put(`/geography/areas/${selected.id}`, form);
      else await api.post('/geography/areas', form);
      toast.success(selected ? 'Area updated' : 'Area added');
      setModal(null); load();
    } catch (err) { toast.error('Error'); } finally { setSaving(false); }
  };

  // ---- Territory ----
  const openAddTerritory = () => { setSelected(null); setForm({ name: '', area_id: '', city_id: '' }); setModal('territory'); };
  const openEditTerritory = (t) => {
    const area = geo.areas.find(a => a.id === t.area_id);
    setSelected(t);
    setForm({ name: t.name, area_id: t.area_id, city_id: t.city_id || area?.city_id || '' });
    setModal('territory');
  };
  const saveTerritory = async () => {
    if (!form.name || !form.area_id) return toast.error('Name and area required');
    setSaving(true);
    try {
      if (selected) await api.put(`/geography/territories/${selected.id}`, form);
      else await api.post('/geography/territories', form);
      toast.success(selected ? 'Territory updated' : 'Territory added');
      setModal(null); load();
    } catch (err) { toast.error('Error'); } finally { setSaving(false); }
  };

  // ---- Delete ----
  const openDelete = (item, type) => { setSelected({ ...item, _type: type }); setDeleteModal(true); };
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const t = selected._type;
      await api.delete(`/geography/${t}s/${selected.id}`);
      toast.success('Deleted');
      setDeleteModal(false); load();
    } catch (err) { toast.error('Error deleting - check for dependencies'); } finally { setDeleting(false); }
  };

  const filteredAreas = (city_id) => geo.areas.filter(a => a.city_id === parseInt(city_id));

  const filteredCities = geo.cities.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredAreas2 = geo.areas.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.city_name?.toLowerCase().includes(search.toLowerCase()));
  const filteredTerritories = geo.territories.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.area_name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <Layout title="Cities & Territories">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Cities, Areas & Territories</div>
            <div className="text-sm text-muted mt-1">
              {geo.cities.length} cities · {geo.areas.length} areas · {geo.territories.length} territories
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="search-bar">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {activeTab === 'cities' && <button className="btn btn-primary" onClick={openAddCity}>+ Add City</button>}
            {activeTab === 'areas' && <button className="btn btn-primary" onClick={openAddArea}>+ Add Area</button>}
            {activeTab === 'territories' && <button className="btn btn-primary" onClick={openAddTerritory}>+ Add Territory</button>}
          </div>
        </div>

        <div style={{ padding: '0 22px' }}>
          <div className="tabs">
            {['cities', 'areas', 'territories'].map(t => (
              <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => { setActiveTab(t); setSearch(''); }}>
                {t === 'cities' ? `Cities (${geo.cities.length})` : t === 'areas' ? `Areas (${geo.areas.length})` : `Territories (${geo.territories.length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : activeTab === 'cities' ? (
            filteredCities.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>location_city</span></div><div className="empty-state-title">No cities found</div></div>
            ) : (
              <table>
                <thead><tr><th>City Name</th><th>Areas</th><th>Added</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {filteredCities.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td><span className="badge badge-gray">{geo.areas.filter(a => a.city_id === c.id).length} areas</span></td>
                      <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{new Date(c.created_at).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEditCity(c)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={() => openDelete(c, 'city')}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : activeTab === 'areas' ? (
            filteredAreas2.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>place</span></div><div className="empty-state-title">No areas found</div></div>
            ) : (
              <table>
                <thead><tr><th>Area Name</th><th>City</th><th>Territories</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {filteredAreas2.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td><span className="badge badge-blue">{a.city_name}</span></td>
                      <td><span className="badge badge-gray">{geo.territories.filter(t => t.area_id === a.id).length}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEditArea(a)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={() => openDelete(a, 'area')}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            filteredTerritories.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>public</span></div><div className="empty-state-title">No territories found</div></div>
            ) : (
              <table>
                <thead><tr><th>Territory Name</th><th>Area</th><th>City</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {filteredTerritories.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.name}</td>
                      <td><span className="badge badge-teal">{t.area_name}</span></td>
                      <td><span className="badge badge-teal">{t.area_name}</span></td>
                      <td><span className="badge badge-blue">{t.city_name}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEditTerritory(t)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={() => openDelete(t, 'territory')}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

      {/* City Modal */}
      <Modal isOpen={modal === 'city'} onClose={() => setModal(null)} title={selected ? 'Edit City' : 'Add City'} size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveCity} disabled={saving}>{saving ? 'Saving...' : selected ? 'Save' : 'Add City'}</button></>}>
        <div className="form-group">
          <label className="form-label">City Name *</label>
          <input className="form-control" placeholder="e.g. Karachi" value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
        </div>
      </Modal>

      {/* Area Modal */}
      <Modal isOpen={modal === 'area'} onClose={() => setModal(null)} title={selected ? 'Edit Area' : 'Add Area'} size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveArea} disabled={saving}>{saving ? 'Saving...' : selected ? 'Save' : 'Add Area'}</button></>}>
        <div className="form-group">
          <label className="form-label">Select City *</label>
          <select className="form-control" value={form.city_id || ''} onChange={e => setForm(p => ({ ...p, city_id: e.target.value }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Area Name *</label>
          <input className="form-control" placeholder="e.g. Gulshan-e-Iqbal" value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        </div>
      </Modal>

      {/* Territory Modal */}
      <Modal isOpen={modal === 'territory'} onClose={() => setModal(null)} title={selected ? 'Edit Territory' : 'Add Territory'} size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveTerritory} disabled={saving}>{saving ? 'Saving...' : selected ? 'Save' : 'Add Territory'}</button></>}>
        <div className="form-group">
          <label className="form-label">Select City *</label>
          <select className="form-control" value={form.city_id || ''} onChange={e => setForm(p => ({ ...p, city_id: e.target.value, area_id: '' }))}>
            <option value="">— Select City —</option>
            {geo.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Select Area *</label>
          <select className="form-control" value={form.area_id || ''} onChange={e => setForm(p => ({ ...p, area_id: e.target.value }))} disabled={!form.city_id}>
            <option value="">— Select Area —</option>
            {filteredAreas(form.city_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Territory Name *</label>
          <input className="form-control" placeholder="e.g. Block 5" value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteModal} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} loading={deleting}
        message={`Delete "${selected?.name}"? All dependent areas/territories will also be removed.`} />
    </Layout>
  );
}
