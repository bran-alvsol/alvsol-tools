import {
  getPortalAccess,
  initializeFirebaseServices,
  onAuthStateChangedSafe,
  signOutCurrentUser
} from "./firebase-service.js";

const portalUrl = new URL("../../index.html", window.location.href);
let finished = false;

function redirectToPortal() {
  if (finished) return;
  finished = true;
  window.location.replace(portalUrl.href);
}

function showTool() {
  if (finished) return;
  finished = true;
  document.documentElement.classList.remove("tool-auth-pending");
}

async function verifyAccess() {
  const firebase = await initializeFirebaseServices();

  if (!firebase.configured) {
    redirectToPortal();
    return;
  }

  let unsubscribe = () => {};
  const timeoutId = window.setTimeout(redirectToPortal, 10000);

  unsubscribe = onAuthStateChangedSafe(async (user) => {
    window.clearTimeout(timeoutId);
    unsubscribe();

    if (!user) {
      redirectToPortal();
      return;
    }

    try {
      const access = await getPortalAccess(user, firebase.firestoreModule);

      if (!access.authorized) {
        await signOutCurrentUser(firebase.authModule);
        redirectToPortal();
        return;
      }

      showTool();
    } catch {
      redirectToPortal();
    }
  }, firebase.authModule);
}

verifyAccess().catch(redirectToPortal);
