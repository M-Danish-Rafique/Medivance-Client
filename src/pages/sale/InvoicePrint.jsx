import React, { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import InvoiceDocument, { INVOICE_STYLES } from './InvoiceDocument';

const DEFAULT_COMPANY = { name: 'Medivance', address: '', phone: '', email: '', logo_url: '' };

function PrintBar({ type, setType, onPrint, loading }) {
  const types = [
    { key: 'warranty', label: 'Warranty' },
    { key: 'warranty10', label: 'Warranty (10% Disc)' },
    { key: 'non-warranty', label: 'Non-Warranty' },
  ];
  return (
    <div className="no-print invoice-print-bar">
      <div className="invoice-print-bar-title">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>description</span>
        Invoice Preview
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {types.map(t => (
          <button key={t.key} onClick={() => setType(t.key)}
            className={`invoice-type-btn${type === t.key ? ' active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onPrint} className="invoice-print-btn">
        <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>print</span>
        {loading ? 'Loading...' : 'Print Now'}
      </button>
      <button onClick={() => window.close()} className="invoice-close-btn">Close</button>
    </div>
  );
}

export default function InvoicePrint() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [saleData, setSaleData] = useState(null);
  const [customerBalance, setCustomerBalance] = useState(0);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState(searchParams.get('type') || 'warranty');
  const [printedAt, setPrintedAt] = useState(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/sales/${id}`),
      api.get('/admin/company').catch(() => ({ data: null })),
    ]).then(async ([saleRes, companyRes]) => {
      const sale = saleRes.data;
      setSaleData(sale);
      setCompany({
        name: companyRes.data?.name || DEFAULT_COMPANY.name,
        address: companyRes.data?.address || '',
        phone: companyRes.data?.phone || '',
        email: companyRes.data?.email || '',
        logo_url: companyRes.data?.logo_url || '',
      });
      try {
        const balRes = await api.get(`/customers/${sale.customer_id}/balance`);
        const currentBal = parseFloat(balRes.data.balance || 0);
        const invoiceAmt = parseFloat(sale.total_amount || 0);
        setCustomerBalance(Math.max(0, currentBal - invoiceAmt));
      } catch { setCustomerBalance(0); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const handlePrint = useCallback(() => {
    const now = new Date();
    flushSync(() => setPrintedAt(now));
    setTimeout(() => window.print(), 150);
  }, []);

  useEffect(() => {
    const onBeforePrint = () => {
      flushSync(() => setPrintedAt(new Date()));
    };
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontWeight: 600 }}>Loading invoice...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{INVOICE_STYLES}</style>
      <style>{`
        .invoice-print-bar {
          position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
          background: white; border-bottom: 2px solid #e2e8f0;
          padding: 10px 20px; display: flex; align-items: center; gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .invoice-print-bar-title {
          font-weight: 800; font-size: 15px; color: #1a365d;
          display: flex; align-items: center; gap: 6px;
        }
        .invoice-type-btn {
          padding: 7px 16px; border-radius: 8px; border: 2px solid #e2e8f0;
          background: white; color: #555; font-weight: 700; font-size: 13px; cursor: pointer;
        }
        .invoice-type-btn.active { border-color: #1a365d; background: #1a365d; color: white; }
        .invoice-print-btn {
          padding: 8px 24px; background: #2563eb; color: white;
          border: none; border-radius: 8px; font-weight: 800; font-size: 14px; cursor: pointer;
        }
        .invoice-close-btn {
          padding: 8px 16px; background: #f1f5f9; color: #555;
          border: none; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer;
        }
      `}</style>

      <PrintBar type={type} setType={setType} onPrint={handlePrint} loading={loading} />

      <InvoiceDocument
        saleData={saleData}
        type={type}
        customerBalance={customerBalance}
        company={company}
        printedAt={printedAt}
      />
    </>
  );
}