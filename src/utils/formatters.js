/**
 * Format CNIC: 5-7-1 with dashes
 * Input: raw digits only
 * Output: XXXXX-XXXXXXX-X
 */
export function formatCNIC(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  let result = digits;
  if (digits.length > 5) result = digits.slice(0, 5) + '-' + digits.slice(5);
  if (digits.length > 12) result = result.slice(0, 13) + '-' + result.slice(13);
  return result;
}

export function handleCNICInput(e, setter) {
  const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 13);
  setter(formatCNIC(raw));
}

/**
 * Format phone: spaces after every 4 chars, allow + at start
 * e.g. 0308 8421202  or  +92 308 8421202
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (hasPlus) {
    const code = digits.slice(0, 2);
    const part1 = digits.slice(2, 5);
    const part2 = digits.slice(5, 12);
    let formatted = '+' + code;
    if (part1) formatted += ' ' + part1;
    if (part2) formatted += ' ' + part2;
    return formatted;
  }

  if (digits.startsWith('0')) {
    const part1 = digits.slice(0, 4);
    const part2 = digits.slice(4, 11);
    let formatted = part1;
    if (part2) formatted += ' ' + part2;
    return formatted;
  }

  // Fallback: group digits by 4 for any other input
  const chunks = [];
  let i = 0;
  while (i < digits.length) {
    chunks.push(digits.slice(i, i + 4));
    i += 4;
  }
  return chunks.join(' ');
}

export function handlePhoneInput(e, setter) {
  const raw = String(e.target.value || '');
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  if (hasPlus) {
    const code = digits.slice(0, 2);
    const part1 = digits.slice(2, 5);
    const part2 = digits.slice(5, 12);
    let formatted = '+' + code;
    if (part1) formatted += ' ' + part1;
    if (part2) formatted += ' ' + part2;
    return setter(formatted);
  }

  if (digits.startsWith('0')) {
    const part1 = digits.slice(0, 4);
    const part2 = digits.slice(4, 11);
    let formatted = part1;
    if (part2) formatted += ' ' + part2;
    return setter(formatted);
  }

  const chunks = [];
  let i = 0;
  while (i < digits.length) {
    chunks.push(digits.slice(i, i + 4));
    i += 4;
  }
  setter(chunks.join(' '));
}

export function formatDecimal(value, maximumFractionDigits = 2) {
  const number = parseFloat(value);
  if (Number.isNaN(number)) return '—';
  return number.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

export function formatCurrency(value, currency = 'PKR ') {
  const formatted = formatDecimal(value, 2);
  return formatted === '—' ? '—' : `${currency}${formatted}`;
}
