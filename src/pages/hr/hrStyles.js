// ─── Workforce Management shared stylesheet ────────────────────────────────
// Every HR screen injects this one string, so spacing, table density, badges,
// skeletons and motion are identical across the module by construction rather
// than by a manual consistency pass. It follows the page-local <style> block
// convention already used by Customers.jsx, just hoisted to module level
// because the screens share it.
//
// Everything below is expressed in the app's existing design tokens
// (--gray-*, --blue, --radius, --shadow-*, --transition) so the module reads
// as part of Medivance and not as a bolted-on product.
//
// Motion budget: 150-250ms, ease-out, and nothing that delays input.

export const HR_STYLES = `
  /* ── Page entrance ─────────────────────────────────────────────────── */
  @keyframes hrPageIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .hr-page-enter { animation: hrPageIn 0.2s cubic-bezier(0.4, 0, 0.2, 1); }

  @media (prefers-reduced-motion: reduce) {
    .hr-page-enter { animation: none; }
    .hr-skel::after { animation: none !important; }
  }

  /* ── Skeletons ─────────────────────────────────────────────────────── */
  @keyframes hrShimmer { 100% { transform: translateX(100%); } }
  .hr-skel {
    position: relative;
    overflow: hidden;
    background: var(--gray-100);
    border-radius: 6px;
    height: 12px;
  }
  .hr-skel::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent);
    animation: hrShimmer 1.3s infinite;
  }
  .hr-skel-text  { height: 12px; }
  .hr-skel-title { height: 16px; }
  .hr-skel-chip  { height: 20px; border-radius: 999px; }

  /* ── Visually hidden ───────────────────────────────────────────────── */
  /* Still announced by screen readers — display:none would not be. */
  .hr-sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── Segmented control ─────────────────────────────────────────────── */
  .hr-segment {
    display: inline-flex;
    background: var(--gray-100);
    border-radius: 8px;
    padding: 3px;
    gap: 2px;
  }
  .hr-segment-btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--gray-500);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
    white-space: nowrap;
  }
  .hr-segment-btn:hover:not(.is-active) { color: var(--gray-700); }
  .hr-segment-btn.is-active {
    background: white;
    color: var(--navy);
    box-shadow: var(--shadow-sm);
  }
  .hr-segment-count { margin-left: 5px; font-size: 11px; font-weight: 700; opacity: 0.55; }

  /* ── Custom select ─────────────────────────────────────────────────── */
  /* A native <select> cannot lay out an option plus a status badge without
     cramping them, so pickers that carry metadata use this instead. */
  .hr-select { position: relative; }
  .hr-select-trigger {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 200px;
    padding: 8px 12px;
    border: 1.5px solid var(--gray-200);
    border-radius: 8px;
    background: white;
    color: var(--gray-800);
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 500;
    line-height: 1.4;
    cursor: pointer;
    transition: var(--transition);
  }
  .hr-select-trigger:hover { border-color: var(--gray-300); }
  .hr-select-trigger:focus-visible {
    outline: none;
    border-color: var(--blue-light);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08);
  }
  .hr-select-value { flex: 1; text-align: left; white-space: nowrap; }
  .hr-select-caret { color: var(--gray-400); font-size: 18px; transition: transform 0.18s ease; }
  .hr-select-trigger[aria-expanded="true"] .hr-select-caret { transform: rotate(180deg); }
  .hr-select-menu {
    position: absolute;
    top: calc(100% + 5px);
    right: 0;
    z-index: 45;
    min-width: 100%;
    max-height: 300px;
    overflow-y: auto;
    padding: 5px;
    background: white;
    border: 1px solid var(--gray-200);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    animation: hrPageIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hr-select-option {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--gray-700);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .hr-select-option:hover,
  .hr-select-option:focus-visible { background: var(--gray-100); outline: none; }
  .hr-select-option.is-selected { color: var(--navy); font-weight: 700; }
  .hr-select-option-label { flex: 1; }

  /* Status capsule used inside the select and beside section titles. */
  .hr-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .hr-tag-open   { background: #d1fae5; color: #065f46; }
  .hr-tag-closed { background: var(--gray-100); color: var(--gray-500); }

  /* ── Tables ────────────────────────────────────────────────────────── */
  .hr-table-scroll { overflow: auto; max-height: 68vh; }
  .hr-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .hr-table thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--gray-50);
    /* A sticky header loses its collapsed bottom border while scrolling, so
       the rule is drawn with a box-shadow that sticks with it. */
    box-shadow: inset 0 -1.5px 0 var(--gray-200);
    border-bottom: none;
  }
  .hr-table tbody td { padding: 12px 14px; }
  .hr-table tbody tr { transition: background-color 0.12s ease; }
  .hr-table tbody tr.hr-row-click { cursor: pointer; }
  .hr-table tbody tr.hr-row-click:focus-visible {
    outline: 2px solid var(--blue-light);
    outline-offset: -2px;
  }
  .hr-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .hr-th-num { text-align: right; }
  .hr-cell-strong { font-weight: 600; color: var(--gray-800); }
  /* The closing figure of a financial row (outstanding balance, net pay):
     the number the operator is actually looking for. */
  .hr-cell-total { font-weight: 700; color: var(--gray-900); }
  /* Accounting presentation for a negative line: parentheses AND colour, so
     the sign survives a monochrome print and a red-green colour deficiency.
     --red on white is 4.83:1. */
  .hr-amt-deduction { color: var(--red); }
  /* The short ledgers embedded in a profile panel size their columns with a
     <colgroup>, in proportions chosen for the data. Left to itself the
     browser gives a six-column money table almost all of its slack to the one
     text column, which opens a hand's width of nothing between the pay period
     and the first figure. Fixed layout also stops a long reference from
     dragging the amounts out of their columns. */
  .hr-table.is-dense { table-layout: fixed; }
  /* Denser rows too: the roster's 15px row padding turns eight rows into a
     full screen inside a card. */
  .hr-table.is-dense thead th { padding: 9px 12px; }
  .hr-table.is-dense tbody td { padding: 10px 12px; }
  .hr-table.is-dense thead th:first-child,
  .hr-table.is-dense tbody td:first-child { padding-left: 0; }
  .hr-table.is-dense thead th:last-child,
  .hr-table.is-dense tbody td:last-child { padding-right: 0; }
  /* A secondary tag under a primary name ("Field staff"). Tight to its name
     (2px) and one step down in size and colour, so it reads as an annotation
     on the name rather than as a second value.
     NOTE: --gray-400 would match the muted look asked for, but it is 2.6:1 on
     white and fails WCAG AA for text this size; --gray-500 is 4.76:1 and is
     the lightest this module allows for real content. */
  .hr-cell-sub {
    font-size: 11px;
    font-weight: 500;
    color: var(--gray-500);
    line-height: 1.3;
    margin-top: 1px;
  }
  /* Neutral, unboxed text for a low-salience attribute in its own column
     (department). A pill per row turned the column into a wall of grey
     lozenges that outweighed the status badges beside them. */
  .hr-cell-muted { color: var(--gray-600); }

  /* Name + secondary tag, bound tightly to the avatar.
     The min-height is what makes the table scannable: the tag is on some rows
     and not others, so without it the roster alternates between 52px and 59px
     rows and the eye loses the rhythm it uses to track across a line. 34px is
     the two-line block's natural height, so nothing is stretched — the
     one-line rows simply stop being shorter. */
  .hr-identity-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 34px;
  }
  .hr-identity-text { min-width: 0; }
  /* Body line-height (1.6) is set for paragraphs; on a name stacked over its
     own annotation it opens a gap that reads as two separate values. */
  .hr-identity-cell .hr-cell-strong { line-height: 1.35; }
  .hr-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    color: var(--gray-500);
    white-space: nowrap;
  }

  .hr-sort-th { cursor: pointer; user-select: none; }
  .hr-sort-th:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }
  .hr-sort-label { display: inline-flex; align-items: center; gap: 3px; width: 100%; }
  .hr-sort-icon { font-size: 14px; line-height: 1; color: var(--gray-300); transition: color 0.2s ease; }
  .hr-sort-th[aria-sort]:not([aria-sort="none"]) .hr-sort-icon { color: var(--gray-700); }

  /* ── Kebab menu ────────────────────────────────────────────────────── */
  .hr-kebab { position: relative; display: inline-flex; }
  /* Portalled to <body> and positioned fixed by KebabMenu, so a menu on the
     last row of a scrolling table is not clipped by the table and the table
     never scrolls to make room for it. Below the modal overlay (z-index 200),
     above everything a page draws. The inline style supplies top/bottom/right
     and a maxHeight that fits the viewport. */
  .hr-kebab-menu {
    position: fixed;
    z-index: 150;
    min-width: 188px;
    overflow-y: auto;
    background: white;
    border: 1px solid var(--gray-200);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    padding: 5px;
    animation: hrPageIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hr-kebab-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--gray-700);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .hr-kebab-item:hover, .hr-kebab-item:focus-visible { background: var(--gray-100); outline: none; }
  .hr-kebab-item.is-danger { color: var(--red); }
  .hr-kebab-item.is-danger:hover, .hr-kebab-item.is-danger:focus-visible { background: var(--red-pale); }
  .hr-kebab-item .material-symbols-outlined { font-size: 17px; }

  /* == Profile header ================================================= */
  /* Three lines beside the avatar, in the order an HR person asks for them:
     WHO (name + operational status), WHAT (role . department), WHICH RECORD
     (system identifiers). The scattered row of bordered chips that carried
     all three is gone: a border around every fact does not make the fact
     easier to read, it adds four edges per fact and flattens the hierarchy.
     Vertical rhythm is the module's 8px grid (24 / 16 / 8 / 4). */
  .hr-profile-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
    padding: 24px 24px 20px;
  }
  .hr-profile-identity { display: flex; align-items: center; gap: 16px; min-width: 0; }
  /* A premium initial badge, not a flat grey disc: a low-contrast slate
     gradient, a hairline edge, a top inner highlight, and semi-bold tracked
     dark-slate text. Soft-square rather than circular so it sits in the same
     radius family as the cards around it. */
  .hr-avatar {
    width: 56px; height: 56px;
    flex-shrink: 0;
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(145deg, var(--gray-100), var(--gray-200));
    border: 1px solid var(--gray-200);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
    color: var(--gray-700);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 0.08em;
    /* letter-spacing also trails the last glyph; the indent pulls the pair
       back so it stays optically centred in the badge. */
    text-indent: 0.08em;
  }
  /* Row-sized badge for tables. Same gradient, border, weight and tracking as
     the profile header's — only the box scales. */
  .hr-avatar-sm {
    width: 28px; height: 28px;
    border-radius: 8px;
    font-size: 10.5px;
  }

  /* Line 1 - name, with operational status inline beside it. */
  .hr-profile-namerow {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .hr-profile-name {
    font-size: 21px;
    font-weight: 700;
    color: var(--gray-900);
    letter-spacing: -0.3px;
    line-height: 1.3;
  }
  /* Line 2 - role details. */
  .hr-profile-role {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--gray-600);
    margin-top: 4px;
    line-height: 1.45;
  }
  /* Line 3 - system identifiers, set tight under the role. Muted, unboxed,
     separated by middots: they are addressing information, not content. */
  .hr-profile-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0 8px;
    margin-top: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--gray-500);
    line-height: 1.5;
  }
  .hr-profile-meta .hr-meta-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--gray-600);
  }
  .hr-profile-meta-sep { color: var(--gray-300); }
  .hr-profile-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    /* Optically aligns the button row with the name, not the avatar box. */
    margin-top: 2px;
  }

  /* ── Section card ────────────────────────────────────── */
  /* What the Payroll screens still use. The collapse machinery, the section
     title and the inner padding went with the accordions on the employee
     profile — see .hr-panel below. */
  .hr-section { margin-bottom: 16px; }
  .hr-profile-card { border-bottom: 2px solid var(--gray-200); }
  .hr-section-icon {
    width: 32px; height: 32px;
    flex-shrink: 0;
    border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    background: var(--blue-ultra);
    color: var(--blue);
    font-size: 17px;
  }
  /* == Tabs =========================================================== */
  /* Flush against the bottom edge of the identity card, so the header and
     its navigation read as one object rather than a card with a floating
     control under it. The strip carries a 2px accent rule that closes the
     header off from the data cards below; the active tab's underline sits ON
     that rule (negative margin) instead of near it. */
  .hr-tabs {
    display: flex;
    align-items: stretch;
    gap: 4px;
    padding: 0 16px;
    border-top: 1px solid var(--gray-200);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hr-tabs::-webkit-scrollbar { display: none; }
  .hr-tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 12px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--gray-500);
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.14s ease, border-color 0.14s ease;
  }
  .hr-tab:hover { color: var(--gray-800); }
  /* High-contrast type for the selected state, not a second accent colour:
     the underline already says which tab is live, and gray-900 keeps the
     label the most legible text in the strip. */
  .hr-tab.is-active { color: var(--gray-900); border-bottom-color: var(--blue); }
  .hr-tab.is-active .material-symbols-outlined { color: var(--blue); }
  .hr-tab:focus-visible {
    outline: 2px solid var(--blue-light);
    outline-offset: -3px;
    border-radius: 8px;
  }
  .hr-tab .material-symbols-outlined { font-size: 18px; color: var(--gray-400); }
  /* Never colour alone: the button also carries a visually-hidden
     "needs attention" for anyone who cannot see the dot. */
  .hr-tab-alert {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--red);
    flex-shrink: 0;
  }
  .hr-tabpanel:focus { outline: none; }

  /* ── Panel card ──────────────────────────────────────── */
  /* A hairline border and a soft radius, no drop shadow: on a page that is
     already a stack of cards, elevation on every one of them is noise. */
  /* Deliberately no hidden overflow to clip the tinted header against the
     radius: the Master Data SearchSelect drops an absolutely-positioned
     listbox out of the Employment panel, and hidden overflow would cut it
     off. The header rounds its own top corners instead (12px radius less the
     1px border). */
  .hr-panel {
    background: white;
    border: 1px solid var(--gray-200);
    border-radius: 12px;
    margin-bottom: 16px;
  }
  .hr-panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 22px;
    border-bottom: 1px solid var(--gray-100);
    border-radius: 11px 11px 0 0;
    background: var(--gray-50);
  }
  .hr-panel-icon {
    width: 30px; height: 30px;
    flex-shrink: 0;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: white;
    border: 1px solid var(--gray-200);
    color: var(--blue);
    font-size: 17px;
  }
  .hr-panel-title {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--gray-800);
    letter-spacing: -0.1px;
    margin: 0;
  }
  .hr-panel-status {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--gray-500);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hr-panel-status::before { content: '·'; margin: 0 7px; color: var(--gray-300); }
  .hr-panel-actions { margin-left: auto; display: flex; gap: 8px; flex-shrink: 0; }
  .hr-panel-body { padding: 16px 22px 20px; }
  /* A group inside a panel ("Monthly salary structure", "Monthly sales
     target"). One step down from .hr-panel-title, never a second card. */
  .hr-subhead {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--gray-700);
    margin: 0 0 12px;
  }
  /* The rail's own rows carry 10px of vertical padding, so it opens tighter
     against the panel header than a form or a table would. */
  .hr-panel-body > .hr-kv:first-child { margin-top: -6px; }

  /* == Balance grid (read-only fields) ================================ */
  /* Label directly above its value inside a strict equal-width column track.
     Because every field owns exactly one column, every label starts at the
     same x and every value starts at the same x: a value can never drift
     away from its title the way it does in a free-form span grid, and no
     column can be squeezed by a long neighbour.
     A micro-thin rule between rows gives the eye a horizontal anchor without
     boxing each pair in. It is drawn as a border-TOP and suppressed on the
     opening row of each layout, so the group never ends on a stray hairline
     floating above the card's padding.
     Constraint that rule depends on: a spanning field (is-span-2/3/wide)
     must come AFTER the first full row, which is how the profile lays them
     out - long values belong at the bottom of a card anyway. */
  .hr-kv {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 32px;
    margin: 0;
  }
  .hr-kv-1 { grid-template-columns: minmax(0, 1fr); }
  .hr-kv-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .hr-kv-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .hr-kv-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 0;
    border-top: 1px solid var(--gray-100);
    min-width: 0;
  }
  /* Long values (an address, a reason for leaving) take two, three or all
     columns on the last row of their card rather than squeezing the fields
     beside them or leaving a hole on the right. */
  .hr-kv-row.is-span-2 { grid-column: span 2; }
  .hr-kv-row.is-span-3 { grid-column: span 3; }
  .hr-kv-row.is-wide   { grid-column: 1 / -1; }
  .hr-kv-1 > .hr-kv-row:nth-child(-n + 1),
  .hr-kv-2 > .hr-kv-row:nth-child(-n + 2),
  .hr-kv-3 > .hr-kv-row:nth-child(-n + 3),
  .hr-kv-4 > .hr-kv-row:nth-child(-n + 4) { border-top: none; }

  .hr-kv-label {
    font-size: 12px;
    font-weight: 500;
    /* --gray-500 is 4.76:1 on white. --gray-400, the old label colour, is
       2.6:1 and failed WCAG AA for body text. */
    color: var(--gray-500);
    line-height: 1.45;
  }
  .hr-kv-value {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--gray-900);
    line-height: 1.5;
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A blank field says so, in words, in a weight and slant that cannot be
     mistaken for a value. The old em dash read as a rendering failure; the
     grey "Not recorded" it replaced sat at --gray-300 (about 1.6:1 on white,
     far under WCAG AA). --gray-500 is 4.76:1 and passes. */
  .hr-kv-value.is-empty {
    color: var(--gray-500);
    font-weight: 500;
    font-style: italic;
  }
  /* Account numbers and IBANs: fixed-pitch and positively tracked, so digit
     groups stay countable and a copy-paste lands on the right characters. */
  .hr-kv-value.hr-mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--gray-900);
  }

  /* Narrower viewports halve the track count rather than dropping straight
     to one, and the suppressed opening rules come back at the new width. */
  @media (max-width: 1400px) {
    .hr-kv-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .hr-kv-4 > .hr-kv-row:nth-child(-n + 4) { border-top: 1px solid var(--gray-100); }
    .hr-kv-4 > .hr-kv-row:nth-child(-n + 2) { border-top: none; }
    /* Two tracks leave a 3-wide field nothing to span, and letting it run to
       1 / -1 strands the short field before it on a half-empty row. At this
       width it is simply an ordinary cell, which closes the row. */
    .hr-kv-row.is-span-3 { grid-column: span 1; }
  }
  @media (max-width: 1100px) {
    .hr-kv, .hr-kv-3, .hr-kv-4 { grid-template-columns: minmax(0, 1fr); }
    .hr-kv-2 > .hr-kv-row:nth-child(-n + 2),
    .hr-kv-3 > .hr-kv-row:nth-child(-n + 3),
    .hr-kv-4 > .hr-kv-row:nth-child(-n + 4),
    .hr-kv-4 > .hr-kv-row:nth-child(-n + 2) { border-top: 1px solid var(--gray-100); }
    .hr-kv > .hr-kv-row:first-child { border-top: none; }
    .hr-kv-row.is-span-2 { grid-column: 1 / -1; }
  }

  /* ── Form grid ─────────────────────────────────────────────────────── */
  /* A true 12-column grid. Every field declares a span sized to the data it
     holds, so a date or a CNIC is not stretched to the same width as an
     address just because auto-fit had room. */
  .hr-form-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 12px 20px;
  }
  .hr-col-1  { grid-column: span 1; }
  .hr-col-2  { grid-column: span 2; }
  .hr-col-3  { grid-column: span 3; }
  .hr-col-4  { grid-column: span 4; }
  .hr-col-5  { grid-column: span 5; }
  .hr-col-6  { grid-column: span 6; }
  .hr-col-7  { grid-column: span 7; }
  .hr-col-8  { grid-column: span 8; }
  .hr-col-9  { grid-column: span 9; }
  .hr-col-10 { grid-column: span 10; }
  .hr-col-11 { grid-column: span 11; }
  .hr-col-12 { grid-column: span 12; }
  @media (max-width: 1100px) {
    .hr-col-1, .hr-col-2, .hr-col-3, .hr-col-4 { grid-column: span 4; }
    .hr-col-5, .hr-col-6, .hr-col-7, .hr-col-8 { grid-column: span 6; }
    .hr-col-9, .hr-col-10, .hr-col-11 { grid-column: span 12; }
  }
  @media (max-width: 700px) {
    .hr-col-1, .hr-col-2, .hr-col-3, .hr-col-4,
    .hr-col-5, .hr-col-6, .hr-col-7, .hr-col-8 { grid-column: span 12; }
  }

  /* 8px between a label and the control it names — everywhere, including the
     standalone .form-group labels that sit outside the grid. At two different
     values nothing in the form sat on the same baseline. */
  .hr-form-grid .form-label,
  .hr-form-group .form-label {
    margin-bottom: 8px;
    /* 1.6 is paragraph leading; a one-line label only needs its own box. */
    line-height: 1.35;
  }
  /* The standalone group above the field grid (Record source) closes at the
     same distance the grid's own rows use, so the form has one rhythm. */
  .hr-form-group { margin-bottom: 12px; }

  /* Modal variant. Wide gutters, tight rows: two columns need the 32px of
     horizontal air to read as two columns, but the vertical stack does not —
     a 24px row gap sat on top of the 20px validation slot and put 44px
     between one input and the next label, which is what made a six-field
     modal feel stretched down the middle. 4px lands it at 24px, against 8px
     from a label to its own control — a 3:1 ratio, so each label still
     clearly belongs to the field under it rather than the one above.
     The 20px slot itself stays, and is most of what remains: an error
     appearing must not shift the fields below it. */
  .hr-form-grid.is-modal { gap: 4px 32px; }

  /* Format masks ("XXXXX-XXXXXXX-X", "03XX XXXXXXX", an all-zero account
     number) are the one kind of placeholder that can genuinely be mistaken
     for typed data — they are the same shape, and in the mono face the same
     letterforms. They get the faintest tint in the scale.
     This is safe for a placeholder and only for a placeholder: every field
     here carries a real <label>, so nothing is conveyed by the hint alone,
     and it disappears the moment anything is typed. */
  .form-control.hr-mask::placeholder {
    color: var(--gray-300);
    font-weight: 400;
    letter-spacing: 0;
  }

  /* Inline validation. Reserved space under each control keeps the grid from
     reflowing when an error appears, and keeps one field's message from
     crowding the next field's label. */
  /* 4 + 16 + 12 = 32px from one input's bottom edge to the next row's
     label: four grid units, down from 41px. The slot is 16px because a
     one-line .hr-error is 15.5px tall — at 14px an appearing error grew
     the slot and nudged the whole grid, which is the reflow this slot
     exists to prevent. */
  .hr-field-msg { min-height: 16px; margin-top: 4px; }
  .hr-error {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    font-size: 11.5px;
    color: var(--red);
    font-weight: 500;
    line-height: 1.35;
  }
  .hr-error .material-symbols-outlined { font-size: 13px; margin-top: 1px; }
  .hr-help { font-size: 11.5px; color: var(--gray-500); line-height: 1.45; }
  .form-control.hr-invalid { border-color: var(--red); }
  .form-control.hr-invalid:focus { box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.09); }
  .hr-required { color: var(--red); margin-left: 2px; }

  /* ── Line-item editor ──────────────────────────────────────────────── */
  /* One bordered group with hairline-separated rows, rather than a stack of
     independently bordered inputs. Keeps a 10-line salary structure compact
     and reads as a table, which is what it is. */
  .hr-lines {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    overflow: hidden;
    background: white;
  }
  .hr-lines-head {
    display: grid;
    grid-template-columns: 130px 1fr 150px 40px;
    gap: 0;
    padding: 9px 12px;
    background: var(--gray-50);
    border-bottom: 1px solid var(--gray-200);
    font-size: 10.5px;
    font-weight: 700;
    color: var(--gray-400);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .hr-lines-head.is-simple { grid-template-columns: 1fr 150px 40px; }
  .hr-line {
    display: grid;
    grid-template-columns: 130px 1fr 150px 40px;
    gap: 0;
    align-items: center;
    border-bottom: 1px solid var(--gray-100);
    transition: background-color 0.12s ease;
  }
  .hr-line.is-simple { grid-template-columns: 1fr 150px 40px; }
  .hr-line:last-child { border-bottom: none; }
  .hr-line:hover { background: var(--gray-50); }
  /* Borderless cells inside the group — the grid lines do the separating. */
  .hr-line .form-control {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 11px 12px;
    font-size: 13px;
  }
  .hr-line .form-control:focus {
    box-shadow: inset 0 0 0 2px var(--blue-light);
    background: white;
  }
  .hr-line .form-control.hr-invalid { box-shadow: inset 0 0 0 2px var(--red); }
  .hr-line-cell { min-width: 0; border-left: 1px solid var(--gray-100); }
  .hr-line-cell:first-child { border-left: none; }
  .hr-line-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    border-left: 1px solid var(--gray-100);
  }
  .hr-line-remove button {
    width: 26px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--gray-400);
    cursor: pointer;
    transition: var(--transition);
  }
  .hr-line:hover .hr-line-remove button { color: var(--gray-500); }
  .hr-line-remove button:hover { background: var(--red-pale); color: var(--red); }
  .hr-line-remove button:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }
  .hr-line-note {
    grid-column: 1 / -1;
    padding: 0 12px 10px;
    font-size: 11.5px;
  }
  .hr-lines-foot {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    background: var(--gray-50);
    border-top: 1px solid var(--gray-200);
  }
  .hr-lines-empty {
    padding: 22px 14px;
    text-align: center;
    font-size: 12.5px;
    color: var(--gray-400);
  }
  @media (max-width: 720px) {
    .hr-lines-head { display: none; }
    .hr-line, .hr-line.is-simple { grid-template-columns: 1fr 120px 40px; }
  }

  /* == Totals strip =================================================== */
  /* Read-only calculated output: one tinted ground, one border, no input
     affordance. All three cells share the same treatment - the net figure
     earns its emphasis from size and weight, not from an inverted dark fill
     that reads as a button and drags the eye past the two numbers it is the
     sum of. */
  .hr-totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1px;
    background: var(--gray-200);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    overflow: hidden;
    margin-top: 16px;
  }
  .hr-total-cell { background: var(--gray-50); padding: 12px 16px; }
  .hr-total-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--gray-500);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .hr-total-label .material-symbols-outlined { font-size: 12px; color: var(--gray-400); }
  .hr-total-value {
    font-size: 17px;
    font-weight: 700;
    color: var(--gray-800);
    font-variant-numeric: tabular-nums;
    margin-top: 4px;
    letter-spacing: -0.3px;
  }
  .hr-total-cell.is-net .hr-total-label { color: var(--gray-600); }
  .hr-total-cell.is-net .hr-total-value {
    font-size: 21px;
    font-weight: 800;
    color: var(--gray-900);
  }

  /* == Pay split ====================================================== */
  /* Earnings and deductions as two parallel ledgers instead of one list with
     a Type column. Once the two kinds sit in their own columns, the tag on
     every row repeats what the column heading already said, and either side
     can be totalled by eye without reading a tag per line.
     Each column closes with its own sum, so the arithmetic sits directly
     under the figures it came from; the net banner spans both because it
     belongs to neither. The bodies flex, so the two footers always line up
     even when one side has three rows and the other has one. */
  .hr-paysplit {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: stretch;
  }
  .hr-payside {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    background: white;
  }
  .hr-payside-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 40px;
    padding: 8px 16px;
    background: var(--gray-50);
    border-bottom: 1px solid var(--gray-200);
    border-radius: 9px 9px 0 0;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--gray-500);
  }
  /* The add control lives in the heading, where it reads as "add to THIS
     column" — which is also how the line's type is now chosen. */
  .hr-payside-head .btn {
    text-transform: none;
    letter-spacing: 0;
    margin: -4px -8px -4px 0;
  }
  .hr-payside-body { flex: 1 1 auto; min-width: 0; }
  .hr-payrow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 16px;
    padding: 8px 16px;
    border-top: 1px solid var(--gray-100);
    font-size: 13px;
  }
  .hr-payside-body > .hr-payrow:first-child { border-top: none; }
  .hr-payrow-title {
    color: var(--gray-800);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .hr-payrow-amt {
    font-weight: 600;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Accounting sign on every deduction line: parentheses AND colour, so it
     survives a monochrome print and a red-green deficiency. */
  .hr-payside.is-deduction .hr-payrow-amt { color: var(--red); }
  .hr-payside-empty {
    padding: 16px;
    font-size: 12.5px;
    font-style: italic;
    color: var(--gray-500);
  }
  .hr-payside-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    background: var(--gray-50);
    border-top: 1.5px solid var(--gray-200);
    border-radius: 0 0 9px 9px;
  }
  .hr-payside-foot-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--gray-500);
  }
  /* Both column totals are set in the same dark weight rather than the
     deduction side in red: they are a matched pair of magnitudes that the
     banner below subtracts, and the per-line red already carries the sign.
     A second wall of red here would make the column total compete with the
     lines it sums. */
  .hr-payside-foot-value {
    font-size: 16px;
    font-weight: 700;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.2px;
  }

  /* The answer the whole panel is building towards, anchored across the full
     width so it closes the block instead of sitting in one of two columns.
     A soft vertical wash rather than the inverted dark fill it replaced —
     dark read as a button and dragged the eye past the two numbers it is
     derived from. */
  .hr-netbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 16px;
    padding: 16px 24px;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    background: linear-gradient(180deg, #ffffff, var(--gray-50));
  }
  .hr-netbar-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--gray-800);
    letter-spacing: -0.1px;
  }
  .hr-netbar-note {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--gray-500);
    margin-top: 2px;
  }
  .hr-netbar-value {
    font-size: 24px;
    font-weight: 800;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.5px;
    line-height: 1.2;
  }
  @media (max-width: 900px) {
    .hr-paysplit { grid-template-columns: minmax(0, 1fr); }
  }

  /* Edit mode keeps the same two columns — the side a line is added to IS
     its type, so the type <select> that used to open every row is gone.
     Borderless controls on hairline-separated rows, so ten salary lines read
     as one ledger rather than ten stacked boxes. */
  .hr-payrow.is-edit {
    grid-template-columns: minmax(0, 1fr) 112px 32px;
    align-items: center;
    gap: 0;
    padding: 0;
  }
  .hr-payrow.is-edit .form-control {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 9px 12px;
    font-size: 13px;
  }
  .hr-payrow.is-edit .form-control:first-child { padding-left: 16px; }
  .hr-payrow.is-edit .form-control:focus {
    box-shadow: inset 0 0 0 2px var(--blue-light);
    background: white;
  }
  .hr-payrow.is-edit .form-control.hr-invalid { box-shadow: inset 0 0 0 2px var(--red); }
  .hr-payrow-x {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
    margin-right: 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--gray-300);
    cursor: pointer;
    transition: var(--transition);
  }
  .hr-payrow-x:hover { background: var(--red-pale); color: var(--red); }

  /* == Sales target ==================================================== */
  /* A short figure stacked over the sentence that explains it. The bordered
     metric box this replaces trapped a pocket of empty space beside a
     one-line value and forced the explanation to wrap in a narrow column. */
  .hr-target-value {
    font-size: 24px;
    font-weight: 800;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.5px;
    line-height: 1.25;
    margin-top: 2px;
  }
  /* An unset target is a state, not a value, so it is stated as one: a dashed
     pill reads "nothing here yet" at a glance, where italic text at metric
     size read as a value that happened to be a word. */
  .hr-target-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 5px 12px;
    border: 1px dashed var(--gray-300);
    border-radius: 999px;
    background: var(--gray-50);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--gray-500);
  }
  .hr-target-basis {
    margin-top: 8px;
    font-size: 13px;
    color: var(--gray-600);
    line-height: 1.6;
    max-width: 78ch;
  }
  .hr-target-basis-label { font-weight: 600; color: var(--gray-700); }
  .hr-target-basis.is-empty { font-style: italic; color: var(--gray-500); }
  .hr-target-basis.is-empty .hr-target-basis-label { font-style: normal; }

  /* Placeholders are hints, not values: regular weight, a notch smaller and
     --gray-400, so an empty field can never be mistaken for a filled one at
     a glance. (--gray-400 is below AA for body text, which is exactly why it
     is reserved for text that disappears the moment anything is typed.) */
  .hr-form-grid .form-control::placeholder,
  .hr-payrow .form-control::placeholder {
    color: var(--gray-400);
    font-weight: 400;
    font-size: 13px;
  }

  /* ── Target progress ───────────────────────────────────────────────── */
  .hr-progress-track {
    height: 8px;
    border-radius: 999px;
    background: var(--gray-100);
    overflow: hidden;
    margin-top: 9px;
  }
  .hr-progress-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* ── Status badges ─────────────────────────────────────────────────── */
  .hr-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .hr-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .hr-status.is-active   { color: #047857; background: rgba(5,150,105,0.08); }
  .hr-status.is-inactive { color: var(--gray-600); background: var(--gray-100); }
  .hr-status.is-active   .hr-status-dot { background: var(--green); }
  .hr-status.is-inactive .hr-status-dot { background: var(--gray-400); }

  .hr-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--blue-ultra);
    color: #1d4ed8;
    font-size: 11.5px;
    font-weight: 600;
  }
  .hr-pill .material-symbols-outlined { font-size: 13px; }

  /* ── Empty states ──────────────────────────────────────────────────── */
  .hr-empty { text-align: center; padding: 64px 24px; }
  .hr-empty-icon {
    width: 56px; height: 56px;
    margin: 0 auto 16px;
    border-radius: 16px;
    display: flex; align-items: center; justify-content: center;
    background: var(--gray-100);
    color: var(--gray-400);
    font-size: 26px;
  }
  .hr-empty-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--gray-800);
    margin-bottom: 7px;
    letter-spacing: -0.2px;
  }
  .hr-empty-desc {
    font-size: 13.5px;
    color: var(--gray-500);
    max-width: 440px;
    margin: 0 auto 22px;
    line-height: 1.65;
  }
  .hr-empty-sm { padding: 34px 20px; }
  .hr-empty-sm .hr-empty-icon { width: 42px; height: 42px; font-size: 20px; margin-bottom: 12px; }
  .hr-empty-sm .hr-empty-title { font-size: 14.5px; }
  .hr-empty-sm .hr-empty-desc { font-size: 13px; margin-bottom: 16px; }

  /* ── Toolbar ───────────────────────────────────────────────────────── */
  .hr-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* ── Attendance day sheet ──────────────────────────────────────────── */
  /* One row per employee for a single date. The whole workforce is marked in
     one pass, which is how attendance is actually taken. */
  .hr-sheet-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 16px 22px;
    background: var(--gray-50);
    border-bottom: 1px solid var(--gray-200);
  }
  .hr-sheet-stat { display: flex; align-items: baseline; gap: 6px; }
  .hr-sheet-stat-value {
    font-size: 17px;
    font-weight: 800;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
  }
  .hr-sheet-stat-label { font-size: 11.5px; color: var(--gray-500); font-weight: 600; }

  .hr-mark {
    display: inline-flex;
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    overflow: hidden;
    background: white;
  }
  .hr-mark button {
    width: 42px;
    padding: 6px 0;
    border: none;
    border-left: 1px solid var(--gray-200);
    background: white;
    color: var(--gray-400);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition: var(--transition);
  }
  .hr-mark button:first-child { border-left: none; }
  .hr-mark button:hover:not(.is-on) { background: var(--gray-50); color: var(--gray-600); }
  .hr-mark button.is-on.is-present { background: var(--green); color: white; }
  .hr-mark button.is-on.is-absent  { background: var(--red); color: white; }
  .hr-mark button:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }

  .hr-area-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px dashed var(--gray-300);
    border-radius: 7px;
    background: white;
    color: var(--gray-500);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
    max-width: 100%;
  }
  .hr-area-trigger:hover { border-color: var(--blue-light); color: var(--blue); }
  .hr-area-trigger.has-value {
    border-style: solid;
    border-color: var(--blue-pale);
    background: var(--blue-ultra);
    color: #1d4ed8;
  }
  .hr-area-trigger .material-symbols-outlined { font-size: 14px; }

  /* ── Attendance: month list + marking sheet (strict 8px grid) ─────── */
  /* Every box dimension below is a multiple of 8 (4 only inside a control).
     Rows are a fixed 48px and headers 40px whatever the cell holds, so
     marking a row, or its areas appearing, never changes the table's
     geometry. Scoped to .att-* so no other HR screen moves. */
  .att-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 16px 24px;
    border-bottom: 1px solid var(--gray-100);
  }
  .att-bar-group { display: flex; align-items: center; gap: 16px; min-width: 0; flex-wrap: wrap; }
  .att-bar-group.is-tight { gap: 8px; }
  /* One control height for the whole bar, so the month picker, search and
     buttons share a single baseline instead of three near-misses. */
  .att-bar .hr-select-trigger,
  .att-bar .btn,
  .att-bar .search-bar { height: 32px; box-sizing: border-box; font-size: 13px; }
  /* 32px, body-size controls throughout the bar: a toolbar supports the
     table, it does not compete with it. */
  .att-bar .btn { padding: 0 16px; font-size: 13px; }
  .att-bar .btn-icon { width: 32px; padding: 0; justify-content: center; }
  .att-bar .hr-select-trigger { padding: 0 8px 0 16px; }
  .att-bar .search-bar { padding: 0 8px; }
  .att-bar .search-bar input { font-size: 13px; }
  .att-bar .search-bar input { width: 184px; }
  .att-title { font-size: 15px; font-weight: 700; line-height: 24px; color: var(--gray-800); }
  .att-meta { font-size: 12px; line-height: 16px; color: var(--gray-500); font-weight: 500; }

  .att-strip {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
    min-height: 56px;
    padding: 8px 24px;
    background: var(--gray-50);
    border-bottom: 1px solid var(--gray-200);
  }
  .att-kpi { display: flex; align-items: baseline; gap: 8px; }
  .att-kpi-value {
    font-size: 16px;
    line-height: 24px;
    font-weight: 800;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
  }
  .att-kpi-label { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--gray-500); }
  .att-strip.is-sheet { justify-content: space-between; }
  .att-strip-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .att-strip .search-bar { height: 32px; box-sizing: border-box; padding: 0 8px; background: white; }
  .att-strip .search-bar input { width: 184px; font-size: 13px; }

  /* Register progress: a stacked bar and three fixed-width legend entries. */
  .att-progress { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .att-progress-track {
    display: flex;
    width: 128px;
    height: 8px;
    border-radius: 999px;
    background: var(--gray-200);
    overflow: hidden;
  }
  .att-progress-seg { height: 100%; transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
  .att-progress-seg.is-present { background: var(--green); }
  .att-progress-seg.is-absent  { background: var(--red); }
  .att-legend {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 104px;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--gray-500);
  }
  .att-legend b {
    color: var(--gray-900);
    font-weight: 800;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .att-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--gray-300); flex-shrink: 0; }
  .att-dot.is-present { background: var(--green); }
  .att-dot.is-absent  { background: var(--red); }

  /* Bulk marking: the same P/A vocabulary as the row toggles, one control. */
  .att-bulk {
    display: inline-flex;
    align-items: stretch;
    height: 32px;
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    overflow: hidden;
    background: white;
  }
  .att-bulk-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 88px;
    background: var(--gray-50);
    border-right: 1px solid var(--gray-200);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--gray-500);
  }
  .att-bulk button {
    width: 80px;
    border: none;
    background: white;
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .att-bulk button + button { border-left: 1px solid var(--gray-200); }
  .att-bulk button { color: var(--gray-700); }
  .att-bulk button:hover:not(:disabled) { background: var(--gray-50); color: var(--gray-900); }
  .att-bulk button:disabled { color: var(--gray-300); cursor: not-allowed; }
  .att-bulk button:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }

  /* Save: a fixed slot for its status text, and a disabled state that reads
     as idle rather than as a faded, half-loaded primary button. */
  /* Compact: a 32px control at body size. It sits beside a 40px title block
     and must not outweigh the date it saves. */
  .att-bar .btn.att-save { height: 32px; min-width: 144px; padding: 0 16px; font-size: 13px; justify-content: center; }
  .att-save:disabled,
  .att-save:disabled:hover {
    opacity: 1;
    background: var(--gray-100);
    color: var(--gray-400);
    box-shadow: none;
  }
  .att-save-status {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 176px;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--gray-500);
  }
  .att-save-status .material-symbols-outlined { font-size: 16px; }
  .att-save-status.is-dirty { color: var(--blue); }
  .att-save-status.is-saved { color: var(--gray-500); }

  .att-scroll { overflow: auto; max-height: 64vh; }
  /* A table that ends its card must end on the card's curve. .card does not
     clip, so a filled last row (the totals footer, or a hovered row) painted
     square corners over the card's rounded ones and its border. The scroll
     box already clips (overflow: auto), so rounding it clips the table to
     the curve — inset by the card's 1px border so the two radii are concentric. */
  .card > .att-scroll:last-child {
    border-bottom-left-radius: calc(var(--radius-lg) - 1px);
    border-bottom-right-radius: calc(var(--radius-lg) - 1px);
  }
  .att-table { width: 100%; min-width: 720px; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
  .att-table thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 40px;
    padding: 0 16px;
    background: var(--gray-50);
    border-bottom: none;
    box-shadow: inset 0 -1px 0 var(--gray-200);
  }
  .att-table tbody td {
    height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--gray-100);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .att-table tbody tr:last-child td { border-bottom: none; }
  .att-table .is-num { text-align: right; font-variant-numeric: tabular-nums; }
  .att-table .is-center { text-align: center; }
  .att-table th.is-num { text-align: right; }
  .att-table th.is-center { text-align: center; }
  .att-table tr.att-row-click { cursor: pointer; }
  .att-table tr.att-row-click:hover { background: var(--blue-ultra); }
  .att-table tr.att-row-click:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }
  .att-table tr.att-group td {
    height: 32px;
    background: var(--gray-50);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--gray-500);
  }
  .att-table tr.att-group:hover { background: none; }
  /* Unsaved row: an inset rule on the first cell. A shadow, not a border, so
     it costs no width and nothing in the row shifts when it appears. */
  /* The row the keyboard is on, so P / A always has a visible target. */
  .att-table tbody tr:focus-within { background: var(--gray-50); }
  .att-table tr.is-changed td:first-child { box-shadow: inset 2px 0 0 var(--blue-light); }

  .att-identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .att-table .hr-avatar-sm { width: 32px; height: 32px; border-radius: 8px; }
  .att-identity-text { min-width: 0; line-height: 16px; }
  .att-identity-text .hr-cell-strong,
  .att-identity-text .hr-cell-sub {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
  }

  /* The empty-value marker: a centred neutral slate dash, never a blank. */
  /* It follows its column's alignment (left under a left header, right in a
     number column) and centres on a 16px slot of its own. A dash centred in
     a wide left-aligned column floated away from both its header and the
     values above and below it. */
  .att-dash {
    display: inline-block;
    width: 16px;
    text-align: center;
    color: var(--gray-400);
    font-weight: 500;
  }
  /* Areas covered: slate-600 / medium, the lightest weight that stays
     comfortably readable at 13px. */
  .att-areas { color: var(--gray-600); font-weight: 500; }
  .att-muted-num { color: var(--gray-400); }

  .att-mark {
    display: inline-flex;
    height: 32px;
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    overflow: hidden;
    background: white;
    vertical-align: middle;
  }
  .att-mark button {
    width: 40px;
    border: none;
    border-left: 1px solid var(--gray-200);
    background: white;
    color: var(--gray-400);
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .att-mark button:first-child { border-left: none; }
  .att-mark button:hover:not(.is-on) { background: var(--gray-50); color: var(--gray-600); }
  .att-mark button.is-on.is-present { background: var(--green); color: white; }
  .att-mark button.is-on.is-absent  { background: var(--red); color: white; }
  .att-mark button:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }

  .att-area-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    max-width: 100%;
    padding: 0 8px;
    border: 1px dashed var(--gray-300);
    border-radius: 8px;
    background: white;
    color: var(--gray-500);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease;
  }
  .att-area-btn:hover { border-color: var(--blue-light); color: var(--blue); }
  .att-area-btn.has-value { border-style: solid; border-color: var(--gray-200); }
  .att-area-btn.has-value .att-areas { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .att-area-btn .material-symbols-outlined { font-size: 16px; flex-shrink: 0; }

  .att-table td .btn-sm { height: 32px; padding: 0 16px; }
  .att-weekday { color: var(--gray-500); font-weight: 500; }

  /* ── Area picker ── */
  .att-picker { display: flex; flex-direction: column; gap: 16px; }
  /* Tokens live inside the field. 40px holds a row of 24px chips; a rare
     fourth or fifth area wraps to a second row rather than overflowing. */
  .att-token-field {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
    min-height: 40px; box-sizing: border-box; padding: 4px 8px;
    border: 1.5px solid var(--gray-200); border-radius: 8px; background: white;
    cursor: text; transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .att-token-field:focus-within { border-color: var(--blue-light); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08); }
  .att-token-icon { font-size: 16px; color: var(--gray-400); }
  .att-token-input {
    flex: 1; min-width: 120px; height: 24px; padding: 0;
    border: none; outline: none; background: transparent;
    font-family: inherit; font-size: 13px; color: var(--gray-800);
  }
  .att-token-input::placeholder { color: var(--gray-400); }
  .att-chip {
    display: inline-flex; align-items: center; gap: 4px;
    height: 24px; padding: 0 4px 0 8px; border-radius: 4px;
    background: var(--gray-100); color: var(--gray-800);
    font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .att-chip button {
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; padding: 0; border: none; border-radius: 4px;
    background: transparent; color: var(--gray-500); cursor: pointer;
  }
  .att-chip button:hover { background: var(--gray-200); color: var(--gray-900); }
  .att-chip .material-symbols-outlined { font-size: 12px; }

  .att-picker-list {
    height: 288px; overflow-y: auto; box-sizing: border-box; padding: 0 8px 8px;
    border: 1px solid var(--gray-200); border-radius: 8px; background: white;
  }
  .att-picker-group {
    position: sticky; top: 0; z-index: 1;
    height: 32px; margin-top: 8px; padding: 0 8px;
    display: flex; align-items: center;
    background: white;
    font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--gray-500);
  }
  .att-picker-item {
    display: flex; align-items: center; gap: 8px;
    height: 32px; padding: 0 8px; border-radius: 4px;
    font-size: 13px; color: var(--gray-700); cursor: pointer;
  }
  .att-picker-item:hover,
  .att-picker-item.is-active { background: var(--gray-100); }
  .att-picker-item.is-on { color: var(--gray-900); font-weight: 600; }
  .att-picker-item input { width: 16px; height: 16px; margin: 0; accent-color: var(--blue); cursor: pointer; flex-shrink: 0; }
  .att-picker-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .att-picker-city-note { font-size: 12px; font-weight: 500; color: var(--gray-400); white-space: nowrap; }
  .att-picker-hit { font-weight: 700; color: var(--gray-900); }
  .att-picker-list > .att-picker-item:first-child { margin-top: 8px; }
  .att-picker-empty { padding: 32px 16px; text-align: center; font-size: 13px; color: var(--gray-500); }

  .att-date { display: inline-flex; align-items: baseline; gap: 8px; }


  /* Present / Absent in the history as words with a small dot — never a
     filled pill per row. Absent carries the weight, since it is the
     exception the reader is scanning for. */
  .att-state { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--gray-700); }
  .att-state-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--gray-400); flex-shrink: 0; }
  .att-state .material-symbols-outlined { font-size: 16px; }
  .att-state.is-present .att-state-dot { background: var(--green); }
  .att-state.is-absent { color: var(--gray-900); font-weight: 600; }
  .att-state.is-absent .att-state-dot { background: var(--red); }



  /* Row menu: the module's standard outlined 32px button, so it reads as a
     control at a glance. The cell opts out of the table's ellipsis rule —
     otherwise a button wider than the cell's content box is truncated and
     the browser paints a stray "…" beside it. */
  .att-table tbody td.att-kebab-cell { overflow: visible; text-overflow: clip; padding: 0 16px; }
  .att-table .att-kebab-cell .btn {
    width: 32px; height: 32px; padding: 0; justify-content: center;
    color: var(--gray-600);
  }
  /* KebabMenu sets 16px inline; 18px makes the three dots legible. */
  .att-table .att-kebab-cell .btn .material-symbols-outlined { font-size: 18px !important; }

  .att-strip > .att-meta { margin-left: auto; }
  .att-date .att-weekday { font-size: 12px; }

  @media (max-width: 720px) {
    .att-bar { padding: 16px; }
    .att-strip { padding: 8px 16px; gap: 16px; }
    .att-bar .search-bar input { width: 128px; }
  }

  /* ── Payroll (pr-*) — shares the att-* bar/table system ────────────── */
  .pr-tabs {
    display: flex;
    gap: 24px;
    padding: 0 24px;
    border-bottom: 1px solid var(--gray-200);
  }
  .pr-tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    margin-bottom: -1px;
    padding: 0;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--gray-500);
    cursor: pointer;
  }
  .pr-tab:hover { color: var(--gray-800); }
  .pr-tab.is-active { color: var(--blue); border-bottom-color: var(--blue); }
  .pr-tab:focus-visible { outline: 2px solid var(--blue-light); outline-offset: -2px; }
  .pr-tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--gray-100);
    color: var(--gray-600);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pr-tab.is-active .pr-tab-count { background: var(--blue-ultra); color: var(--blue); }

  /* Print actions ride on the tab row's empty right side instead of taking
     a strip of their own. */
  .pr-tabs { align-items: center; }
  .pr-tabs-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .pr-tabs-actions .btn { height: 32px; padding: 0 16px; font-size: 12px; }
  .pr-note {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 24px;
    background: var(--gray-50);
    border-bottom: 1px solid var(--gray-200);
    font-size: 12px;
    color: var(--gray-600);
  }
  .pr-note .material-symbols-outlined { font-size: 16px; color: var(--gray-400); }

  .pr-check { width: 16px; height: 16px; margin: 0; accent-color: var(--blue); cursor: pointer; vertical-align: middle; }
  .pr-net { font-weight: 700; color: var(--gray-900); }
  .pr-zero { margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--gray-500); }
  .pr-warn { font-size: 12px; font-weight: 600; color: var(--gray-500); font-style: italic; }
  .pr-closed-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 16px;
    border-radius: 8px;
    background: var(--gray-100);
    color: var(--gray-600);
    font-size: 12px;
    font-weight: 700;
  }
  .pr-closed-tag .material-symbols-outlined { font-size: 16px; }

  /* The register's closing line: totals under their columns. */
  .att-table tfoot td {
    height: 48px;
    padding: 0 16px;
    background: var(--gray-50);
    /* Drawn as a shadow, not a border: a sticky cell in a collapsed-border
       table loses its border while scrolling (the thead uses the same fix). */
    border: none;
    box-shadow: inset 0 1.5px 0 var(--gray-200);
    font-weight: 700;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
  }
  .att-scroll .att-table tfoot td { position: sticky; bottom: 0; }

  .pr-h3 { font-size: 13px; font-weight: 700; color: var(--gray-700); margin: 0 0 8px; }
  .pr-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-bottom: 24px;
  }
  .pr-actions .btn { height: 32px; padding: 0 16px; font-size: 13px; }

  /* Earnings and deductions side by side, as the printed payslip sets them.
     Below 1200px (a laptop with the sidebar open) they stack, so a line's
     description never gets squeezed to a few characters. */
  .pr-lines-2col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }
  @media (max-width: 1200px) { .pr-lines-2col { grid-template-columns: 1fr; } }

  /* Departments & Designations: a back arrow and the two tabs on one line,
     in place of a page title nobody needs twice. */
  .hr-lookup-head { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid var(--gray-200); }
  .hr-lookup-head .tabs { flex: 1; }

  /* The context panel: one labelled row per thing the month says about this
     employee. Labels share a column so the rows read as a small table. */
  .pr-context { background: var(--gray-50); border-bottom: 1px solid var(--gray-200); }
  .pr-context-row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    min-height: 48px;
    padding: 8px 24px;
  }
  .pr-context-row + .pr-context-row { border-top: 1px solid var(--gray-200); }
  .pr-context-label {
    min-width: 176px;
    font-size: 12px;
    font-weight: 600;
    color: var(--gray-500);
  }
  .pr-target-figure { font-size: 15px; font-weight: 800; color: var(--gray-900); font-variant-numeric: tabular-nums; }
  /* The share of target as a word or a number — no rail: at 8% a bar says
     nothing the figures have not already said. */
  .pr-target-chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--gray-200);
    color: var(--gray-700);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pr-target-chip.is-met { background: #d1fae5; color: #065f46; }

  /* Payslip editor: figures and actions in one bar, pinned to the bottom of
     the viewport while editing and landing naturally at the end of the page. */
  .pr-actionbar {
    position: sticky;
    /* 16px clear of the viewport floor, so the bar never sits flush on the
       content it is pinned over. */
    bottom: 16px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 24px;
    padding: 12px 24px;
    background: white;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-lg);
    box-shadow: 0 -2px 12px rgba(15, 23, 42, 0.06);
  }
  .pr-actionbar-figs { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .pr-actionbar-actions { display: flex; align-items: center; gap: 8px; }
  .pr-actionbar .btn { height: 32px; padding: 0 16px; font-size: 13px; }

  /* The figure the bar exists for, on its own line. */
  .pr-netline { display: flex; align-items: baseline; gap: 12px; }
  .pr-netline-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--gray-500);
  }
  .pr-netline-value {
    font-size: 22px;
    font-weight: 800;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.4px;
  }
  .pr-netline-ccy { margin-right: 6px; font-size: 12px; font-weight: 700; color: var(--gray-400); letter-spacing: 0; }

  /* Where that figure came from: a caption, not a calculation. Each part is
     label-then-amount, separated by hairlines rather than operators. */
  .pr-breakdown { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; font-size: 12px; color: var(--gray-700); }
  .pr-breakdown > span {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }
  .pr-breakdown > span + span { padding-left: 16px; border-left: 1px solid var(--gray-200); }
  .pr-breakdown-label { color: var(--gray-500); }

  /* A payslip line that repays a loan: the title is shown with its tag, not
     typed, and only the amount is editable. */
  .hr-line.is-loan .hr-line-cell:first-child { background: var(--gray-50); }
  .hr-line-static { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 11px 12px; }
  .hr-line-static-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--gray-700);
  }
  .pr-loan-tag {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--gray-200);
    color: var(--gray-600);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  /* Amounts read as money at rest and as a plain number while typed. */
  .pr-amount { text-align: right; font-variant-numeric: tabular-nums; }

  .pr-ctc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
  .pr-ctc-head .pr-ctc-label { margin-bottom: 0; }
  /* A framed 32px icon action: the same control the app uses in a table row,
     so an editable figure looks like the rest of the product. */
  .pr-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    background: white;
    color: var(--gray-500);
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease;
  }
  .pr-icon-btn:hover:not(:disabled) {
    border-color: var(--gray-300);
    color: var(--gray-900);
    box-shadow: var(--shadow-sm);
  }
  .pr-icon-btn:focus-visible { outline: none; border-color: var(--blue-light); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08); }
  .pr-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pr-icon-btn.is-active { border-color: var(--blue-pale); background: var(--blue-ultra); color: var(--blue); }
  .pr-icon-btn .material-symbols-outlined { font-size: 16px; }
  /* Value and field share one 40px slot, so switching between them moves
     nothing else in the dialog. */
  .pr-ctc-value {
    display: flex;
    align-items: center;
    height: 32px;
    font-size: 18px;
    font-weight: 800;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
  }
  .pr-ctc-label {
    display: block;
    margin-bottom: 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--gray-500);
  }
  /* An amount that is editable from the start: a real field with its currency
     as a fixed affix, not a value with an "Edit" link beside it. */
  .pr-field {
    display: flex;
    align-items: stretch;
    height: 40px;
    border: 1.5px solid var(--gray-200);
    border-radius: 8px;
    background: white;
    overflow: hidden;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .pr-field:focus-within { border-color: var(--blue-light); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08); }
  .pr-field.is-invalid { border-color: var(--red); }
  .pr-field-prefix {
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: var(--gray-50);
    border-right: 1px solid var(--gray-200);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
    color: var(--gray-500);
  }
  .pr-field input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    padding: 0 12px;
    background: transparent;
    font-family: inherit;
    font-size: 16px;
    font-weight: 700;
    text-align: right;
    color: var(--gray-900);
    font-variant-numeric: tabular-nums;
  }
  .pr-field-error { color: var(--red); font-weight: 600; }
  /* Sits in the note line, so the field never moves when it appears. */
  .pr-reset {
    margin-left: 8px;
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--blue);
    text-decoration: underline;
    cursor: pointer;
  }
  .pr-reset:hover { color: #1d55d1; }

  /* Two lines' worth of room, reserved: the note changes length as the
     amount is edited and must not resize the dialog. */
  .pr-ctc-note { margin-top: 4px; min-height: 32px; font-size: 12px; line-height: 16px; color: var(--gray-500); }

  /* The one irreversible fact, as its own line, over what it does. The mark
     sits in a tile of its own rather than floating beside the first word, so
     the two lines read as a block and the icon does not drift with them. */
  .pr-alert {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
    background: #fffbeb;
    border: 1px solid #fde68a;
  }
  .pr-alert-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #fef3c7;
    color: #b45309;
  }
  /* The filled cut of the icon: a hairline outline at this size reads as a
     scratch rather than a warning mark. */
  .pr-alert-icon .material-symbols-outlined {
    font-size: 20px;
    font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;
  }
  .pr-alert-title { font-size: 13px; font-weight: 700; color: #92400e; line-height: 20px; }
  /* #a16207 on #fffbeb is ~4:1 — under AA at this size; #92400e is 7.4:1. */
  .pr-alert-text { font-size: 12.5px; color: #92400e; line-height: 18px; }

  .pr-close-ctc {
    margin-top: 24px;
    padding: 12px 16px;
    border-radius: 8px;
    background: var(--gray-50);
    border: 1px solid var(--gray-200);
  }

  .pr-close-summary { width: 100%; margin-top: 16px; border-collapse: collapse; font-size: 13px; }
  .pr-close-summary td { height: 32px; padding: 0; border-bottom: 1px solid var(--gray-100); color: var(--gray-600); }
  .pr-close-summary td:last-child { text-align: right; font-weight: 600; color: var(--gray-900); font-variant-numeric: tabular-nums; }
  .pr-close-summary tr.is-net td { border-bottom: none; font-weight: 700; color: var(--gray-900); }

  /* ── Multi-select checklist ────────────────────────────────────────── */
  .hr-checklist {
    max-height: 260px;
    overflow-y: auto;
    border: 1.5px solid var(--gray-200);
    border-radius: 8px;
    padding: 5px;
    background: white;
  }
  .hr-check {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--gray-700);
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .hr-check:hover { background: var(--gray-50); }
  .hr-check input { cursor: pointer; accent-color: var(--blue); width: 15px; height: 15px; }
  .hr-check:focus-within { background: var(--gray-100); }
  /* A checkbox that carries an explanation is a decision, not a field, so it
     is boxed as one instead of floating as loose text under the grid. The
     control sits on the first text line (align-items: flex-start plus a
     nudge) rather than centred against a two-line block. */
  .hr-checkbanner {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid var(--gray-100);
    border-radius: var(--radius);
    background: var(--gray-50);
    cursor: pointer;
    transition: border-color 0.14s ease, background-color 0.14s ease;
  }
  .hr-checkbanner:hover { border-color: var(--gray-200); }
  .hr-checkbanner:focus-within {
    border-color: var(--blue-light);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08);
  }
  .hr-checkbanner input {
    flex-shrink: 0;
    width: 16px; height: 16px;
    margin-top: 1px;
    accent-color: var(--blue);
    cursor: pointer;
  }
  .hr-checkbanner-title {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--gray-800);
    line-height: 1.4;
  }
  /* 1.6 line-height: this is a sentence of explanation, not a label, and at
     1.35 the two lines crowded into a grey block. */
  .hr-checkbanner-note {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--gray-500);
    line-height: 1.6;
  }

  .hr-checklist-group {
    padding: 8px 9px 3px;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--gray-400);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  /* ── Locked / informational strip ──────────────────────────────────── */
  .hr-locked {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 11px 14px;
    background: var(--gray-50);
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    font-size: 13px;
    color: var(--gray-600);
  }
  .hr-locked .material-symbols-outlined { font-size: 17px; color: var(--gray-400); flex-shrink: 0; }

  /* ── Print preview shell ───────────────────────────────────────────── */
  .hr-preview-desk {
    background: var(--gray-200);
    border-radius: var(--radius);
    padding: 22px;
    overflow: auto;
    display: flex;
    justify-content: center;
  }
  .hr-preview-scale {
    transform: scale(0.72);
    transform-origin: top center;
    /* Reclaim the whitespace scale() leaves behind. */
    margin-bottom: -28%;
  }
  @media (max-width: 900px) {
    .hr-preview-scale { transform: scale(0.5); margin-bottom: -50%; }
  }
`;

export default HR_STYLES;
