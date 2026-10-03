// Firebase bridge for the songbook.
//
// The app (app.js) was written against the Claude artifact database. This file
// gives it the same shape on top of Firestore, so there is only one copy of the
// app logic to keep right:
//
//   db.collection("songs").doc(id).set(data) / .update(data) / .delete()
//   db.collection("songs").onSnapshot(next, error)
//
// It also owns Google sign-in. Who may actually write is decided by the
// Firestore rules on the server — the EDITORS list here only decides which
// buttons to show, so editing it grants nobody anything.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { FIREBASE_CONFIG, EDITORS } from "./config.js?v=20261003153236";

const editors = (EDITORS || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);

// Firestore error codes, mapped to the ones app.js already branches on.
function mapCode(code) {
  switch (code) {
    case "permission-denied":  return "invalid_argument";
    case "unauthenticated":    return "invalid_argument";
    case "invalid-argument":   return "invalid_argument";
    case "resource-exhausted": return "resource_exhausted";
    case "unavailable":        return "unavailable";
    default:                   return "unavailable";
  }
}

function wrapError(e) {
  return { code: mapCode(e && e.code), message: (e && e.message) || "Firestore error" };
}

function rethrow(p) {
  return p.catch((e) => { throw wrapError(e); });
}

let resolveReady, rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

// Published before anything async, so app.js finds it whichever order they run.
window.__sb = { ready, signIn() {}, signOut() {} };

function canWriteAs(user) {
  if (!user || !user.emailVerified) return false;
  return editors.includes(String(user.email || "").toLowerCase());
}

if (!FIREBASE_CONFIG || String(FIREBASE_CONFIG.projectId || "").startsWith("PASTE_")) {
  const msg = "site/config.js still has placeholder values — see SETUP.md step 2.";
  console.error("[songbook] " + msg);
  rejectReady(new Error(msg));
  window.dispatchEvent(new Event("sb-ready"));
}

try {
  if (String(FIREBASE_CONFIG.projectId || "").startsWith("PASTE_")) throw new Error("unconfigured");

  const app  = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const fs   = getFirestore(app);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  window.__sb.signIn = () => {
    setPersistence(auth, browserLocalPersistence)
      .then(() => signInWithPopup(auth, provider))
      .catch((e) => {
        if (e && e.code === "auth/popup-closed-by-user") return;
        console.error("[songbook] sign-in failed:", e && e.code, e && e.message);
      });
  };
  window.__sb.signOut = () => signOut(auth).catch(() => {});

  function wrapCollection(name) {
    const col = collection(fs, name);
    return {
      doc(id) {
        const ref = id ? doc(fs, name, id) : doc(col);
        return {
          id: ref.id,
          path: ref.path,
          set:    (data) => rethrow(setDoc(ref, data)),
          update: (data) => rethrow(updateDoc(ref, data)),
          delete: ()     => rethrow(deleteDoc(ref))
        };
      },
      onSnapshot(next, error) {
        return onSnapshot(
          col,
          (snap) => next({
            docs: snap.docs.map((d) => ({ id: d.id, exists: d.exists(), data: () => d.data() })),
            size: snap.size,
            empty: snap.empty
          }),
          (e) => { if (error) error(wrapError(e)); }
        );
      }
    };
  }

  const db = { collection: wrapCollection };

  // app.js registers one handler; it runs now and on every auth change after.
  let userHandler = null;
  let lastUser = null;
  let settled = false;

  onAuthStateChanged(auth, (user) => {
    lastUser = user;

    if (!settled) {
      settled = true;
      resolveReady({
        db,
        onUser(fn) {
          userHandler = fn;
          fn(lastUser, canWriteAs(lastUser));
        }
      });
    }

    if (userHandler) userHandler(user, canWriteAs(user));
  });

  window.dispatchEvent(new Event("sb-ready"));
} catch (e) {
  console.error("[songbook] Firebase failed to start:", e);
  rejectReady(e);
  window.dispatchEvent(new Event("sb-ready"));
}
