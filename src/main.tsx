import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './styles.css';

import { installDiagnosticsLogging } from './lib/diagnosticsLogging';
import { ErrorBoundary } from './shell/ErrorBoundary';

installDiagnosticsLogging();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
