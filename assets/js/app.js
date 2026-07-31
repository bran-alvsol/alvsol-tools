import {
  createManagedUser,
  getPortalAccess,
  initializeFirebaseServices,
  listManagedUsers,
  onAuthStateChangedSafe,
  readTestRecords,
  saveTestRecord,
  signIn,
  signOutCurrentUser
} from "./firebase-service.js";

const tools = [
  {
    name: "HERRAMIENTA COMPRAS",
    description: "Compras, transferencias y catálogo BOX. Versión 5.21.",
    status: "Abrir",
    url: "./tools/herramienta-compras/",
    migrated: true
  },
  {
    name: "Herramienta demo",
    description: "Ejemplo independiente para validar la estructura tools/ sin tocar herramientas reales.",
    status: "Lista",
    url: "./tools/demo-tool/",
    migrated: false
  }
];

const elements = {
  adminMessage: document.querySelector("#admin-message"),
  adminSection: document.querySelector("#admin-section"),
  authMessage: document.querySelector("#auth-message"),
  createUserButton: document.querySelector("#create-user-button"),
  createUserForm: document.querySelector("#create-user-form"),
  currentUsername: document.querySelector("#current-username"),
  dashboardView: document.querySelector("#dashboard-view"),
  firebaseState: document.querySelector("#firebase-state"),
  firestoreOutput: document.querySelector("#firestore-output"),
  loginButton: document.querySelector("#login-button"),
  loginForm: document.querySelector("#login-form"),
  loginView: document.querySelector("#login-view"),
  logoutButton: document.querySelector("#logout-button"),
  managedUsersList: document.querySelector("#managed-users-list"),
  migratedCount: document.querySelector("#migrated-count"),
  newPassword: document.querySelector("#new-password"),
  newUsername: document.querySelector("#new-username"),
  password: document.querySelector("#password"),
  readTestButton: document.querySelector("#read-test-button"),
  saveTestButton: document.querySelector("#save-test-button"),
  sessionActions: document.querySelector(".session-actions"),
  toolCount: document.querySelector("#tool-count"),
  toolsGrid: document.querySelector("#tools-grid"),
  username: document.querySelector("#username")
};

let firebaseModules = null;

renderTools();
boot();

async function boot() {
  setBusy(true);

  try {
    const firebaseState = await initializeFirebaseServices();

    if (!firebaseState.configured) {
      setFirebaseUnavailable(firebaseState.message);
      setBusy(false);
      return;
    }

    firebaseModules = firebaseState;
    elements.firebaseState.textContent = "Conectado";
    elements.firebaseState.classList.remove("neutral");
    elements.firebaseState.classList.add("ready");

    bindEvents();
    onAuthStateChangedSafe(handleAuthChange, firebaseModules.authModule);
  } catch (error) {
    setFirebaseUnavailable(error.message);
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAuthAction(() =>
      signIn(elements.username.value, elements.password.value, firebaseModules.authModule)
    );
  });

  elements.createUserForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction(async () => {
      const account = await createManagedUser(
        elements.newUsername.value,
        elements.newPassword.value,
        firebaseModules.authModule,
        firebaseModules.firestoreModule
      );

      elements.createUserForm.reset();
      setAdminMessage(`Usuario ${account.username} creado correctamente.`, "ok");
      await loadManagedUsers();
    });
  });

  elements.logoutButton.addEventListener("click", async () => {
    await signOutCurrentUser(firebaseModules.authModule);
  });

  elements.saveTestButton.addEventListener("click", async () => {
    await runFirestoreAction(async () => {
      const id = await saveTestRecord(firebaseModules.firestoreModule);
      elements.firestoreOutput.textContent = `Documento guardado:\n${id}`;
    });
  });

  elements.readTestButton.addEventListener("click", async () => {
    await runFirestoreAction(async () => {
      const records = await readTestRecords(firebaseModules.firestoreModule);
      elements.firestoreOutput.textContent = JSON.stringify(records, normalizeFirestoreValue, 2);
    });
  });
}

async function handleAuthChange(user) {
  if (!user) {
    showLoggedOutState();
    return;
  }

  setBusy(true);

  try {
    const access = await getPortalAccess(user, firebaseModules.firestoreModule);

    if (!access.authorized) {
      await signOutCurrentUser(firebaseModules.authModule);
      setAuthMessage("Tu cuenta no está autorizada para entrar al portal.", "error");
      return;
    }

    elements.loginView.hidden = true;
    elements.dashboardView.hidden = false;
    elements.sessionActions.dataset.authenticated = "true";
    elements.currentUsername.textContent = access.username;
    elements.adminSection.hidden = access.role !== "admin";
    setAuthMessage("");

    if (access.role === "admin") {
      await loadManagedUsers();
    }
  } catch (error) {
    await signOutCurrentUser(firebaseModules.authModule).catch(() => {});
    setAuthMessage(getFriendlyFirebaseError(error), "error");
  } finally {
    setBusy(false);
  }
}

