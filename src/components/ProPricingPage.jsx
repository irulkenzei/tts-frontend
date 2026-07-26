import { useEffect, useState } from 'react';
import '../styles/ProPricingPage.css';

// 📌 Variant ID Lemon Squeezy (BUKAN product ID) -- ambil dari Lemon
// Squeezy Dashboard > Products > pilih product > klik variant-nya > lihat
// ID di URL atau tab "Variants". WAJIB diisi sebelum halaman ini jalan.
const LEMONSQUEEZY_VARIANT_IDS = {
  monthly: '1925516', 
  yearly: '1925523',
};
// Function Appwrite yang bikin Lemon Squeezy Checkout -- URL endpoint HTTP.
const CREATE_CHECKOUT_URL = import.meta.env.VITE_CREATE_CHECKOUT_URL;

// URL script Lemon.js -- dimuat dinamis di useEffect di bawah (bukan
// ditaruh manual di index.html), biar file ini "self-contained" -- tinggal
// pasang ProPricingPage.jsx di project manapun, script-nya otomatis kepasang.
const LEMONJS_SRC = 'https://app.lemonsqueezy.com/js/lemon.js';

// 🇮🇩 Jalur Midtrans -- khusus user terdeteksi dari Indonesia. Model
// SEKALI BAYAR per periode (bukan auto-renewal), user bayar manual lagi
// tiap masa aktifnya habis.
const CREATE_MIDTRANS_TRANSACTION_URL = import.meta.env.VITE_CREATE_MIDTRANS_TRANSACTION_URL;
const MIDTRANS_CLIENT_KEY = import.meta.env.VITE_MIDTRANS_CLIENT_KEY;
// Ganti ke 'https://app.midtrans.com/snap/snap.js' kalau sudah production
// (bukan sandbox/testing lagi).
const SNAPJS_SRC = 'https://app.sandbox.midtrans.com/snap/snap.js';

