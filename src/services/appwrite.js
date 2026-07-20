import { Account, Client, Databases } from 'appwrite';

// 🔧 Env var pakai prefix VITE_ (konsisten dengan yang sudah dipakai di
// project ini, misal VITE_CREATE_CHECKOUT_URL, VITE_MIDTRANS_CLIENT_KEY).
export const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);

export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;
// Sama persis collection yang dipakai mobile app (ProfileScreen.tsx) --
// dokumen di sini menandakan user "beneran login", bukan anonymous.
export const REGISTERED_USERS_COLLECTION_ID = 'registered_users';