function showLoggedOutState() {
  elements.loginView.hidden = false;
  elements.dashboardView.hidden = true;
  elements.adminSection.hidden = true;
  elements.sessionActions.dataset.authenticated = "false";
  elements.currentUsername.textContent = "";
  elements.managedUsersList.replaceChildren();
}

async function runAuthAction(action) {
  setBusy(true);
  setAuthMessage("Procesando...");

  try {
    await action();
  } catch (error) {
    setAuthMessage(getFriendlyFirebaseError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function runFirestoreAction(action) {
  setFirestoreBusy(true);

  try {
    await action();
  } catch (error) {
    elements.firestoreOutput.textContent = getFriendlyFirebaseError(error);
  } finally {
    setFirestoreBusy(false);
  }
}

async function runAdminAction(action) {
  setAdminBusy(true);
  setAdminMessage("Procesando...");

  try {
    await action();
  } catch (error) {
    setAdminMessage(getFriendlyFirebaseError(error), "error");
  } finally {
    setAdminBusy(false);
  }
}

async function loadManagedUsers() {
  try {
    const users = await listManagedUsers(firebaseModules.firestoreModule);
    renderManagedUsers(users);
  } catch (error) {
    setAdminMessage(getFriendlyFirebaseError(error), "error");
  }
}

function renderManagedUsers(users) {
  const accounts = [
    { active: true, role: "admin", username: "admin" },
    ...users
  ];

  const items = accounts.map((account) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const detail = document.createElement("small");

    name.textContent = account.username;
    detail.textContent = account.role === "admin" ? "Administrador" : account.active ? "Activo" : "Inactivo";
    item.append(name, detail);
    return item;
  });

  elements.managedUsersList.replaceChildren(...items);
}

function renderTools() {
  elements.toolCount.textContent = String(tools.length);
  elements.migratedCount.textContent = String(tools.filter((tool) => tool.migrated).length);
  elements.toolsGrid.innerHTML = tools
    .map(
      (tool) => `
        <a class="tool-card" href="${tool.url}">
          <strong>${tool.name}</strong>
          <p>${tool.description}</p>
          <span>${tool.status} &rarr;</span>
        </a>
      `
    )
    .join("");
}

function setFirebaseUnavailable(message) {
  elements.firebaseState.textContent = "Sin configurar";
  elements.firestoreOutput.textContent = message;
  setAuthMessage(message, "error");
  setBusy(false);
  elements.loginButton.disabled = true;
  elements.createUserButton.disabled = true;
}

function setBusy(isBusy) {
  elements.loginButton.disabled = isBusy || !firebaseModules;
}

function setAdminBusy(isBusy) {
  elements.createUserButton.disabled = isBusy;
  elements.newUsername.disabled = isBusy;
  elements.newPassword.disabled = isBusy;
}

function setFirestoreBusy(isBusy) {
  elements.saveTestButton.disabled = isBusy;
  elements.readTestButton.disabled = isBusy;
}

function setAuthMessage(message, tone = "") {
  elements.authMessage.textContent = message;
  elements.authMessage.className = `status-message ${tone}`.trim();
}

function setAdminMessage(message, tone = "") {
  elements.adminMessage.textContent = message;
  elements.adminMessage.className = `status-message ${tone}`.trim();
}

function normalizeFirestoreValue(_key, value) {
  if (value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  return value;
}

function getFriendlyFirebaseError(error) {
  const code = error?.code ?? "";

  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return "Usuario o contraseña incorrectos.";
  }

  if (code.includes("auth/user-not-found")) {
    return "Usuario o contraseña incorrectos.";
  }

  if (code.includes("auth/email-already-in-use")) {
    return "Ese usuario ya existe.";
  }

  if (code.includes("auth/invalid-email")) {
    return "El nombre de usuario no es válido.";
  }

  if (code.includes("auth/invalid-api-key")) {
    return "La conexión con Firebase necesita actualizarse. Revisa la configuración del proyecto.";
  }

  if (code.includes("auth/weak-password")) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }

  if (code.includes("failed-precondition")) {
    return "Firestore necesita un índice para esta consulta. Revisa el enlace que Firebase muestra en consola o ajusta las reglas.";
  }

  if (code.includes("permission-denied")) {
    return "No tienes permiso para realizar esta acción. Revisa las reglas de Firestore.";
  }

  return error?.message ?? "Ocurrió un error inesperado.";
}