// 💰 Harga dalam IDR -- SILAKAN SESUAIKAN sendiri, ini cuma perkiraan
// konversi kasar dari $14.99/$99.99 (kurs ~Rp16.000/USD, dibulatkan).
// Midtrans transaksi HARUS dalam IDR, gak bisa USD.
const PRICING_IDR = {
  monthly: 239000,
  yearly: 1599000,
};

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
  // 🆕 Backdrop solid custom kita sendiri -- ditampilkan pas overlay Lemon
  // Squeezy dibuka, biar konten halaman (judul "Unlock Premium" dkk) tidak
  // "keliatan tembus" lewat backdrop transparan bawaan Lemon Squeezy.
  const [overlayOpen, setOverlayOpen] = useState(false);
  // 🇮🇩 null = belum terdeteksi/masih loading, true = Indonesia (pakai
  // Midtrans), false = luar Indonesia (pakai Lemon Squeezy). Default aman
  // kalau deteksi gagal: anggap BUKAN Indonesia (pakai jalur global).
  const [isIndonesia, setIsIndonesia] = useState(null);

  // 🌍 Deteksi negara user lewat IP geolocation -- dipanggil sekali saat
  // halaman dibuka. Kalau gagal (network error, API down, dll), fallback
  // ke jalur global (Lemon Squeezy) -- BUKAN diblokir/error ke user.
  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then((res) => res.json())
      .then((data) => setIsIndonesia(data.country_code === 'ID'))
      .catch(() => setIsIndonesia(false));
  }, []);

  // 📜 Muat Lemon.js sekali saat halaman ini pertama dibuka. Kalau script
  // sudah pernah dimuat sebelumnya (misal user pindah-pindah halaman SPA),
  // tidak dimuat dobel.
  useEffect(() => {
    const setupEventHandler = () => {
      window.createLemonSqueezy?.();
      // 🔧 FIX: sebelumnya setOverlayOpen(false) dipanggil DI SINI, pas
      // Checkout.Success -- tapi Lemon Squeezy masih nampilin kartu "Thanks
      // for your order!" mereka SENDIRI selama beberapa detik SEBELUM
      // benar-benar redirect ke SUCCESS_URL. Backdrop kita keburu hilang
      // duluan di jeda itu, /pricing keliatan lagi di belakang kartu
      // konfirmasi mereka (backdrop bawaan mereka ternyata gak fully
      // opaque). Sekarang backdrop kita DIBIARKAN nempel terus sampai
      // browser BENERAN navigasi ke SUCCESS_URL -- itu otomatis unmount
      // komponen ini semua, gak perlu di-manage manual lagi.
      window.LemonSqueezy?.Setup?.({
        eventHandler: () => {},
      });
    };

    if (document.querySelector(`script[src="${LEMONJS_SRC}"]`)) {
      setupEventHandler();
      return;
    }

    const script = document.createElement('script');
    script.src = LEMONJS_SRC;
    script.defer = true;
    script.onload = setupEventHandler;
    document.body.appendChild(script);
  }, []);

  // 📜 Muat Snap.js Midtrans HANYA kalau user terdeteksi dari Indonesia --
  // gak perlu dimuat buat user luar Indonesia sama sekali.
  useEffect(() => {
    if (!isIndonesia) return;
    if (document.querySelector(`script[src="${SNAPJS_SRC}"]`)) return;

    const script = document.createElement('script');
    script.src = SNAPJS_SRC;
    script.setAttribute('data-client-key', MIDTRANS_CLIENT_KEY);
    document.body.appendChild(script);
  }, [isIndonesia]);

  const handleMidtransCheckout = async () => {
    const res = await fetch(CREATE_MIDTRANS_TRANSACTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: selectedPlan, email: email.trim() }),
    });

    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || 'Failed to start checkout.');
    }

    // 🪟 Snap popup Midtrans -- ternyata backdrop bawaan mereka juga tidak
    // fully opaque (sama kayak Lemon Squeezy), jadi tetap pakai backdrop
    // custom kita.
    setIsProcessing(false);
    setOverlayOpen(true);
    window.snap.pay(data.token, {
      onSuccess: () => {
        window.location.href = '/pricing-success?status=success';
      },
      onPending: () => {
        // 🔧 FIX: sebelumnya redirect ke tempat yang SAMA kayak onSuccess,
        // padahal pending itu artinya BELUM benar-benar lunas (misal VA
        // transfer bank yang user masih perlu selesaikan di luar) --
        // is_pro BARU di-grant lewat webhook begitu status jadi
        // "settlement". Query param ?status=pending dipakai
        // PricingSuccessPage buat nampilin pesan yang beda, bukan
        // ngaku-ngaku "You're Pro now!" padahal belum tentu.
        window.location.href = '/pricing-success?status=pending';
      },
      onError: () => {
        setOverlayOpen(false);
        setError('Payment failed. Please try again.');
      },
      onClose: () => {
        // User nutup popup Snap manual tanpa nyelesain bayar -- tutup
        // backdrop kita, biarin mereka tetap di /pricing normal.
        setOverlayOpen(false);
      },
    });
  };

  const handleLemonSqueezyCheckout = async () => {
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

    // 🪟 Buka sebagai OVERLAY (modal di atas halaman ini), bukan redirect
    // penuh -- user tidak pernah "pindah" dari /pricing sama sekali.
    // Kalau gagal/dibatalkan, overlay-nya cuma ketutup, user otomatis
    // "balik" ke /pricing karena memang tidak pernah pergi dari situ.
    setOverlayOpen(true);
    if (window.LemonSqueezy?.Url?.Open) {
      window.LemonSqueezy.Url.Open(data.url);
    } else {
      // Fallback kalau Lemon.js entah kenapa gagal termuat (misal
      // diblokir ad-blocker) -- tetap bisa checkout lewat redirect biasa.
      setOverlayOpen(false);
      window.location.href = data.url;
    }
    setIsProcessing(false);
  };

  const handleGetProAccess = async () => {
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsProcessing(true);
    try {
      // 🇮🇩 Percabangan jalur pembayaran -- Indonesia lewat Midtrans,
      // sisanya (dan kalau deteksi negara gagal/masih loading) lewat
      // Lemon Squeezy.
      if (isIndonesia) {
        await handleMidtransCheckout();
      } else {
        await handleLemonSqueezyCheckout();
      }
    } catch (e) {
      console.error('[checkout] error:', e);
      setError(e.message || 'Something went wrong. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="pro-container">
      <div className="aura-purple" />
      <div className="aura-blue" />

      {/* 🆕 Backdrop solid custom -- nutupin total konten halaman selama
          overlay Lemon Squeezy terbuka, backdrop bawaan mereka transparan
          jadi teks di belakang masih keliatan tanpa ini. */}
      {overlayOpen && (
        <div className="custom-overlay-backdrop">
          <button
            className="custom-overlay-close"
            onClick={() => {
              window.LemonSqueezy?.Url?.Close?.();
              setOverlayOpen(false);
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}

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
            <div className="price">
              {isIndonesia ? `Rp${PRICING_IDR.monthly.toLocaleString('id-ID')}` : PRICING_DISPLAY.monthly.price}
            </div>
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
            <div className="price">
              {isIndonesia ? `Rp${PRICING_IDR.yearly.toLocaleString('id-ID')}` : PRICING_DISPLAY.yearly.price}
            </div>
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
