import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '' };

const CompanyContext = createContext({ company: DEFAULT_COMPANY, loading: true, refresh: () => {} });

export const CompanyProvider = ({ children }) => {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/admin/company');
      if (r.data && r.data.name) {
        setCompany({
          name: r.data.name || DEFAULT_COMPANY.name,
          address: r.data.address || '',
          phone: r.data.phone || '',
          email: r.data.email || '',
          logo_url: '',
        });
      }
    } catch (_) {
      // Keep fallback "Medivance" if fetching company details fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the browser tab title in sync with the company name
  useEffect(() => {
    document.title = company.name ? `${company.name} — Distribution System` : 'Medivance';
  }, [company.name]);

  return (
    <CompanyContext.Provider value={{ company, loading, refresh: load }}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => useContext(CompanyContext);
