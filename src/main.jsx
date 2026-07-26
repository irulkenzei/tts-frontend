import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './components/App.jsx'
import AdminListings from './components/AdminListings.jsx'
import PublicVoiceListings from './components/PublicVoiceListings.jsx'
import ResetPassword from './components/ResetPassword.jsx'
import AdminDataManager from './components/AdminDataManager.jsx'
import ProPricingPage from './components/ProPricingPage.jsx'
import PricingSuccessPage from './components/PricingSuccessPage.jsx'
import CreateAccountPage from './components/CreateAccountPage.jsx'
import LoginPage from './components/LoginPage.jsx'
import AuthCallbackPage from './components/AuthCallbackPage.jsx'
import AccountPage from './components/AccountPage.jsx'

// 🔧 Diganti dari pathname-matching manual (window.location.pathname)
// ke react-router-dom -- perilaku SAMA PERSIS seperti sebelumnya:
// tiap path spesifik render komponennya masing-masing, path lain
// (termasuk "/") fallback ke <App /> lewat wildcard route "*".
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminListings />} />
        <Route path="/voices" element={<PublicVoiceListings />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/admin-emotions" element={<AdminDataManager />} />
        <Route path="/pricing" element={<ProPricingPage />} />
        <Route path="/pricing-success" element={<PricingSuccessPage />} />
        <Route path="/signup" element={<CreateAccountPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth-callback" element={<AuthCallbackPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)