const PKT_TZ = 'Asia/Karachi';

export const todayPKT = (date = new Date()) => {
  const baseDate = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PKT_TZ,
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

  return date.toLocaleDateString('en-GB', { timeZone: PKT_TZ });
};

/** e.g. "May 2026" — month + year only in Asia/Karachi */
export const formatMonthYearPKT = (dateValue) => {
  if (!dateValue) return '—';

  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-GB', {
    timeZone: PKT_TZ,
    month: 'long',
    year: 'numeric',
  });
};

export const formatLongDatePKT = (dateValue = new Date()) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-PK', {
    timeZone: PKT_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const yearPKT = (date = new Date()) => {
  const [year] = todayPKT(date).split('-');
  return Number(year);
};

/** Add calendar months; returns YYYY-MM-DD in PKT calendar space. */
export const addMonthsPKT = (dateValue, months) => {
  const str =
    typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)
      ? dateValue.slice(0, 10)
      : todayPKT(dateValue);
  if (!str) return null;

  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
};
