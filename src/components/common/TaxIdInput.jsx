import React, { useEffect, useRef } from 'react';

// ─── Tax ID input ─────────────────────────────────────────────────
// A single controlled input that handles both NTN and STRN with:
//
//   * Digit-only input — every non-digit keystroke is blocked at keydown
//     time so the character never lands in the field. Paste is sanitized.
//   * Live auto-dash masking — the mask is rebuilt after every keystroke
//     from the clean digit string, so dashes appear the moment the user
//     types the digit that "earns" one.
//   * Caret preservation — inserting/removing dashes doesn't yank the
//     caret to the end. We count digits before the caret pre-format and
//     re-position after Nth digit in the post-format string.
//   * Natural Backspace — when the caret sits right after an auto-dash,
//     Backspace deletes the digit BEFORE the dash instead of the dash
//     itself (which would just reappear after re-format).
//
// State contract
// --------------
//   `value`     — the clean digit string (0-9 only, no dashes). What the
//                  parent stores in local state / posts to the API.
//   `onChange`  — called with a fresh clean digit string.
//   The displayed formatted string is derived, not stored.
//
// Formats
// -------
//   STRN         13 digits, `XX-XX-XXXX-XXX-XX`.
//   NTN, 1-7     no dash yet (raw digits).
//   NTN, 8       Corporate `XXXXXXX-X`.
//   NTN, 9-13    Individual (CNIC) `XXXXX-XXXXXXX-X`.
//   The 8 → 9 transition automatically swaps the corporate mask for the
//   CNIC mask; the transition is reversible on Backspace.

const MAX_DIGITS = 13;

// STRN: XX-XX-XXXX-XXX-XX  (2 + 2 + 4 + 3 + 2 = 13 digits)
function formatSTRN(d) {
  const parts = [
    d.slice(0, 2),
    d.slice(2, 4),
    d.slice(4, 8),
    d.slice(8, 11),
    d.slice(11, 13),
  ].filter(Boolean);
  return parts.join('-');
}

// NTN: dual-format based on length.
function formatNTN(d) {
  if (d.length === 0) return '';
  if (d.length <= 7) return d;
  if (d.length === 8) return d.slice(0, 7) + '-' + d.slice(7);
  // 9-13 → CNIC-style XXXXX-XXXXXXX-X
  const parts = [
    d.slice(0, 5),
    d.slice(5, 12),
    d.slice(12, 13),
  ].filter(Boolean);
  return parts.join('-');
}

// Public formatter — exported so the invoice can re-apply the same mask
// when rendering a stored value that arrives as clean digits from the DB.
// Silently ignores non-digit input and truncates to MAX_DIGITS so callers
// never have to pre-sanitize.
export function formatTaxId(rawValue, type = 'NTN') {
  const clean = String(rawValue || '').replace(/\D/g, '').slice(0, MAX_DIGITS);
  return type === 'STRN' ? formatSTRN(clean) : formatNTN(clean);
}

// ─── Caret math ────────────────────────────────────────────────────────────
// digitsUpTo(formatted, pos)   → number of digits in formatted[0..pos-1]
// indexAfterNthDigit(fmt, n)   → index in fmt just after the nth digit
// Both work in O(pos) time. Together they let us keep the caret glued to
// the "logical" character position across dash insertions and deletions.

function isDigitCharCode(c) { return c >= 48 && c <= 57; }

function digitsUpTo(formatted, pos) {
  let count = 0;
  const limit = Math.min(pos, formatted.length);
  for (let i = 0; i < limit; i++) {
    if (isDigitCharCode(formatted.charCodeAt(i))) count++;
  }
  return count;
}

