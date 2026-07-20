import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AdminListings from './AdminListings.jsx'
import PublicVoiceListings from './PublicVoiceListings.jsx'
import ResetPassword from './ResetPassword.jsx'
import AdminDataManager from './AdminDataManager.jsx'
import ProPricingPage from './ProPricingPage.jsx'
import PricingSuccessPage from './PricingSuccessPage.jsx'
import CreateAccountPage from './CreateAccountPage.jsx'
import LoginPage from './LoginPage.jsx'
import AuthCallbackPage from './AuthCallbackPage.jsx'
import AccountPage from './AccountPage.jsx'
const path = window.location.pathname
const RootComponent =
  path === '/admin' ? AdminListings
  : path === '/voices' ? PublicVoiceListings
  : path === '/reset-password' ? ResetPassword
  : path === '/admin-emotions' ? AdminDataManager
  : path === '/pricing' ? ProPricingPage
  : path === '/pricing-success' ? PricingSuccessPage
  : path === '/signup' ? CreateAccountPage
  : path === '/login' ? LoginPage
  : path === '/auth-callback' ? AuthCallbackPage
  : path === '/account' ? AccountPage
  : App
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
)
