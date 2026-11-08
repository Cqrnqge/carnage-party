import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import UpdatePrompt from './components/updates/UpdatePrompt.jsx';
import WhatsNewPrompt from './components/updates/WhatsNewPrompt.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <UpdatePrompt />
    <WhatsNewPrompt />
  </React.StrictMode>
);
