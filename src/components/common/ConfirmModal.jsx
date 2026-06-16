import React from 'react';
import Modal from './Modal';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title = 'Confirm Delete', message = 'Are you sure you want to delete this record? This action cannot be undone.', loading }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Deleting...' : <><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>delete</span>Delete</>}
          </button>
        </>
      }>
      <div className="alert alert-danger" style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>warning</span>
        <span>{message}</span>
      </div>
    </Modal>
  );
}
