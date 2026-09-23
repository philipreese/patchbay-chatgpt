import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Verification from './Verification';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{new URLSearchParams(location.search).has('verify')?<Verification />:<App />}</React.StrictMode>);
