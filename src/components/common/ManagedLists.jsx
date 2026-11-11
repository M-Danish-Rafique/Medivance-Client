import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { Segmented, BusyButton } from '../../pages/hr/HrKit';
import { normKey, cleanText, plural, mfgError } from '../../pages/manufacturing/mfgKit';

// ─── Managed lists ─────────────────────────────────────────────────────────
// Short lists the users keep themselves (Manufacturing: categories and pack
// types; Assets: asset types and owners): add, rename in place, delete when
// unused, plus "+ New" beside a picker's label. The look comes from
// MFG_STYLES (mfg-cat-*, mfg-new-pop, mfg-text-btn), so the page mounts
// <MfgStyles />.
//
// A list is a module-level constant:
//   path         the endpoint (GET/POST, PUT/DELETE /:id)
//   noun, Noun   'category' / 'Category'; aNoun 'a category' (or 'an owner')
//   nounPlural   'categories' (the empty list)
//   listLabel    the list's accessible name ('Product categories')
//   maxLength, placeholder
//   countKey     the usage count on each row ('product_count')
//   countOne, countMany  its unit ('product', 'products')
//   lockedRename(row), lockedDelete(row)  the reason the action is refused
//     while the row is in use, or null
// The client checks mirror the server, which stays authoritative.

