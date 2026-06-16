import React, { useState, useEffect } from 'react';

const PUBLIC = process.env.PUBLIC_URL || '';

/** White/light logo — sidebar, login, in-app UI */
export const LOGO_LIGHT = `${PUBLIC}/logo-light.png`;

/** Dark logo — invoices, ledger PDFs, print */
export const LOGO_DARK = `${PUBLIC}/logo-dark.png`;

function defaultForVariant(variant) {
  return variant === 'dark' ? LOGO_DARK : LOGO_LIGHT;
}

function resolveLogoSrc(logoUrl, variant = 'light') {
  const custom = (logoUrl || '').trim();
  if (!custom || custom === 'null' || custom === 'undefined') return defaultForVariant(variant);
  return custom;
}

/** Absolute URL so the logo loads in new windows / print routes. */
function getLogoUrl(logoUrl, variant = 'light') {
  const resolved = resolveLogoSrc(logoUrl, variant);
  if (/^https?:\/\//i.test(resolved) || resolved.startsWith('data:')) return resolved;
  if (typeof window !== 'undefined') {
    const path = resolved.startsWith('/') ? resolved : `/${resolved}`;
    return `${window.location.origin}${path}`;
  }
  return resolved;
}

/**
 * @param {'light'|'dark'} variant — light for app UI, dark for invoices/print
 */
export default function CompanyLogo({
  logoUrl,
  variant = 'light',
  name,
  size = 38,
  fontSize = 18,
  style = {},
  className = '',
}) {
  const fallback = getLogoUrl(null, variant);
  const [src, setSrc] = useState(() => getLogoUrl(logoUrl, variant));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(getLogoUrl(logoUrl, variant));
    setFailed(false);
  }, [logoUrl, variant]);

  const initial = (name || 'M').trim().charAt(0).toUpperCase();
  const isDarkSidebar = variant === 'light';

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: Math.max(6, Math.round(size * 0.26)),
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: 'transparent',
    ...style,
  };

  const handleError = () => {
    if (src !== fallback) {
      setSrc(fallback);
      return;
    }
    setFailed(true);
  };

  if (!failed) {
    return (
      <div className={className} style={baseStyle}>
        <img
          src={src}
          alt={name || 'Logo'}
          onError={handleError}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        background: 'transparent',
        border: isDarkSidebar ? '1px solid rgba(255,255,255,0.35)' : '1px solid #000',
        fontSize,
        fontWeight: 800,
        color: isDarkSidebar ? 'white' : '#000',
      }}
    >
      {initial}
    </div>
  );
}

export { resolveLogoSrc, getLogoUrl, defaultForVariant };

// Back-compat alias
export const DEFAULT_LOGO = LOGO_LIGHT;