function indexAfterNthDigit(formatted, n) {
  if (n <= 0) return 0;
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (isDigitCharCode(formatted.charCodeAt(i))) {
      count++;
      if (count === n) return i + 1;
    }
  }
  return formatted.length;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function TaxIdInput({
  type = 'NTN',
  value = '',
  onChange,
  className = 'form-control',
  placeholder,
  disabled,
  onBlur,
  onFocus,
  id,
  name,
  autoFocus,
  ...rest
}) {
  const inputRef      = useRef(null);
  const pendingCaret  = useRef(null);

  const cleanValue = String(value || '').replace(/\D/g, '').slice(0, MAX_DIGITS);
  const formatted  = formatTaxId(cleanValue, type);

  // Restore caret AFTER React has flushed the new formatted string to the
  // DOM. Only nudge if this input still has focus so parent re-renders
  // driven by other state don't steal focus back.
  useEffect(() => {
    if (pendingCaret.current === null || !inputRef.current) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    if (document.activeElement === inputRef.current) {
      try { inputRef.current.setSelectionRange(pos, pos); } catch (_) { /* IE */ }
    }
  });

  // Handle standard controlled onChange. Because we filter non-digits on
  // keydown / paste, e.target.value here is already digit-only in the
  // typical case; the sanitizer stays as belt-and-suspenders (e.g. mobile
  // IMEs, drag-drop text).
  const handleChange = (e) => {
    const input = e.target;
    const rawNext = input.value;
    const caret   = input.selectionStart ?? rawNext.length;

    const digitsBeforeCaret = digitsUpTo(rawNext, caret);

    const nextDigits = rawNext.replace(/\D/g, '').slice(0, MAX_DIGITS);
    const cappedDigitsBefore = Math.min(digitsBeforeCaret, nextDigits.length);

    const nextFormatted = formatTaxId(nextDigits, type);
    pendingCaret.current = indexAfterNthDigit(nextFormatted, cappedDigitsBefore);

    if (onChange) onChange(nextDigits);
  };

  const handleKeyDown = (e) => {
    // Let modifier combos through (Ctrl+A/C/V/X/Z, Cmd+…).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // ── Smart Backspace over auto-dashes ─────────────────────────────────
    // If the character immediately before the caret is a dash AND there's
    // no selection, delete the DIGIT before the dash instead of the dash
    // itself — otherwise the re-format would just put the dash right back
    // and the field would feel "stuck".
    if (e.key === 'Backspace') {
      const input = e.target;
      const start = input.selectionStart ?? 0;
      const end   = input.selectionEnd   ?? start;
      if (start === end && start > 0 && formatted[start - 1] === '-') {
        e.preventDefault();
        const digitsBefore = digitsUpTo(formatted, start);
        // digitsBefore counts the digit ABOVE the dash (dashes not counted).
        // Removing that digit shrinks the clean value by 1.
        if (digitsBefore >= 1) {
          const nextDigits = cleanValue.slice(0, digitsBefore - 1)
                           + cleanValue.slice(digitsBefore);
          const nextFormatted = formatTaxId(nextDigits, type);
          pendingCaret.current = indexAfterNthDigit(nextFormatted, digitsBefore - 1);
          if (onChange) onChange(nextDigits);
        }
      }
      return; // otherwise let native Backspace run and onChange picks it up
    }

    // Navigation / editing keys pass through.
    const NAV = ('Delete Tab Escape Enter '
      + 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown').split(' ');
    if (NAV.includes(e.key)) return;

    // Any other single-character key that isn't a digit is blocked outright.
    if (e.key.length === 1 && !/[0-9]/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handlePaste = (e) => {
    // Strip non-digits from the clipboard payload and splice into the
    // current selection. Same caret-math as onChange.
    e.preventDefault();
    const clip = (e.clipboardData || window.clipboardData).getData('text');
    const pastedDigits = clip.replace(/\D/g, '');
    if (!pastedDigits) return;

    const input = e.target;
    const selStart = input.selectionStart ?? formatted.length;
    const selEnd   = input.selectionEnd   ?? selStart;

    const digitsBeforeStart = digitsUpTo(formatted, selStart);
    const digitsBeforeEnd   = digitsUpTo(formatted, selEnd);

    const nextDigits = (
      cleanValue.slice(0, digitsBeforeStart) +
      pastedDigits +
      cleanValue.slice(digitsBeforeEnd)
    ).slice(0, MAX_DIGITS);

    const nextFormatted  = formatTaxId(nextDigits, type);
    const targetDigitPos = Math.min(digitsBeforeStart + pastedDigits.length, MAX_DIGITS);
    pendingCaret.current = indexAfterNthDigit(nextFormatted, targetDigitPos);

    if (onChange) onChange(nextDigits);
  };

  const defaultPlaceholder = type === 'STRN'
    ? '12-34-5678-901-23'
    : '1234567-8  or  12345-1234567-8';

  // maxLength on the visible formatted string — extra safety net beyond
  // the digit cap in the change handler.
  const maxLen = type === 'STRN' ? 17 : 15;

  return (
    <input
      {...rest}
      ref={inputRef}
      id={id}
      name={name}
      className={className}
      type="text"
      value={formatted}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder ?? defaultPlaceholder}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={maxLen}
    />
  );
}
