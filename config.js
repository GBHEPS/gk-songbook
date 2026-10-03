// Songbook configuration.
//
// FIREBASE_CONFIG is safe to commit — these values are public by design and
// identify the project, they do not grant access. Access is decided entirely
// by firestore.rules on the server.
//
// Paste the values from:
//   Firebase console -> Project settings -> General -> Your apps -> Web app -> SDK setup

export const FIREBASE_CONFIG = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT_ID.firebaseapp.com",
  projectId:         "PASTE_PROJECT_ID",
  storageBucket:     "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID"
};

// Who gets the editing buttons. This is cosmetic only — the real gate is the
// matching list in firestore.rules. Keep the two lists identical.
export const EDITORS = [
  "geoffrey@eastportlandsash.com",
  "kris@reddoorstories.com"
];
