import { useState } from 'react';
import './ProPricingPage.css';

// 📌 Variant ID Lemon Squeezy (BUKAN product ID) -- ambil dari Lemon
// Squeezy Dashboard > Products > pilih product > klik variant-nya > lihat
// ID di URL atau tab "Variants". WAJIB diisi sebelum halaman ini jalan.
const LEMONSQUEEZY_VARIANT_IDS = {
  monthly: '1925516', 
  yearly: '1925523',
};

// Function Appwrite yang bikin Lemon Squeezy Checkout -- URL endpoint HTTP
// (bukan lewat Appwrite SDK createExecution, karena ini butuh browser
// redirect langsung ke checkout.url, lebih simpel pakai fetch biasa ke
// endpoint HTTP function-nya).
const CREATE_CHECKOUT_URL = import.meta.env.VITE_CREATE_CHECKOUT_URL;

// Harga ditampilkan statis di sini (SAMA PERSIS dengan mobile: $14.99/bulan,
// $99.99/tahun) -- beda dengan mobile yang fetch harga live dari store,
// karena Stripe Checkout sendiri yang nanti nampilin harga resmi & currency
// yang benar pas user sampai di halaman checkout-nya.
const PRICING_DISPLAY = {
  monthly: { price: '$14.99', period: 'per month' },
  yearly: { price: '$99.99', period: 'per year • save 42%' },
};

export default function ProPricingPage() {
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [email, setEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleGetProAccess = async () => {
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsProcessing(true);
    try {
      const res = await fetch(CREATE_CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: LEMONSQUEEZY_VARIANT_IDS[selectedPlan],
          email: email.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to start checkout.');
      }

      // 🔀 Redirect penuh ke halaman Lemon Squeezy Checkout (bukan
      // modal/iframe) -- pola paling simpel & aman, user bayar di domain
      // Lemon Squeezy sendiri.
      window.location.href = data.url;
    } catch (e) {
      console.error('[lemonsqueezy] checkout error:', e);
      setError(e.message || 'Something went wrong. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="pro-container">
      <div className="aura-purple" />
      <div className="aura-blue" />

      <div className="pro-content">
        <div className="pro-header">
          <div className="crown-circle">
            <span className="emoji-icon">👑</span>
          </div>
          <h1 className="pro-title">Unlock Premium</h1>
        </div>

        <div className="features-grid">
          <FeatureItem icon="⚡" label="Fair-use generation" />
          <FeatureItem icon="🎙️" label="Voice cloning included" />
          <FeatureItem icon="🌊" label="330+ AI voices" />
          <FeatureItem icon="⬇️" label="Download & share" />
          <FeatureItem icon="📁" label="Local storage" />
          <FeatureItem icon="💎" label="Premium quality" />
        </div>

        <div className="pricing-section">
          <button
            className={`plan-card ${selectedPlan === 'monthly' ? 'selected' : ''}`}
            onClick={() => setSelectedPlan('monthly')}
          >
            <div className="radio-row">
              <div className={`radio-outline ${selectedPlan === 'monthly' ? 'active' : ''}`}>
                {selectedPlan === 'monthly' && <div className="radio-inner" />}
              </div>
              <span className="plan-name">Monthly</span>
            </div>
            <div className="price">{PRICING_DISPLAY.monthly.price}</div>
            <div className="price-sub">{PRICING_DISPLAY.monthly.period}</div>
          </button>

          <button
            className={`plan-card ${selectedPlan === 'yearly' ? 'selected' : ''}`}
            onClick={() => setSelectedPlan('yearly')}
          >
            <div className="best-value-badge">
              <span>⭐ BEST VALUE</span>
            </div>
            <div className="radio-row">
              <div className={`radio-outline ${selectedPlan === 'yearly' ? 'active' : ''}`}>
                {selectedPlan === 'yearly' && <div className="radio-inner" />}
              </div>
              <span className="plan-name">Yearly</span>
            </div>
            <div className="price">{PRICING_DISPLAY.yearly.price}</div>
            <div className="price-sub">{PRICING_DISPLAY.yearly.period}</div>
          </button>
        </div>

        <div className="action-container">
          <input
            type="email"
            className="email-input"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isProcessing}
          />

          {error && (
            <div className="error-box">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button className="pro-button" onClick={handleGetProAccess} disabled={isProcessing}>
            {isProcessing ? (
              <span className="spinner" />
            ) : (
              <>
                <span className="emoji-icon-sm">👑</span>
                <span>Get Pro Access</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const FeatureItem = ({ icon, label }) => (
  <div className="feature-box">
    <div className="icon-container">{icon}</div>
    <span className="feature-label">{label}</span>
  </div>
);
