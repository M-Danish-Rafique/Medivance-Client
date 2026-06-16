import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import './styles/global.css';
import { SidebarProvider } from './context/SidebarContext';
import { CompanyProvider, useCompany } from './context/CompanyContext';
import AppLayout from './components/layout/AppLayout';

import Login from './pages/auth/Login';
import Dashboard from './pages/dashboard/Dashboard';
import Companies from './pages/companies/Companies';
import Products from './pages/products/Products';
import Employees from './pages/employees/Employees';
import Geography from './pages/cities/Geography';
import Customers from './pages/customers/Customers';
import Suppliers from './pages/suppliers/Suppliers';
import Purchase from './pages/purchase/Purchase';
import Sale from './pages/sale/Sale';
import InvoicePrint from './pages/sale/InvoicePrint';
import Inventory from './pages/inventory/Inventory';
import Finance from './pages/finance/Finance';
import Reports from './pages/reports/Reports';
import Recovery from './pages/recovery/Recovery';
import RawMaterials from './pages/manufacturing/RawMaterials';
import Batches from './pages/manufacturing/Batches';
import Yields from './pages/manufacturing/Yields';
import ManufacturedProducts from './pages/manufacturing/ManufacturedProducts';
import TaxLedger from './pages/manufacturing/TaxLedger';
import Profile from './pages/admin/Profile';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const { company } = useCompany();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f1f3d' }}>
      <div style={{ textAlign: 'center', color: 'white' }}>
        <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 12 }}>{company.name}</div>
        <div className="spinner" style={{ margin: '0 auto', borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#3b82f6' }} />
      </div>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
        <SidebarProvider>
          <BrowserRouter>
            <Toaster position="top-right" toastOptions={{ duration: 3500, style: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13.5, borderRadius: 10, boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }, success: { iconTheme: { primary: '#059669', secondary: '#fff' } }, error: { iconTheme: { primary: '#dc2626', secondary: '#fff' } } }} />
            <Routes>
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/invoice/:id/print" element={<PrivateRoute><InvoicePrint /></PrivateRoute>} />

              {/* Persistent app shell — Sidebar stays mounted across navigations */}
              <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/companies" element={<Companies />} />
                <Route path="/products" element={<Products />} />
                <Route path="/employees" element={<Employees />} />
                <Route path="/geography" element={<Geography />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/purchase" element={<Purchase />} />
                <Route path="/sale" element={<Sale />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/finance" element={<Finance />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/recovery" element={<Recovery />} />
                <Route path="/manufacturing/raw-materials" element={<RawMaterials />} />
                <Route path="/manufacturing/batches" element={<Batches />} />
                <Route path="/manufacturing/yields" element={<Yields />} />
                <Route path="/manufacturing/products" element={<ManufacturedProducts />} />
                <Route path="/manufacturing/tax-ledger" element={<TaxLedger />} />
                <Route path="/profile" element={<Profile />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SidebarProvider>
      </CompanyProvider>
    </AuthProvider>
  );
}
