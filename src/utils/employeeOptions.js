// Master Data pickers (Salesman, Delivery By, Supplier) list Active people
// only: GET /employees leaves Inactive rows out unless ?include_inactive=1.
//
// The one exception: a person already saved on the record being edited stays
// selectable, so the field never looks empty. They are appended to the list,
// labelled "Name (inactive)" when they have been deactivated since. The name
// and status come from the record itself (GET /sales/:id returns
// salesman_name/_status and delivery_by_name/_status), never a new request.
// The server accepts such a value only while it is unchanged.
export function withSavedEmployee(list, { id, name, status, ...rest }) {
  if (!id || !name) return list;
  if (list.some(person => String(person.id) === String(id))) return list;
  return [
    ...list,
    { ...rest, id, name: status === 'Inactive' ? `${name} (inactive)` : name, status },
  ];
}
