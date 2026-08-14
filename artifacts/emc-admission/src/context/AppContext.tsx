import React, { createContext, useContext, useEffect, useState } from 'react';
import { getDB } from '../lib/db';

interface AppContextType {
  rsName: string;
  rsLogo: string;
  refreshSettings: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [rsName, setRsName] = useState('RS EMC Pekayon');
  const [rsLogo, setRsLogo] = useState('');

  const refreshSettings = async () => {
    try {
      const db = await getDB();
      const name = await db.get('settings', 'rsName');
      const logo = await db.get('settings', 'rsLogo');
      if (name?.value) setRsName(name.value);
      if (logo?.value) setRsLogo(logo.value);
    } catch(e) {}
  };

  useEffect(() => {
    refreshSettings();
  }, []);

  return (
    <AppContext.Provider value={{ rsName, rsLogo, refreshSettings }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
};
