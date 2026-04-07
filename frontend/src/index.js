import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { registerServiceWorker } from './utils/notifications';
import './i18n'; // Initialize i18n
import './bones/registry';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for push notifications
if (process.env.NODE_ENV === 'production' || process.env.REACT_APP_ENABLE_SERVICE_WORKER === 'true') {
  registerServiceWorker()
    .then(() => {
      console.log('Service Worker registered successfully');
    })
    .catch((error) => {
      console.error('Service Worker registration failed:', error);
    });
} else {
  console.log('Service Worker registration skipped in development mode');
  console.log('Set REACT_APP_ENABLE_SERVICE_WORKER=true in .env to enable in development');
}
