import { Client, Databases, Storage, Account, ID, Query } from 'appwrite';

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

// Bucket yang SAMA dipakai fitur recording upload yang sudah ada -- reuse,
// gak perlu bikin bucket baru khusus buat ini.
export const RECORDING_UPLOAD_BUCKET_ID = '6a40a942000c72f7a8f1';

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const databases = new Databases(client);
export const storage = new Storage(client);
export const account = new Account(client);

export { ID, Query };
