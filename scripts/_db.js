import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');

initializeApp({ credential: cert(JSON.parse(sa)) });

export const db = getFirestore();
export const COL = 'lottery';
export const DOC = 'shared_data';
