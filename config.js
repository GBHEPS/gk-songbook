// Songbook configuration.
//
// FIREBASE_CONFIG is safe to commit — these values are public by design and
// identify the project, they do not grant access. Access is decided entirely
// by firestore.rules on the server.
//
// Paste the values from:
//   Firebase console -> Project settings -> General -> Your apps -> Web app -> SDK setup

export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyA6-wFOCUdkU143vdMk4aXmsZhKNRb3PDo",
  authDomain:        "gk-songbook.firebaseapp.com",
  projectId:         "gk-songbook",
  storageBucket:     "gk-songbook.firebasestorage.app",
  messagingSenderId: "1059337927141",
  appId:             "1:1059337927141:web:e40afffa20a9574b65170c"
};

// Who gets the editing buttons. This is cosmetic only — the real gate is the
// matching list in firestore.rules. Keep the two lists identical.
export const EDITORS = [
  "geoffrey@eastportlandsash.com",
  "kris@reddoorstories.com"
];