export const sortByName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
const aNounOf = (list) => list.aNoun || `a ${list.noun}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dupMessage = (list, name) => `${capital(aNounOf(list))} named "${name}" already exists.`;

// ── "+ New" beside a picker's label ────────────────────────────────────────
// A small popover under the label with one name field and Cancel / Add, so a
// missing item is added without leaving the form (never a dialog over the
// dialog). Enter = Add, Esc = Cancel (the dialog stays open). On Add the item
// is created, selected in the picker, the popover closes and focus returns to
// the picker. The field's wrapper must be position: relative (MfgField with a
// labelAction is).
export function InlineNew({ list, items, pickerId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const buttonRef = useRef(null);
  const inputId = `${pickerId}-new`;

  const close = (focusPicker) => {
    setOpen(false); setName(''); setError(null);
    setTimeout(() => (focusPicker ? document.getElementById(pickerId) : buttonRef.current)?.focus(), 0);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false); setName(''); setError(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = async () => {
    const clean = cleanText(name);
    if (!clean) { setError(`Enter ${aNounOf(list)} name.`); return; }
    const dup = items.find(x => normKey(x.name) === normKey(clean));
    if (dup) { setError(dupMessage(list, dup.name)); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post(list.path, { name: clean });
      onCreated(r.data);
      close(true);
    } catch (err) {
      setError(mfgError(err, `The ${list.noun} could not be added. Try again.`));
    } finally { setBusy(false); }
  };

  return (
    <>
      <button ref={buttonRef} type="button" className="mfg-text-btn" aria-expanded={open}
        aria-label={`New ${list.noun}`} onClick={() => (open ? close(false) : setOpen(true))}>
        <span className="material-symbols-outlined" aria-hidden="true">add</span>New
      </button>
      {open && (
        <div ref={boxRef} className="mfg-new-pop" role="dialog" aria-label={`New ${list.noun}`}>
          <label className="hr-sr-only" htmlFor={inputId}>{list.placeholder}</label>
          <input
            id={inputId}
            className={`form-control${error ? ' hr-invalid' : ''}`}
            placeholder={list.placeholder}
            value={name}
            maxLength={list.maxLength}
            disabled={busy}
            autoFocus
            onChange={e => { setName(e.target.value); setError(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); add(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
            }}
          />
          {error && (
            <div className="hr-error" role="alert" style={{ marginTop: 6 }}>
              <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{error}</span>
            </div>
          )}
          <div className="mfg-new-pop-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => close(false)} disabled={busy}>Cancel</button>
            <BusyButton className="btn btn-primary btn-sm" busy={busy} busyLabel="Adding…" onClick={add}>Add</BusyButton>
          </div>
        </div>
      )}
    </>
  );
}

// ── Lists pop-up ───────────────────────────────────────────────────────────
// Two (or more) lists behind a Segmented switch, over the same rows: add,
// rename in place and delete-when-unused. Add and Save show a busy state,
// then the new or renamed row is briefly highlighted. Opens on the first tab.
//   tabs: [{ key, label, list, rows }]   onChanged(key, nextRows)
export function ListsDialog({ isOpen, onClose, title, tabs, onChanged }) {
  const first = tabs[0].key;
  const [which, setWhich] = useState(first);
  useEffect(() => { if (!isOpen) setWhich(first); }, [isOpen, first]);
  const current = tabs.find(t => t.key === which) || tabs[0];
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div style={{ marginBottom: 14 }}>
        <Segmented
          ariaLabel="List"
          value={current.key}
          onChange={setWhich}
          options={tabs.map(t => ({ val: t.key, label: t.label }))}
        />
      </div>
      {isOpen && (
        <ListEditor
          key={current.key}
          list={current.list}
          rows={current.rows}
          onChanged={next => onChanged(current.key, next)}
        />
      )}
    </Modal>
  );
}

export function ListEditor({ list, rows, onChanged }) {
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [rowNotice, setRowNotice] = useState(null);     // { id, message }
  const [flashId, setFlashId] = useState(null);
  const rowRefs = useRef({});
  const countOf = (c) => c[list.countKey];

  useEffect(() => {
    if (!flashId) return undefined;
    rowRefs.current[flashId]?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setFlashId(null), 1900);
    return () => clearTimeout(t);
  }, [flashId, rows]);

  const dupOf = (name, exceptId) => rows.find(c => c.id !== exceptId && normKey(c.name) === normKey(name));

  const add = async () => {
    const name = cleanText(newName);
    if (!name) { setAddError(`Enter ${aNounOf(list)} name.`); return; }
    const dup = dupOf(name);
    if (dup) { setAddError(dupMessage(list, dup.name)); return; }
    setAdding(true); setAddError(null);
    try {
      const r = await api.post(list.path, { name });
      onChanged(sortByName([...rows, r.data]));
      setFlashId(r.data.id);
      setNewName('');
      toast.success(`${list.Noun} ${r.data.name} added.`);
    } catch (err) {
      setAddError(mfgError(err, `The ${list.noun} could not be added. Try again.`));
    } finally { setAdding(false); }
  };

  const startEdit = (c) => {
    const locked = list.lockedRename(c);
    if (countOf(c) > 0 && locked) { setRowNotice({ id: c.id, message: locked }); return; }
    setEditId(c.id); setEditName(c.name); setEditError(null); setConfirmId(null); setRowNotice(null);
  };
  const cancelEdit = () => { setEditId(null); setEditError(null); };
  const saveEdit = async () => {
    const name = cleanText(editName);
    const current = rows.find(c => c.id === editId);
    if (!name) { setEditError(`Enter ${aNounOf(list)} name.`); return; }
    if (current && name === current.name) { cancelEdit(); return; }
    const dup = dupOf(name, editId);
    if (dup) { setEditError(dupMessage(list, dup.name)); return; }
    setSavingEdit(true); setEditError(null);
    try {
      const r = await api.put(`${list.path}/${editId}`, { name });
      onChanged(sortByName(rows.map(c => (c.id === editId ? { ...c, ...r.data } : c))));
      setFlashId(editId);
      setEditId(null);
      toast.success(`${list.Noun} renamed to ${r.data.name}.`);
    } catch (err) {
      setEditError(mfgError(err, `The ${list.noun} could not be renamed. Try again.`));
    } finally { setSavingEdit(false); }
  };

  const remove = async (c) => {
    setDeletingId(c.id);
    try {
      await api.delete(`${list.path}/${c.id}`);
      onChanged(rows.filter(x => x.id !== c.id));
      setConfirmId(null);
      toast.success(`${list.Noun} ${c.name} deleted.`);
    } catch (err) {
      setConfirmId(null);
      setRowNotice({ id: c.id, message: mfgError(err, `The ${list.noun} could not be deleted. Try again.`) });
    } finally { setDeletingId(null); }
  };

  // Escape inside an inline editor cancels the edit, not the dialog.
  const editKeys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  };

  return (
    <>
      <div className="mfg-cat-add">
        <div style={{ flex: 1 }}>
          <label className="hr-sr-only" htmlFor="list-new">{list.placeholder}</label>
          <input
            id="list-new"
            className={`form-control${addError ? ' hr-invalid' : ''}`}
            placeholder={list.placeholder}
            value={newName}
            maxLength={list.maxLength}
            disabled={adding}
            onChange={e => { setNewName(e.target.value); setAddError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
        </div>
        <BusyButton busy={adding} busyLabel="Adding…" icon="add" onClick={add}>Add</BusyButton>
      </div>
      <div className="hr-field-msg" style={{ marginBottom: 8 }}>
        {addError && (
          <div className="hr-error" role="alert">
            <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{addError}</span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="hr-lines-empty">{`No ${list.nounPlural} added yet.`}</div>
      ) : (
        <ul className="mfg-cat-list" aria-label={list.listLabel}>
          {rows.map(c => {
            const isEditing = editId === c.id;
            const used = countOf(c) > 0;
            const renameLock = used ? list.lockedRename(c) : null;
            const deleteLock = used ? list.lockedDelete(c) : null;
            return (
              <li key={c.id} ref={el => { rowRefs.current[c.id] = el; }} className={`mfg-cat-row${flashId === c.id ? ' mfg-flash' : ''}`}>
                {isEditing ? (
                  <div className="mfg-cat-edit">
                    <div style={{ flex: 1 }}>
                      <label className="hr-sr-only" htmlFor={`list-edit-${c.id}`}>{`${list.Noun} name`}</label>
                      <input
                        id={`list-edit-${c.id}`}
                        className={`form-control${editError ? ' hr-invalid' : ''}`}
                        value={editName}
                        maxLength={list.maxLength}
                        disabled={savingEdit}
                        autoFocus
                        onChange={e => { setEditName(e.target.value); setEditError(null); }}
                        onKeyDown={editKeys}
                      />
                      {editError && (
                        <div className="hr-error" role="alert" style={{ marginTop: 4 }}>
                          <span className="material-symbols-outlined" aria-hidden="true">error</span><span>{editError}</span>
                        </div>
                      )}
                    </div>
                    <button type="button" className="btn btn-outline btn-sm" onClick={cancelEdit} disabled={savingEdit}>Cancel</button>
                    <BusyButton className="btn btn-primary btn-sm" busy={savingEdit} busyLabel="Saving…" onClick={saveEdit}>Save</BusyButton>
                  </div>
                ) : confirmId === c.id ? (
                  <div className="mfg-cat-edit">
                    <span className="mfg-cat-name">{`Delete ${c.name}?`}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmId(null)} disabled={deletingId === c.id}>Cancel</button>
                    <BusyButton className="btn btn-danger btn-sm" busy={deletingId === c.id} busyLabel="Deleting…" onClick={() => remove(c)}>Delete</BusyButton>
                  </div>
                ) : (
                  <>
                    <span className="mfg-cat-name">{c.name}</span>
                    <span className="mfg-cat-count">{countOf(c) ? plural(countOf(c), list.countOne, list.countMany) : 'Unused'}</span>
                    <button
                      type="button"
                      className="mfg-icon-btn"
                      aria-label={`Rename ${c.name}`}
                      aria-disabled={renameLock ? 'true' : undefined}
                      title={renameLock || 'Rename'}
                      onClick={() => startEdit(c)}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                    </button>
                    <button
                      type="button"
                      className="mfg-icon-btn is-danger"
                      aria-label={`Delete ${c.name}`}
                      aria-disabled={deleteLock ? 'true' : undefined}
                      title={deleteLock || 'Delete'}
                      onClick={() => (deleteLock ? setRowNotice({ id: c.id, message: deleteLock }) : (setConfirmId(c.id), setRowNotice(null), setEditId(null)))}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                    </button>
                  </>
                )}
                {rowNotice?.id === c.id && !isEditing && (
                  <div className="mfg-cat-notice" role="status">
                    <span className="material-symbols-outlined" aria-hidden="true">block</span>
                    {rowNotice.message}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
