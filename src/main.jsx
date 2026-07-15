import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import App from './App.jsx';
import AdminListings from './AdminListings.jsx';
import PublicVoiceListings from './PublicVoiceListings.jsx';
import ResetPassword from './ResetPassword.jsx';
import AdminDataManager from './AdminDataManager.jsx'; // Ini untuk admin-emotions
import ProtectedRoute from './components/ProtectedRoute'; 

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Rute Publik: Bebas diakses siapa saja */}
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<AdminListings />} />
        <Route path="/voices" element={<PublicVoiceListings />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Rute Terlindungi (Protected): Harus login/melewati pengecekan */}
        <Route element={<ProtectedRoute />}>
          <Route path="/admin-emotions" element={<AdminDataManager />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
