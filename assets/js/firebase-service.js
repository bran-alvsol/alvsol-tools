import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const FIREBASE_VERSION = "12.16.0";
const CDN_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const ADMIN_USERNAME = "admin";
const INTERNAL_EMAIL_DOMAIN = "alvsol.local";
const MANAGEMENT_APP_NAME = "alvsol-user-management";

let auth;
let db;
let managementAuth;

export async function initializeFirebaseServices() {
  if (!isFirebaseConfigured()) {
    return {
      configured: false,
      message: "Firebase aún no está configurado. Edita assets/js/firebase-config.js."
    };
  }

  const [appModule, authModule, firestoreModule] = await Promise.all([
    import(`${CDN_BASE}/firebase-app.js`),
    import(`${CDN_BASE}/firebase-auth.js`),
    import(`${CDN_BASE}/firebase-firestore.js`)
  ]);

  const app = appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = firestoreModule.getFirestore(app);

  const managementApp = appModule.initializeApp(firebaseConfig, MANAGEMENT_APP_NAME);
  managementAuth = authModule.getAuth(managementApp);
  await authModule.setPersistence(managementAuth, authModule.inMemoryPersistence);

  return {
    configured: true,
    appModule,
    authModule,
    firestoreModule
  };
}

export function requireFirebase() {
  if (!auth || !db) {
    throw new Error("Firebase no está inicializado.");
  }
}

export function onAuthStateChangedSafe(callback, authModule) {
  if (!auth || !authModule) return () => {};
  return authModule.onAuthStateChanged(auth, callback);
}

export function normalizeUsername(value) {
  const username = value.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) {
    throw new Error("El usuario debe tener entre 3 y 30 caracteres y usar solo letras, números, punto, guion o guion bajo.");
  }

  return username;
}

export function toInternalEmail(username) {
  return `${normalizeUsername(username)}@${INTERNAL_EMAIL_DOMAIN}`;
}

export async function signIn(username, password, authModule) {
  requireFirebase();
  const email = toInternalEmail(username);
  const credentials = await authModule.signInWithEmailAndPassword(auth, email, password);
  return credentials.user;
}

export async function getPortalAccess(user, firestoreModule) {
  requireFirebase();

  if (user.email === toInternalEmail(ADMIN_USERNAME)) {
    return {
      authorized: true,
      role: "admin",
      username: ADMIN_USERNAME
    };
  }

  const { doc, getDoc } = firestoreModule;
  const profileSnapshot = await getDoc(doc(db, "portal_users", user.uid));

  if (!profileSnapshot.exists()) {
    return { authorized: false };
  }

  const profile = profileSnapshot.data();
  if (typeof profile.username !== "string") {
    return { authorized: false };
  }

  const expectedEmail = toInternalEmail(profile.username);

  if (!profile.active || profile.internalEmail !== user.email || expectedEmail !== user.email) {
    return { authorized: false };
  }

  return {
    authorized: true,
    role: profile.role,
    username: profile.username
  };
}

export async function createManagedUser(username, password, authModule, firestoreModule) {
  requireFirebase();

  const administrator = getCurrentUser();
  if (!administrator || administrator.email !== toInternalEmail(ADMIN_USERNAME)) {
    throw new Error("Solo el administrador puede crear usuarios.");
  }

  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername === ADMIN_USERNAME) {
    throw new Error("El usuario admin ya está reservado.");
  }

  const internalEmail = toInternalEmail(normalizedUsername);
  let createdUser = null;

  try {
    const credentials = await authModule.createUserWithEmailAndPassword(
      managementAuth,
      internalEmail,
      password
    );
    createdUser = credentials.user;

    const { doc, serverTimestamp, setDoc } = firestoreModule;
    await setDoc(doc(db, "portal_users", createdUser.uid), {
      active: true,
      createdAt: serverTimestamp(),
      createdBy: administrator.uid,
      internalEmail,
      role: "user",
      username: normalizedUsername
    });

    return {
      id: createdUser.uid,
      role: "user",
      username: normalizedUsername
    };
  } catch (error) {
    if (createdUser) {
      await authModule.deleteUser(createdUser).catch(() => {});
    }
    throw error;
  } finally {
    await authModule.signOut(managementAuth).catch(() => {});
  }
}

export async function listManagedUsers(firestoreModule) {
  requireFirebase();

  const administrator = getCurrentUser();
  if (!administrator || administrator.email !== toInternalEmail(ADMIN_USERNAME)) {
    throw new Error("Solo el administrador puede consultar usuarios.");
  }

  const { collection, getDocs, limit, query } = firestoreModule;
  const snapshot = await getDocs(query(collection(db, "portal_users"), limit(50)));

  return snapshot.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data()
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function signOutCurrentUser(authModule) {
  requireFirebase();
  await authModule.signOut(auth);
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}

export async function saveTestRecord(firestoreModule) {
  requireFirebase();

  const user = getCurrentUser();
  if (!user) {
    throw new Error("Inicia sesión antes de guardar datos.");
  }

  const { addDoc, collection, serverTimestamp } = firestoreModule;
  const record = {
    label: "Prueba ALVSOL Tools",
    createdAt: serverTimestamp(),
    userEmail: user.email,
    userId: user.uid
  };

  const documentRef = await addDoc(collection(db, "portal_test_records"), record);
  return documentRef.id;
}

export async function readTestRecords(firestoreModule) {
  requireFirebase();

  const user = getCurrentUser();
  if (!user) {
    throw new Error("Inicia sesión antes de leer datos.");
  }

  const { collection, getDocs, limit, query, where } = firestoreModule;
  const recordsQuery = query(
    collection(db, "portal_test_records"),
    where("userId", "==", user.uid),
    limit(10)
  );

  const snapshot = await getDocs(recordsQuery);
  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data()
    }))
    .sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() ?? 0;
      const dateB = b.createdAt?.toMillis?.() ?? 0;
      return dateB - dateA;
    });
}
