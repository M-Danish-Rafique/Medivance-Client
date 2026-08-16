import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatDatePKT } from '../../utils/dateUtils';

// Endpoint segments are NOT simply "<type>s" (e.g. "city" -> "citys" is wrong),
// so map them explicitly. This was the source of the 404 on delete.
const ENDPOINTS = { city: 'cities', area: 'areas', territory: 'territories' };

function SortIcon({ active, dir }) {
  if (!active) return <span className="material-symbols-outlined sort-icon" style={{ fontSize: 16, opacity: 0.3 }}>unfold_more</span>;
  return (
    <span className="material-symbols-outlined sort-icon" style={{ fontSize: 16 }}>
      {dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
    </span>
  );
}

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

  // Drill-down context: which city/area we're currently viewing children of.
  const [context, setContext] = useState({}); // { cityId, cityName, areaId, areaName }

  // Per-tab sort state.
  const [sortConfig, setSortConfig] = useState({
    cities: { key: 'name', dir: 'asc' },
    areas: { key: 'name', dir: 'asc' },
    territories: { key: 'name', dir: 'asc' },
  });

  const load = () => {
    setLoading(true);
    api.get('/geography/geo').then(r => { setGeo(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const goToTab = (t) => {
    setActiveTab(t);
    setContext({});
    setSearch('');
  };

  const toggleSort = (tab, key) => {
    setSortConfig(prev => {
      const cur = prev[tab];
      const dir = cur.key === key && cur.dir === 'asc' ? 'desc' : 'asc';
      return { ...prev, [tab]: { key, dir } };
    });
  };

  const sortRows = (rows, tab) => {
    const { key, dir } = sortConfig[tab];
    return [...rows].sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  };

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
  const openAddArea = () => {
    setSelected(null);
    setForm({ name: '', city_id: context.cityId || '' });
    setModal('area');
  };
  const openEditArea = (a) => { setSelected(a); setForm({ name: a.name, city_id: a.city_id }); setModal('area'); };
  const saveArea = async () => {
    if (!form.name || !form.city_id) return toast.error('Name and city required');
    setSaving(true);
    try {
      if (selected) await api.put(`/geography/areas/${selected.id}`, form);
      else await api.post('/geography/areas', form);
      toast.success(selected ? 'Area updated' : 'Area added');
      setModal(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  // ---- Territory ----
  const openAddTerritory = () => {
    setSelected(null);
    setForm({ name: '', area_id: context.areaId || '', city_id: context.cityId || '' });
    setModal('territory');
  };
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
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); } finally { setSaving(false); }
  };

  // ---- Delete ----
  const openDelete = (item, type, e) => {
    e?.stopPropagation();
    setSelected({ ...item, _type: type });
    setDeleteModal(true);
  };
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const segment = ENDPOINTS[selected._type];
      await api.delete(`/geography/${segment}/${selected.id}`);
      toast.success('Deleted');
      setDeleteModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Error deleting - check for dependencies'); } finally { setDeleting(false); }
  };

  // ---- Drill-down navigation ----
  const drillIntoCity = (c) => {
    setContext({ cityId: c.id, cityName: c.name });
    setActiveTab('areas');
    setSearch('');
  };
  const drillIntoArea = (a) => {
    setContext({ cityId: a.city_id, cityName: a.city_name, areaId: a.id, areaName: a.name });
    setActiveTab('territories');
    setSearch('');
  };
  const clearAreaDrill = () => {
    setContext({ cityId: context.cityId, cityName: context.cityName });
    setActiveTab('areas');
    setSearch('');
  };

  const filteredAreasForCity = (city_id) => geo.areas.filter(a => a.city_id === parseInt(city_id));

  // ---- Base datasets (with computed counts, then context-filtered, then searched, then sorted) ----
  const citiesWithCounts = useMemo(() => geo.cities.map(c => ({
    ...c, areaCount: geo.areas.filter(a => a.city_id === c.id).length,
  })), [geo.cities, geo.areas]);

  const areasWithCounts = useMemo(() => geo.areas.map(a => ({
    ...a, territoryCount: geo.territories.filter(t => t.area_id === a.id).length,
  })), [geo.areas, geo.territories]);

  const visibleCities = useMemo(() => {
    let rows = citiesWithCounts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    return sortRows(rows, 'cities');
  }, [citiesWithCounts, search, sortConfig]);

  const visibleAreas = useMemo(() => {
    let rows = areasWithCounts;
    if (context.cityId) rows = rows.filter(a => a.city_id === context.cityId);
    rows = rows.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.city_name?.toLowerCase().includes(search.toLowerCase()));
    return sortRows(rows, 'areas');
  }, [areasWithCounts, context.cityId, search, sortConfig]);

  const visibleTerritories = useMemo(() => {
    let rows = geo.territories;
    if (context.areaId) rows = rows.filter(t => t.area_id === context.areaId);
    else if (context.cityId) rows = rows.filter(t => t.city_id === context.cityId);
    rows = rows.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.area_name?.toLowerCase().includes(search.toLowerCase()));
    return sortRows(rows, 'territories');
  }, [geo.territories, context.areaId, context.cityId, search, sortConfig]);

  const Th = ({ tab, sortKey, children, align }) => (
    <th
      onClick={() => toggleSort(tab, sortKey)}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align || 'left' }}
    >
      <span className="flex items-center gap-1" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {children}
        <SortIcon active={sortConfig[tab].key === sortKey} dir={sortConfig[tab].dir} />
      </span>
    </th>
  );

  const Breadcrumb = () => {
    if (activeTab === 'cities') return null;
    const crumbs = [{ label: 'All Cities', onClick: () => goToTab('cities') }];
    if (activeTab === 'areas') {
      crumbs.push({ label: context.cityName ? `Areas in ${context.cityName}` : 'All Areas' });
    } else if (activeTab === 'territories') {
      crumbs.push({ label: context.cityName ? context.cityName : 'Areas', onClick: () => (context.cityId ? clearAreaDrill() : goToTab('areas')) });
      crumbs.push({ label: context.areaName ? `Territories in ${context.areaName}` : 'All Territories' });
    }
    return (
      <div className="text-sm" style={{ padding: '10px 22px 0', color: 'var(--gray-400)' }}>
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span style={{ margin: '0 6px' }}>/</span>}
            {c.onClick ? (
              <button onClick={c.onClick} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary, #2563eb)', cursor: 'pointer', font: 'inherit' }}>
                {c.label}
              </button>
            ) : (
              <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{c.label}</span>
            )}
          </span>
        ))}
      </div>
    );
  };

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
              <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => goToTab(t)}>
                {t === 'cities' ? `Cities (${geo.cities.length})` : t === 'areas' ? `Areas (${geo.areas.length})` : `Territories (${geo.territories.length})`}
              </button>
            ))}
          </div>
        </div>

        <Breadcrumb />

        <div className="table-wrap">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : activeTab === 'cities' ? (
            visibleCities.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>location_city</span></div><div className="empty-state-title">No cities found</div></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <Th tab="cities" sortKey="name">City Name</Th>
                    <Th tab="cities" sortKey="areaCount">Areas</Th>
                    <Th tab="cities" sortKey="created_at">Added</Th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCities.map(c => (
                    <tr key={c.id} onClick={() => drillIntoCity(c)} style={{ cursor: 'pointer' }} className="row-hover">
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td><span className="badge badge-gray">{c.areaCount} areas</span></td>
                      <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{formatDatePKT(c.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openEditCity(c); }}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={(e) => openDelete(c, 'city', e)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : activeTab === 'areas' ? (
            visibleAreas.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>place</span></div><div className="empty-state-title">No areas found</div></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <Th tab="areas" sortKey="name">Area Name</Th>
                    <Th tab="areas" sortKey="city_name">City</Th>
                    <Th tab="areas" sortKey="territoryCount">Territories</Th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAreas.map(a => (
                    <tr key={a.id} onClick={() => drillIntoArea(a)} style={{ cursor: 'pointer' }} className="row-hover">
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td><span className="badge badge-blue">{a.city_name}</span></td>
                      <td><span className="badge badge-gray">{a.territoryCount}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openEditArea(a); }}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={(e) => openDelete(a, 'area', e)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            visibleTerritories.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>public</span></div><div className="empty-state-title">No territories found</div></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <Th tab="territories" sortKey="name">Territory Name</Th>
                    <Th tab="territories" sortKey="area_name">Area</Th>
                    <Th tab="territories" sortKey="city_name">City</Th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTerritories.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.name}</td>
                      <td><span className="badge badge-teal">{t.area_name}</span></td>
                      <td><span className="badge badge-blue">{t.city_name}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEditTerritory(t)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={(e) => openDelete(t, 'territory', e)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
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
            {filteredAreasForCity(form.city_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
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