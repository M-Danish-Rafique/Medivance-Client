import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import CompanyLogo from '../../components/common/CompanyLogo';
import toast from 'react-hot-toast';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const { login } = useAuth();
  const { company } = useCompany();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      toast.error('Please enter credentials');
      return;
    }
    setLoading(true);
    try {
      await login(form.username, form.password);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <CompanyLogo logoUrl={company.logo_url} variant="dark" name={company.name} size={60} fontSize={26}
              style={{ boxShadow: '0 8px 24px rgba(37,99,235,0.3)' }} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#0f1f3d', letterSpacing: '-0.5px' }}>
            {company.name}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Medicine Distribution System
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="form-control"
              type="text"
              placeholder="Enter username"
              value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-control"
                type={showPass ? 'text' : 'password'}
                placeholder="Enter password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8'
                }}>
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={loading}
            style={{ justifyContent: 'center', marginTop: 8 }}>
            {loading ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Signing in...</>
            ) : (
              '→ Sign In'
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 28, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>© {new Date().getFullYear()} {company.name} · All rights reserved</div>
        </div>
      </div>
    </div>
  );
}
