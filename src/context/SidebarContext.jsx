import React, { createContext, useContext, useState } from 'react';

const SidebarContext = createContext({ collapsed: false, toggle: () => {} });

export const SidebarProvider = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed(p => !p);
  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => useContext(SidebarContext);
