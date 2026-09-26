import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
const required = ["apiKey", "authDomain", "projectId", "appId"] as const;
const mode = import.meta.env.VITE_DATA_BACKEND || "auto";
const configured = required.every(key => Boolean(config[key]?.trim()));
const requested = mode === "firebase" || (mode === "auto" && required.some(key => Boolean(config[key]?.trim())));
export const firebaseConfigurationError = requested && !configured ? "Firebase configuration is incomplete. Fill in the VITE_FIREBASE values in .env.local and restart the app." : !["auto", "local", "firebase"].includes(mode) ? "VITE_DATA_BACKEND must be auto, local or firebase." : "";
export const firebaseServices = (() => {
    if (!requested || !configured || firebaseConfigurationError) return null;
    const app = initializeApp(config);
    const auth = getAuth(app), db = getFirestore(app);
    if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
    return { app, auth, db };
})();
