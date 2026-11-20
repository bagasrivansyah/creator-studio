/**
 * Firebase initialization for Creator Studio.
 *
 * Configuration comes from environment variables (see `.env.example`).
 * If no real config is present, the app runs in DEMO MODE: the UI stays fully
 * usable with clearly-labelled sample output, and no Firebase SDK calls are
 * made. This keeps the repo free of any real project identifiers.
 */
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const env = import.meta.env;

function readConfig() {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
  };
}

const config = readConfig();

/** True only when a real Firebase web config has been supplied. */
export const isConfigured =
  Boolean(config.apiKey) &&
  !config.apiKey.startsWith("YOUR_") &&
  Boolean(config.projectId) &&
  !config.projectId.startsWith("YOUR_");

export const firebaseProjectId = isConfigured ? config.projectId : null;

let app = null;
let ai = null;
let auth = null;
let db = null;
let appCheckReady = false;

if (isConfigured) {
  app = initializeApp(config);

  // ---- App Check -----------------------------------------------------------
  // Firebase AI Logic enforces App Check. Two supported paths:
  //  1. A reCAPTCHA v3 site key (production / hosted demo).
  //  2. The debug provider (local development and hackathon submissions —
  //     debug tokens are explicitly accepted by the contest rules).
  // With the debug token enabled, the SDK uses the debug provider instead of
  // reCAPTCHA and prints a token to the console to register in the console.
  try {
    const siteKey = env.VITE_RECAPTCHA_V3_SITE_KEY || "";
    const debugEnabled =
      String(env.VITE_APPCHECK_DEBUG || "").toLowerCase() === "true" ||
      import.meta.env.DEV;
    if (!siteKey && debugEnabled) {
      // Use the pre-registered console debug token when provided, so App Check
      // attestation succeeds; otherwise the SDK generates one and prints it
      // to the console for registration.
      // eslint-disable-next-line no-undef
      self.FIREBASE_APPCHECK_DEBUG_TOKEN =
        env.VITE_APPCHECK_DEBUG_TOKEN || true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey || "debug-placeholder"),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckReady = true;
  } catch (err) {
    console.warn("[creator-studio] App Check init failed:", err);
    appCheckReady = false;
  }

  // ---- AI Logic (Gemini Developer API backend) -----------------------------
  ai = getAI(app, { backend: new GoogleAIBackend() });

  // ---- Auth (anonymous) + Firestore ----------------------------------------
  auth = getAuth(app);
  db = getFirestore(app);
}

export function getFirebaseAI() {
  return ai;
}

export function getFirestoreDb() {
  return db;
}

export function getFirebaseAuth() {
  return auth;
}

export function isAppCheckReady() {
  return appCheckReady;
}

/**
 * Signs the user in anonymously so saved projects can be scoped to a uid in
 * Firestore. Resolves with the uid, or null when Firebase is not configured
 * or sign-in fails (the app then falls back to localStorage).
 */
export async function ensureAnonymousAuth() {
  if (!auth) return null;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch (err) {
    console.warn("[creator-studio] Anonymous sign-in failed:", err);
    return null;
  }
}

export function onAuthChange(cb) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, cb);
}
