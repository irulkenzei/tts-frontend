import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AdminListings from './AdminListings.jsx'
import PublicVoiceListings from './PublicVoiceListings.jsx'
import ResetPassword from './ResetPassword.jsx'
import AdminDataManager from './AdminDataManager.jsx'
const path = window.location.pathname
const RootComponent =
  path === '/admin/' ? AdminListings
  : path === '/voices' ? PublicVoiceListings
  : path === '/reset-password' ? ResetPassword
  : path === '/admin-emotions' ? AdminDataManager
  : App
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
) 
