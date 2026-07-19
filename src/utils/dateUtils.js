export const todayPKT = (date = new Date()) => {
  const baseDate = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(baseDate);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
};

export const formatDatePKT = (dateValue) => {
  if (!dateValue) return '—';

  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
};
