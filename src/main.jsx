import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
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

// 🔧 Diganti dari BrowserRouter ke HashRouter -- WORKAROUND karena
// Appwrite Sites (khususnya deployment lewat CLI/manual, bukan Git) gak
// mau serve fallbackFile (index.html) buat path yang direct-access lewat
// URL, walau setting-nya sudah benar di server (sudah dicek berkali-kali:
// Settings benar, CLI diff sinkron, deployment Active -- tetap 404).
//
// Dengan HashRouter, semua route jadi bentuk naratorai.com/#/admin,
// naratorai.com/#/voices, dst. Browser TIDAK PERNAH kirim bagian setelah
// "#" itu ke server sebagai request terpisah -- jadi server cuma pernah
// lihat request ke "/" (yang pasti ada, index.html), dan React Router
// yang urus sisanya di sisi client. Ini bikin app selalu jalan di static
// hosting manapun, apapun konfigurasi fallback-nya.
//
// Downside: URL jadi ada tanda "#" (agak kurang rapi + sedikit dampak SEO
// untuk halaman publik seperti /voices, /pricing, /signup). Kalau nanti
// masalah fallbackFile di Appwrite Sites ini sudah confirmed fixed
// (via redeploy Git-connected, atau perbaikan dari tim Appwrite), boleh
// balikin ke BrowserRouter lagi -- tinggal ganti import ini balik.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
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
    </HashRouter>
  </React.StrictMode>,
)
