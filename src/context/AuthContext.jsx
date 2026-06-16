import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('medivance_token');
    const savedUser = localStorage.getItem('medivance_user');
    const savedPerms = localStorage.getItem('medivance_perms');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      setPermissions(savedPerms ? JSON.parse(savedPerms) : {});
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    localStorage.setItem('medivance_token', res.data.token);
    localStorage.setItem('medivance_user', JSON.stringify(res.data.user));
    localStorage.setItem('medivance_perms', JSON.stringify(res.data.permissions || {}));
    setUser(res.data.user);
    setPermissions(res.data.permissions || {});
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('medivance_token');
    localStorage.removeItem('medivance_user');
    localStorage.removeItem('medivance_perms');
    setUser(null);
    setPermissions({});
  };

  // Helper: admin always has access; users need the specific flag
  const can = (permKey) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return permissions[permKey] === 1 || permissions[permKey] === true;
  };

  return (
    <AuthContext.Provider value={{ user, permissions, login, logout, loading, can }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
