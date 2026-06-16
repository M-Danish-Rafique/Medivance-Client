import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useSidebar } from '../../context/SidebarContext';

/**
 * Persistent shell for all authenticated pages.
 * Rendered ONCE per session (not per-route), so the Sidebar never remounts
 * when navigating between modules — preserving its scroll position.
 */
export default function AppLayout() {
  const { collapsed } = useSidebar();
  return (
    <div className="app-layout">
      <Sidebar />
      <div className={`main-content${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Outlet />
      </div>
    </div>
  );
}
