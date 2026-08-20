import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MaintenancePage from './MaintenancePage';
import SiteManagerV2 from './SiteManagerV2';

const maintenanceFlag = import.meta.env.VITE_PUBLIC_MAINTENANCE;
const showMaintenance = maintenanceFlag
  ? maintenanceFlag.trim().toLowerCase() !== 'false'
  : import.meta.env.PROD;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showMaintenance ? <MaintenancePage /> : <SiteManagerV2 />}
  </StrictMode>
);
