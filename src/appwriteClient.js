import { Account, Client, Databases, Functions, Storage } from 'appwrite';

// 🆕 Diekstrak dari App.jsx -- sebelumnya client/databases/dll cuma
// diinstansiasi INLINE di App.jsx, jadi komponen lain (EmotionPicker.jsx)
// gak bisa reuse tanpa duplikasi setup. App.jsx sekarang import dari sini
// juga (lihat perubahan di App.jsx), bukan instansiasi ulang.
export const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '6a3a48a1003d333b0268';
export const DATABASE_ID = 'naratorai';

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const appwriteFunctions = new Functions(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const account = new Account(client);
