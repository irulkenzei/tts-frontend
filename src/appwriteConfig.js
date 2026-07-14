import { Client, Databases, Account, ID, Query } from 'appwrite';

// 🔧 Nilai-nilai ini SAMA PERSIS dengan yang di App.jsx -- sengaja file
// terpisah (bukan import dari App.jsx) supaya gak perlu ubah App.jsx yang
// sudah besar & jalan normal. Kalau endpoint/project ID berubah, update di
// KEDUA tempat (di sini dan App.jsx).
export const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '6a3a48a1003d333b0268';
export const DATABASE_ID = 'naratorai';

// 🆕 Collection baru khusus fitur "Voice Listings" (voice-over showcase
// yang di-publish admin, ditampilkan publik + dikonsumsi mobile app).
export const VOICE_LISTINGS_COLLECTION_ID = 'voice_listings';

// 🆕 File audio listing disimpen di Cloudflare R2 (bukan Appwrite Storage
// lagi) -- diupload lewat Function perantara ini, biar kredensial R2 gak
// pernah nyentuh browser. Ganti ID ini sesuai Function ID Anda yang
// sebenarnya setelah di-deploy.
export const UPLOAD_TO_R2_FUNCTION_ID = '6a558bf900380739d257';

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const databases = new Databases(client);
export const account = new Account(client);

export { ID, Query };
