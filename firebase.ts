import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: "AIzaSyDwklK-fprq-oQe4nil83mTBxtRCTDOlzg",
  authDomain: "saok-779e1.firebaseapp.com",
  projectId: "saok-779e1",
  storageBucket: "saok-779e1.firebasestorage.app",
  messagingSenderId: "303413242801",
  appId: "1:303413242801:web:fe5b75e151dcfbfb63eb90",
  measurementId: "G-3W265LQZ6K",
};

const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db: Firestore = getFirestore(app);
const auth: Auth = getAuth(app);

// Firebase Analytics is web-only in Firebase JS SDK.
// Use this helper when you run on web; native builds return null.
export async function getFirebaseAnalytics() {
  if (Platform.OS !== "web") return null;
  const { getAnalytics, isSupported } = await import("firebase/analytics");
  const supported = await isSupported();
  if (!supported) return null;
  return getAnalytics(app);
}

export { app, db, auth, firebaseConfig };
