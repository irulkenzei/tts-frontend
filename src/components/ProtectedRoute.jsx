import { Navigate, Outlet } from 'react-router-dom';

const ProtectedRoute = () => {
  // Cek status otentikasi. 
  // Jika Anda menggunakan Appwrite, cek apakah ada sesi aktif di sini.
  // Ini adalah contoh sederhana menggunakan localStorage:
  const isAuthenticated = localStorage.getItem('isLoggedIn') === 'true';

  if (!isAuthenticated) {
    // Jika belum login, redirect paksa ke halaman /admin
    // replace=true memastikan mereka tidak bisa menekan tombol "Back" di browser
    return <Navigate to="/admin" replace />;
  }

  // Jika sudah login, izinkan untuk merender komponen turunan (seperti admin-emotions)
  return <Outlet />;
};

export default ProtectedRoute;
