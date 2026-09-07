import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Appointments } from './pages/Appointments';
import { Campaigns } from './pages/Campaigns';
import { CampaignDetail } from './pages/CampaignDetail';
import { WhatsAppUnified } from './pages/WhatsAppUnified';
import { WhatsAppAI } from './pages/WhatsAppAI';
import { WhatsAppManual } from './pages/WhatsAppManual';
import { VendasPendentes } from './pages/VendasPendentes';
import { UserConfig } from './pages/UserConfig';
import { fetchSettingsFromSupabase } from './lib/uazapi';

function App() {
  useEffect(() => {
    fetchSettingsFromSupabase().catch(console.error);
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/whatsapp" element={<WhatsAppUnified />} />
          <Route path="/whatsapp/ai" element={<WhatsAppAI />} />
          <Route path="/whatsapp/manual" element={<WhatsAppManual />} />
          <Route path="/vendas-pendentes" element={<VendasPendentes />} />
          <Route path="/users" element={<UserConfig />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
