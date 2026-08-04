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
  ensurePortalLink();
  document.documentElement.classList.remove("tool-auth-pending");
}

function ensurePortalLink() {
  const existingLink = document.querySelector(
    '[data-alvsol-portal-link], a[href="../../"], a[href="../../index.html"]'
  );

  if (existingLink) {
    existingLink.setAttribute("data-alvsol-portal-link", "");
    return;
  }

  const link = document.createElement("a");
  link.href = portalUrl.href;
  link.textContent = "Volver al portal";
  link.setAttribute("data-alvsol-portal-link", "");
  link.setAttribute("aria-label", "Volver a ALVSOL Tools");
  Object.assign(link.style, {
    position: "fixed",
    bottom: "12px",
    right: "12px",
    zIndex: "2147483647",
    padding: "9px 12px",
    border: "1px solid #cfd7db",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#1c2328",
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.14)",
    font: "700 12px Arial, sans-serif",
    letterSpacing: "0",
    textDecoration: "none"
  });
  document.body.appendChild(link);
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

if (window.alvsolDesktop?.isDesktop) {
  showTool();
} else {
  verifyAccess().catch(redirectToPortal);
}
