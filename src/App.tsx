import { lazy, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { fetchSettingsFromSupabase } from './lib/uazapi';

// Cada tela e carregada so quando e aberta (o site abre bem mais rapido)
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Appointments = lazy(() => import('./pages/Appointments').then((m) => ({ default: m.Appointments })));
const Campaigns = lazy(() => import('./pages/Campaigns').then((m) => ({ default: m.Campaigns })));
const CampaignDetail = lazy(() => import('./pages/CampaignDetail').then((m) => ({ default: m.CampaignDetail })));
const WhatsAppUnified = lazy(() => import('./pages/WhatsAppUnified').then((m) => ({ default: m.WhatsAppUnified })));
const VendasPendentes = lazy(() => import('./pages/VendasPendentes').then((m) => ({ default: m.VendasPendentes })));
const FunilVendas = lazy(() => import('./pages/FunilVendas').then((m) => ({ default: m.FunilVendas })));
const Alertas = lazy(() => import('./pages/Alertas').then((m) => ({ default: m.Alertas })));
const UserConfig = lazy(() => import('./pages/UserConfig').then((m) => ({ default: m.UserConfig })));

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
          <Route path="/vendas-pendentes" element={<VendasPendentes />} />
          <Route path="/funil" element={<FunilVendas />} />
          <Route path="/alertas" element={<Alertas />} />
          <Route path="/users" element={<UserConfig />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
