import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { createChromeServices } from '../services/app-services';
import { ServicesProvider } from '../services/services-provider';
import { OptionsApp } from './app';

const container = document.getElementById('root');
if (!container) throw new Error('ApplyPilot: missing #root element');

createRoot(container).render(
  <StrictMode>
    <ServicesProvider services={createChromeServices()}>
      <OptionsApp />
    </ServicesProvider>
  </StrictMode>,
);
