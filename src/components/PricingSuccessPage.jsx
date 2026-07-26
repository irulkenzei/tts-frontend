import '../styles/ProPricingPage.css';

export default function PricingSuccessPage() {
  // Lemon Squeezy tidak kirim query param apa pun (defaultnya success),
  // Midtrans kirim ?status=pending kalau transaksinya VA/bank transfer
  // yang belum lunas.
  const params = new URLSearchParams(window.location.search);
  const isPending = params.get('status') === 'pending';

  return (
    <div className="pro-container">
      {/* 🆕 Backdrop solid eksplisit -- jaga-jaga kalau halaman ini
          ke-render DI DALAM overlay/iframe Lemon Squeezy (bukan navigasi
          halaman penuh), biar tetap solid #06050a, tidak ada celah
          transparan sama sekali. Z-index RENDAH -- di belakang konten,
          beda dengan versi di ProPricingPage yang sengaja nutupin konten. */}
      <div className="solid-backdrop-behind" />
      <div className="aura-purple" />
      <div className="aura-blue" />

      <div className="pro-content" style={{ textAlign: 'center', paddingTop: '120px' }}>
        <div className="crown-circle" style={{ margin: '0 auto 24px' }}>
          <span className="emoji-icon">{isPending ? '⏳' : '🎉'}</span>
        </div>
        <h1 className="pro-title">{isPending ? 'Payment Pending' : "You're Pro now!"}</h1>
        <p style={{ color: '#8f8cab', fontSize: '15px', marginTop: '12px', lineHeight: 1.6 }}>
          {isPending
            ? 'Please complete your payment using the instructions provided (bank transfer/virtual account). Your account will be upgraded automatically once payment is confirmed — this may take a few minutes.'
            : 'Thanks for subscribing to Narator Pro. Your account will be upgraded shortly — it may take a minute to reflect.'}
        </p>

        <a
          href="/"
          className="pro-button"
          style={{ textDecoration: 'none', marginTop: '32px', display: 'inline-flex' }}
        >
          <span>Back to Narator AI</span>
        </a>
      </div>
    </div>
  );
}
