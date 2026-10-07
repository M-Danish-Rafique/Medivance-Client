import React from 'react';

// Shown under a Salesman / Delivery By / Supplier picker when the selected
// person is an inactive one kept only because they are saved on the invoice
// (see utils/employeeOptions.js withSavedEmployee). The option label already
// says "(inactive)", but a narrow select can clip it, so the note states it.
export default function SavedInactiveNote({ people, value }) {
  const selected = value
    ? (people || []).find(person => String(person.id) === String(value))
    : null;
  if (!selected || selected.status !== 'Inactive') return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
      Inactive. Saved on this invoice.
    </div>
  );
}
