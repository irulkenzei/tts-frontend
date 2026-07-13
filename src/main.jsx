import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AdminListings from './AdminListings.jsx'
import PublicVoiceListings from './PublicVoiceListings.jsx'

// 🆕 Routing minimal -- cek path URL manual, TANPA nambah dependency baru
// (react-router-dom). Cukup buat kebutuhan sekarang: 3 halaman statis,
// bukan aplikasi multi-route kompleks. Kalau nanti butuh routing lebih
// canggih (nested routes, dynamic params, dst), baru pertimbangkan
// react-router-dom beneran.
const path = window.location.pathname

const RootComponent =
  path === '/admin' ? AdminListings
  : path === '/voices' ? PublicVoiceListings
  : App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
)
