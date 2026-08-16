import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/common/Modal';
import ConfirmModal from '../../components/common/ConfirmModal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { formatDatePKT } from '../../utils/dateUtils';

// Endpoint segments are NOT simply "<type>s" (e.g. "city" -> "citys" is wrong),
// so map them explicitly. This was the source of a 404 on delete.
const ENDPOINTS = { city: 'cities', area: 'areas', territory: 'territories' };

function SortIcon({ active, dir }) {
  return (
    <span className="material-symbols-outlined sort-icon" style={{ fontSize: 15, opacity: active ? 1 : 0.35, transition: 'opacity .15s' }}>
      {active ? (dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
    </span>
  );
}

function SkeletonRows({ cols, rows = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j}><div className="skeleton-bar" style={{ width: j === 0 ? '60%' : '40%' }} /></td>
          ))}
        </tr>
      ))}
    </>
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

  const deleteMessage = useMemo(() => {
    if (!selected) return '';
    if (selected._type === 'city') {
      const n = geo.areas.filter(a => a.city_id === selected.id).length;
      return n > 0
        ? `Delete "${selected.name}"? This will also remove ${n} area${n === 1 ? '' : 's'} and every territory under ${n === 1 ? 'it' : 'them'}.`
        : `Delete "${selected.name}"? This city has no areas yet.`;
    }
    if (selected._type === 'area') {
      const n = geo.territories.filter(t => t.area_id === selected.id).length;
      return n > 0
        ? `Delete "${selected.name}"? This will also remove ${n} territor${n === 1 ? 'y' : 'ies'}.`
        : `Delete "${selected.name}"? This area has no territories yet.`;
    }
    return `Delete territory "${selected.name}"? This cannot be undone.`;
  }, [selected, geo]);

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
  const goBack = () => {
    if (activeTab === 'territories') {
      if (context.areaId) clearAreaDrill();
      else goToTab('cities');
    } else if (activeTab === 'areas') {
      goToTab('cities');
    }
  };
  const onRowKeyDown = (e, fn) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  };

  const filteredAreasForCity = (city_id) => geo.areas.filter(a => a.city_id === parseInt(city_id));

  // ---- Base datasets (computed counts -> context filter -> search -> sort) ----
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

  const addLabel = activeTab === 'cities' ? '+ Add City'
    : activeTab === 'areas' ? (context.cityName ? `+ Add Area to ${context.cityName}` : '+ Add Area')
    : (context.areaName ? `+ Add Territory to ${context.areaName}` : '+ Add Territory');

  const Th = ({ tab, sortKey, children, align }) => {
    const active = sortConfig[tab].key === sortKey;
    return (
      <th
        onClick={() => toggleSort(tab, sortKey)}
        style={{ cursor: 'pointer', userSelect: 'none', textAlign: align || 'left', color: active ? 'var(--gray-900, #111)' : undefined }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
          {children}
          <SortIcon active={active} dir={sortConfig[tab].dir} />
        </span>
      </th>
    );
  };

  const Breadcrumb = () => {
    if (activeTab === 'cities') return null;
    if (!context.cityId && !context.areaId) return null; // no filter active - nothing to show a trail for
    const crumbs = [{ label: 'All Cities', onClick: () => goToTab('cities') }];
    if (activeTab === 'areas') {
      crumbs.push({ label: context.cityName ? `Areas in ${context.cityName}` : 'All Areas' });
    } else if (activeTab === 'territories') {
      crumbs.push({ label: context.cityName ? context.cityName : 'Areas', onClick: () => (context.cityId ? clearAreaDrill() : goToTab('areas')) });
      crumbs.push({ label: context.areaName ? `Territories in ${context.areaName}` : 'All Territories' });
    }
    return (
      <div className="breadcrumb-bar">
        <button className="breadcrumb-back" onClick={goBack} aria-label="Go back">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
        </button>
        <div className="flex items-center" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && <span className="material-symbols-outlined" style={{ fontSize: 16, margin: '0 4px', color: 'var(--gray-300)' }}>chevron_right</span>}
              {c.onClick ? (
                <button className="breadcrumb-link" onClick={c.onClick}>{c.label}</button>
              ) : (
                <span className="breadcrumb-current">{c.label}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const emptyCta = () => {
    if (activeTab === 'cities') return <button className="btn btn-primary btn-sm" onClick={openAddCity}>+ Add your first city</button>;
    if (activeTab === 'areas') return <button className="btn btn-primary btn-sm" onClick={openAddArea}>{context.cityName ? `+ Add area to ${context.cityName}` : '+ Add an area'}</button>;
    return <button className="btn btn-primary btn-sm" onClick={openAddTerritory}>{context.areaName ? `+ Add territory to ${context.areaName}` : '+ Add a territory'}</button>;
  };

  return (
    <Layout title="Cities & Territories">
      <style>{`
        .skeleton-bar { height: 12px; border-radius: 4px; background: linear-gradient(90deg, var(--gray-100,#eee) 25%, var(--gray-200,#e2e2e2) 37%, var(--gray-100,#eee) 63%); background-size: 400% 100%; animation: skeleton-pulse 1.4s ease infinite; }
        @keyframes skeleton-pulse { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
        .row-hover:hover { background: var(--gray-50, #fafafa); }
        .row-hover:focus-visible { outline: 2px solid var(--primary,#2563eb); outline-offset: -2px; }
        .drill-chevron { color: var(--gray-300,#ccc); transition: transform .15s, color .15s; }
        .row-hover:hover .drill-chevron { color: var(--gray-500,#888); transform: translateX(2px); }
        .breadcrumb-bar { display: flex; align-items: center; gap: 8px; padding: 10px 22px; border-bottom: 1px solid var(--gray-100,#f0f0f0); background: var(--gray-50,#fafafa); }
        .breadcrumb-back { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--gray-200,#e5e5e5); background: white; cursor: pointer; color: var(--gray-600,#555); }
        .breadcrumb-back:hover { background: var(--gray-100,#f2f2f2); }
        .breadcrumb-link { background: none; border: none; padding: 0; font: inherit; font-size: 13px; color: var(--primary,#2563eb); cursor: pointer; }
        .breadcrumb-link:hover { text-decoration: underline; }
        .breadcrumb-current { font-size: 13px; font-weight: 600; color: var(--gray-700,#333); }
        .search-clear { background: none; border: none; cursor: pointer; display: flex; color: var(--gray-400,#999); }
      `}</style>

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
              {search && (
                <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                </button>
              )}
            </div>
            {activeTab === 'cities' && <button className="btn btn-primary" onClick={openAddCity}>{addLabel}</button>}
            {activeTab === 'areas' && <button className="btn btn-primary" onClick={openAddArea}>{addLabel}</button>}
            {activeTab === 'territories' && <button className="btn btn-primary" onClick={openAddTerritory}>{addLabel}</button>}
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
          {activeTab === 'cities' ? (
            loading ? (
              <table><tbody><SkeletonRows cols={4} /></tbody></table>
            ) : visibleCities.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>location_city</span></div>
                <div className="empty-state-title">{search ? 'No cities match your search' : 'No cities yet'}</div>
                {!search && <div style={{ marginTop: 10 }}>{emptyCta()}</div>}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <Th tab="cities" sortKey="name">City Name</Th>
                    <Th tab="cities" sortKey="areaCount">Areas</Th>
                    <Th tab="cities" sortKey="created_at">Added</Th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                    <th style={{ width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCities.map(c => (
                    <tr key={c.id} onClick={() => drillIntoCity(c)} onKeyDown={(e) => onRowKeyDown(e, () => drillIntoCity(c))}
                      tabIndex={0} role="button" style={{ cursor: 'pointer' }} className="row-hover">
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td><span className="badge badge-gray">{c.areaCount} areas</span></td>
                      <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{formatDatePKT(c.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openEditCity(c); }}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={(e) => openDelete(c, 'city', e)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                      <td><span className="material-symbols-outlined drill-chevron" style={{ fontSize: 18 }}>chevron_right</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : activeTab === 'areas' ? (
            loading ? (
              <table><tbody><SkeletonRows cols={4} /></tbody></table>
            ) : visibleAreas.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>place</span></div>
                <div className="empty-state-title">{search ? 'No areas match your search' : context.cityName ? `No areas in ${context.cityName} yet` : 'No areas yet'}</div>
                {!search && <div style={{ marginTop: 10 }}>{emptyCta()}</div>}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <Th tab="areas" sortKey="name">Area Name</Th>
                    <Th tab="areas" sortKey="city_name">City</Th>
                    <Th tab="areas" sortKey="territoryCount">Territories</Th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                    <th style={{ width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAreas.map(a => (
                    <tr key={a.id} onClick={() => drillIntoArea(a)} onKeyDown={(e) => onRowKeyDown(e, () => drillIntoArea(a))}
                      tabIndex={0} role="button" style={{ cursor: 'pointer' }} className="row-hover">
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td><span className="badge badge-blue">{a.city_name}</span></td>
                      <td><span className="badge badge-gray">{a.territoryCount}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openEditArea(a); }}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</span></button>
                          <button className="btn btn-danger btn-sm" onClick={(e) => openDelete(a, 'area', e)}><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</span></button>
                        </div>
                      </td>
                      <td><span className="material-symbols-outlined drill-chevron" style={{ fontSize: 18 }}>chevron_right</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            loading ? (
              <table><tbody><SkeletonRows cols={3} /></tbody></table>
            ) : visibleTerritories.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><span className="material-symbols-outlined" style={{ fontSize: 28 }}>public</span></div>
                <div className="empty-state-title">{search ? 'No territories match your search' : context.areaName ? `No territories in ${context.areaName} yet` : 'No territories yet'}</div>
                {!search && <div style={{ marginTop: 10 }}>{emptyCta()}</div>}
              </div>
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
                    <tr key={t.id} className="row-hover">
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
        message={deleteMessage} />
    </Layout>
  );
}