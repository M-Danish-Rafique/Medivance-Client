import React from 'react';

/**
 * Per-page chrome: topbar + content area.
 * The sidebar and overall app shell now live in AppLayout (rendered once
 * for the whole authenticated session), so this component only needs to
 * render what's specific to each page.
 */
export default function Layout({ children, title }) {
  return (
    <>
      <div className="topbar">
        <div className="topbar-title">{title}</div>
        <div className="topbar-right">
          <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
            {new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>
      </div>
      <div className="page-content">{children}</div>
    </>
  );
}
