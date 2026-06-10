// SVG icon strings used for icon-only buttons.
const ICON_STOP = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><rect width="10" height="10" rx="1.5"/></svg>`;
const ICON_PLAY = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const ICON_RESTART = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>`;
const ICON_CHECK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

const linkForm = document.getElementById("linkForm");
const dirPathInput = document.getElementById("dirPathInput");
const directoryList = document.getElementById("directoryList");
const stackContainer = document.getElementById("stackContainer");
const actionOutput = document.getElementById("actionOutput");
const updateAllBtn = document.getElementById("updateAllBtn");
const refreshBtn = document.getElementById("refreshBtn");
const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");
const dockerLoginBtn = document.getElementById("dockerLoginBtn");
const dockerLogoutBtn = document.getElementById("dockerLogoutBtn");
const appSessionInfo = document.getElementById("appSessionInfo");
const appLogoutBtn = document.getElementById("appLogoutBtn");
const dockerAuthInfo = document.getElementById("dockerAuthInfo");
const clearOutputBtn = document.getElementById("clearOutputBtn");
const serviceTemplate = document.getElementById("serviceTemplate");
const tabDirectoriesBtn = document.getElementById("tabDirectories");
const tabEntriesBtn = document.getElementById("tabEntries");
const tabPortsBtn = document.getElementById("tabPorts");
const tabSystemdBtn = document.getElementById("tabSystemd");
const tabPanelDirectories = document.getElementById("tabPanelDirectories");
const tabPanelEntries = document.getElementById("tabPanelEntries");
const tabPanelPorts = document.getElementById("tabPanelPorts");
const tabPanelSystemd = document.getElementById("tabPanelSystemd");
const entriesSearchInput = document.getElementById("entriesSearchInput");
const importEntriesBtn = document.getElementById("importEntriesBtn");
const autoUpdateAllToggle = document.getElementById("autoUpdateAllToggle");
const entriesCount = document.getElementById("entriesCount");
const portsSearchInput = document.getElementById("portsSearchInput");
const portsCount = document.getElementById("portsCount");
const portsContainer = document.getElementById("portsContainer");
const systemdSearchInput = document.getElementById("systemdSearchInput");
const systemdCount = document.getElementById("systemdCount");
const systemdContainer = document.getElementById("systemdContainer");
const jobProgress = document.getElementById("jobProgress");
const loginModal = document.getElementById("loginModal");
const loginModalBackdrop = document.getElementById("loginModalBackdrop");
const loginModalCloseBtn = document.getElementById("loginModalCloseBtn");
const loginModalStatusIcon = document.getElementById("loginModalStatusIcon");
const loginModalStatusText = document.getElementById("loginModalStatusText");
const loginModalHint = document.getElementById("loginModalHint");
const loginDeviceCode = document.getElementById("loginDeviceCode");
const loginActivationUrl = document.getElementById("loginActivationUrl");
const loginModalLog = document.getElementById("loginModalLog");
const copyDeviceCodeBtn = document.getElementById("copyDeviceCodeBtn");
const authGate = document.getElementById("authGate");
const authForm = document.getElementById("authForm");
const authPasswordInput = document.getElementById("authPasswordInput");
const authRememberInput = document.getElementById("authRememberInput");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authMessage = document.getElementById("authMessage");
const scanBtn = document.getElementById("scanBtn");
const importComposeForm = document.getElementById("importComposeForm");
const importComposeModal = document.getElementById("importComposeModal");
const importComposeModalBackdrop = document.getElementById("importComposeModalBackdrop");
const importComposeModalCloseBtn = document.getElementById("importComposeModalCloseBtn");
const sourceComposeFileInput = document.getElementById("sourceComposeFileInput");
const sourceComposePathInput = document.getElementById("sourceComposePathInput");
const sourceComposeFileHint = document.getElementById("sourceComposeFileHint");
const targetComposeDirInput = document.getElementById("targetComposeDirInput");
const importTargetDirOptions = document.getElementById("importTargetDirOptions");
const importModeSelect = document.getElementById("importModeSelect");
const importOverwriteInput = document.getElementById("importOverwriteInput");
const importLinkInput = document.getElementById("importLinkInput");
const composeServiceForm = document.getElementById("composeServiceForm");
const composeServiceModal = document.getElementById("composeServiceModal");
const composeServiceModalBackdrop = document.getElementById("composeServiceModalBackdrop");
const composeServiceModalCloseBtn = document.getElementById("composeServiceModalCloseBtn");
const composeEditorStackSelect = document.getElementById("composeEditorStackSelect");
const composeServiceYamlInput = document.getElementById("composeServiceYamlInput");
const composeServiceOverwriteInput = document.getElementById("composeServiceOverwriteInput");

const STORAGE_TAB_KEY = "quarterdeck.activeTab";
const STORAGE_SEARCH_KEY = "quarterdeck.entriesSearch";
const STORAGE_PORT_SEARCH_KEY = "quarterdeck.portsSearch";
const STORAGE_SYSTEMD_SEARCH_KEY = "quarterdeck.systemdSearch";
const STORAGE_REMEMBER_ME_KEY = "quarterdeck.rememberMe";
const STORAGE_AUTO_UPDATE_ALL_KEY = "quarterdeck.autoUpdateAll";
const STORAGE_AUTO_UPDATE_STACKS_KEY = "quarterdeck.autoUpdateStacks";
const AUTO_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

let linkedStacks = [];
let entriesSearch = "";
let portsSearch = "";
let systemdSearch = "";
let systemdServices = {
  system: [],
  user: [],
  errors: {
    system: null,
    user: null
  }
};
let autoRefreshHandle = null;
let isBusy = false;
let systemdEnabled = true;
let loginAutoCloseHandle = null;
let activeLoginJobId = null;
let appAuthEnabled = false;
let appAuthenticated = false;
let appBootstrapped = false;
let authRetryInterval = null;
let authRetryUntilMs = 0;
let autoUpdateAllEnabled = false;
let autoUpdateByStackId = {};
let autoUpdateCycleHandle = null;
let autoUpdateCycleRunning = false;
const openStackIds = new Set();
const openServiceKeys = new Set();
const stackProgress = new Map();
const serviceProgress = new Map();
let stackLoadRunId = 0;
let selectedImportFileName = "";
let selectedImportFileContent = "";

initializeApp();

async function initializeApp() {
  authForm.addEventListener("submit", onAppLogin);
  appLogoutBtn.addEventListener("click", onAppLogout);
  authRememberInput.checked = localStorage.getItem(STORAGE_REMEMBER_ME_KEY) === "1";
  await loadSessionStatus();
}

function bootstrap() {
  if (appBootstrapped) {
    startAutoRefresh();
    return;
  }
  appBootstrapped = true;

  linkForm.addEventListener("submit", onAddDirectory);
  importComposeForm.addEventListener("submit", onImportCompose);
  importEntriesBtn.addEventListener("click", openImportComposeModal);
  sourceComposeFileInput.addEventListener("change", onImportFileSelected);
  composeServiceForm.addEventListener("submit", onAddComposeServices);
  importComposeModalCloseBtn.addEventListener("click", closeImportComposeModal);
  importComposeModalBackdrop.addEventListener("click", closeImportComposeModal);
  composeServiceModalCloseBtn.addEventListener("click", closeComposeServiceModal);
  composeServiceModalBackdrop.addEventListener("click", closeComposeServiceModal);
  scanBtn.addEventListener("click", onScanDirectory);
  updateAllBtn.addEventListener("click", onUpdateAll);
  refreshBtn.addEventListener("click", () => loadStacksProgressive({ mode: "manual-refresh" }));
  checkUpdatesBtn.addEventListener("click", onCheckUpdates);
  dockerLoginBtn.addEventListener("click", onDockerLogin);
  dockerLogoutBtn.addEventListener("click", onDockerLogout);
  tabDirectoriesBtn.addEventListener("click", () => setActiveTab("directories"));
  tabEntriesBtn.addEventListener("click", () => setActiveTab("entries"));
  tabPortsBtn.addEventListener("click", () => setActiveTab("ports"));
  tabSystemdBtn.addEventListener("click", () => setActiveTab("systemd"));
  entriesSearchInput.addEventListener("input", onEntriesSearch);
  portsSearchInput.addEventListener("input", onPortsSearch);
  systemdSearchInput.addEventListener("input", onSystemdSearch);
  clearOutputBtn.addEventListener("click", () => {
    actionOutput.textContent = "Ready.";
  });
  loginModalCloseBtn.addEventListener("click", closeLoginModal);
  loginModalBackdrop.addEventListener("click", closeLoginModal);
  copyDeviceCodeBtn.addEventListener("click", copyDeviceCodeToClipboard);

  entriesSearch = localStorage.getItem(STORAGE_SEARCH_KEY) || "";
  entriesSearchInput.value = entriesSearch;
  autoUpdateAllEnabled = localStorage.getItem(STORAGE_AUTO_UPDATE_ALL_KEY) === "1";
  autoUpdateAllToggle.checked = autoUpdateAllEnabled;
  autoUpdateByStackId = parseAutoUpdateMap(localStorage.getItem(STORAGE_AUTO_UPDATE_STACKS_KEY));
  portsSearch = localStorage.getItem(STORAGE_PORT_SEARCH_KEY) || "";
  portsSearchInput.value = portsSearch;
  systemdSearch = localStorage.getItem(STORAGE_SYSTEMD_SEARCH_KEY) || "";
  systemdSearchInput.value = systemdSearch;

  const initialTab = localStorage.getItem(STORAGE_TAB_KEY) || "directories";
  setActiveTab(initialTab);
  autoUpdateAllToggle.addEventListener("change", onAutoUpdateAllToggleChanged);

  // Render entries quickly on startup, then hydrate full version data.
  loadStacksProgressive({ fast: true, mode: "launch" }).then(() =>
    loadStacksProgressive({ mode: "launch-hydrate" })
  );
  if (systemdEnabled) loadSystemd();
  loadAuthStatus();

  startAutoRefresh();
  startAutoUpdateCycle();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || isBusy || !appAuthenticated) {
      return;
    }
    loadStacksProgressive({ mode: "visibility-refresh" });
    if (systemdEnabled) loadSystemd();
    loadAuthStatus();
  });
}

function startAutoRefresh() {
  if (autoRefreshHandle || !appAuthenticated) {
    return;
  }

  autoRefreshHandle = setInterval(() => {
    if (isBusy || !appAuthenticated) {
      return;
    }

    if (hasActiveTextSelection()) {
      return;
    }

    loadStacksProgressive({ mode: "auto-refresh" });
    if (systemdEnabled) loadSystemd();
    loadAuthStatus();
  }, 12000);
}

function stopAutoRefresh() {
  if (autoRefreshHandle) {
    clearInterval(autoRefreshHandle);
    autoRefreshHandle = null;
  }
}

function startAutoUpdateCycle() {
  if (autoUpdateCycleHandle) {
    return;
  }

  autoUpdateCycleHandle = setInterval(() => {
    runAutoUpdateCycle().catch((error) => {
      logOutput(`ERROR auto update cycle: ${error.message}`);
    });
  }, AUTO_UPDATE_INTERVAL_MS);
}

function parseAutoUpdateMap(raw) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function isStackAutoUpdateEnabled(stackId) {
  return autoUpdateAllEnabled || Boolean(autoUpdateByStackId[stackId]);
}

function persistAutoUpdateSettings() {
  localStorage.setItem(STORAGE_AUTO_UPDATE_ALL_KEY, autoUpdateAllEnabled ? "1" : "0");
  localStorage.setItem(STORAGE_AUTO_UPDATE_STACKS_KEY, JSON.stringify(autoUpdateByStackId));
}

function onAutoUpdateAllToggleChanged(event) {
  autoUpdateAllEnabled = Boolean(event.target.checked);
  persistAutoUpdateSettings();
  renderStacks();
  if (autoUpdateAllEnabled) {
    runAutoUpdateCycle().catch((error) => {
      logOutput(`ERROR auto update cycle: ${error.message}`);
    });
  }
}

function onStackAutoUpdateToggleChanged(stackId, enabled) {
  autoUpdateByStackId[stackId] = Boolean(enabled);
  persistAutoUpdateSettings();
}

async function runAutoUpdateCycle() {
  if (!appAuthenticated || autoUpdateCycleRunning || isBusy) {
    return;
  }

  const enabledStacks = linkedStacks.filter((stack) => isStackAutoUpdateEnabled(stack.id));
  if (!enabledStacks.length) {
    return;
  }

  autoUpdateCycleRunning = true;
  try {
    logOutput(`Auto update cycle started for ${enabledStacks.length} stack(s).`);
    for (const stack of enabledStacks) {
      if (!stack.available) {
        logOutput(`Auto update skipped ${stack.directoryName}: compose unavailable.`);
        continue;
      }
      const id = encodeURIComponent(stack.id);
      await runUpdateJob(`/api/update/link/${id}`, `Auto update: ${stack.directoryName}`);
    }

    await loadStacksProgressive({ mode: "manual-refresh" });
    logOutput("Auto update cycle completed.");
  } catch (error) {
    logOutput(`ERROR auto update cycle: ${error.message}`);
  } finally {
    autoUpdateCycleRunning = false;
  }
}

function setAuthenticated(authenticated, enabled) {
  appAuthEnabled = Boolean(enabled);
  appAuthenticated = Boolean(authenticated) || !appAuthEnabled;

  const locked = appAuthEnabled && !appAuthenticated;
  authGate.classList.toggle("hidden", !locked);
  authGate.setAttribute("aria-hidden", locked ? "false" : "true");
  document.body.classList.toggle("auth-locked", locked);

  if (appAuthEnabled) {
    appSessionInfo.textContent = appAuthenticated ? "App: signed in" : "App: locked";
    appLogoutBtn.style.display = appAuthenticated ? "inline-block" : "none";
  } else {
    appSessionInfo.textContent = "";
    appLogoutBtn.style.display = "none";
  }

  if (locked) {
    stopAutoRefresh();
    authPasswordInput.value = "";
    if (!authMessage.textContent) {
      authMessage.textContent = "";
    }
    setTimeout(() => authPasswordInput.focus(), 0);
    return;
  }

  if (appBootstrapped) {
    startAutoRefresh();
  }
}

async function loadSessionStatus() {
  try {
    const response = await fetch("/api/session/status");
    const payload = await parseJsonResponse(response, "session status", { allowUnauthorized: true });
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load session status");
    }

    setAuthenticated(payload.authenticated, payload.enabled);
    systemdEnabled = payload.systemdEnabled !== false;
    applySystemdVisibility();
    if (appAuthenticated) {
      bootstrap();
    }
  } catch (error) {
    authMessage.textContent = error.message;
    setAuthenticated(false, true);
  }
}

async function onAppLogin(event) {
  event.preventDefault();
  if (Date.now() < authRetryUntilMs) {
    startAuthRetryCountdown(Math.ceil((authRetryUntilMs - Date.now()) / 1000));
    return;
  }

  const password = String(authPasswordInput.value || "");
  if (!password) {
    authMessage.textContent = "Password is required.";
    return;
  }

  authSubmitBtn.disabled = true;
  authMessage.textContent = "Signing in...";

  try {
    const response = await fetch("/api/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, remember: authRememberInput.checked })
    });
    const payload = await parseJsonResponse(response, "session login", { allowUnauthorized: true });
    if (!response.ok) {
      if (response.status === 429) {
        const retryFromBody = Number(payload?.retryAfterSeconds || 0);
        const retryFromHeader = Number(response.headers.get("Retry-After") || 0);
        const retrySeconds = Math.max(1, retryFromBody || retryFromHeader || 1);
        startAuthRetryCountdown(retrySeconds);
        setAuthenticated(false, true);
        return;
      }
      throw new Error(payload.error || "Sign in failed");
    }

    clearAuthRetryCountdown();
    localStorage.setItem(STORAGE_REMEMBER_ME_KEY, authRememberInput.checked ? "1" : "0");
    authMessage.textContent = "";
    authPasswordInput.value = "";
    setAuthenticated(true, payload.enabled !== false);
    bootstrap();
    await loadStacksProgressive({ mode: "manual-refresh" });
    if (systemdEnabled) await loadSystemd();
    await loadAuthStatus();
  } catch (error) {
    authMessage.textContent = error.message;
    setAuthenticated(false, true);
  } finally {
    if (Date.now() >= authRetryUntilMs) {
      authSubmitBtn.disabled = false;
      authPasswordInput.disabled = false;
    }
  }
}

async function onAppLogout() {
  try {
    await fetch("/api/session/logout", { method: "POST" });
  } catch {
    // Best-effort logout.
  }
  authMessage.textContent = "Signed out.";
  setAuthenticated(false, appAuthEnabled);
}

function applySystemdVisibility() {
  tabSystemdBtn.hidden = !systemdEnabled;
  if (!systemdEnabled && localStorage.getItem(STORAGE_TAB_KEY) === "systemd") {
    localStorage.removeItem(STORAGE_TAB_KEY);
  }
}

function setActiveTab(tabName) {
  if (tabName === "systemd" && !systemdEnabled) {
    tabName = "directories";
  }
  const isDirectories = tabName === "directories";
  const isEntries = tabName === "entries";
  const isPorts = tabName === "ports";
  const isSystemd = tabName === "systemd";

  tabDirectoriesBtn.classList.toggle("active", isDirectories);
  tabEntriesBtn.classList.toggle("active", isEntries);
  tabPortsBtn.classList.toggle("active", isPorts);
  tabSystemdBtn.classList.toggle("active", isSystemd);

  tabPanelDirectories.classList.toggle("active", isDirectories);
  tabPanelEntries.classList.toggle("active", isEntries);
  tabPanelPorts.classList.toggle("active", isPorts);
  tabPanelSystemd.classList.toggle("active", isSystemd);

  localStorage.setItem(STORAGE_TAB_KEY, tabName);
}

function onEntriesSearch(event) {
  entriesSearch = String(event.target.value || "").trim().toLowerCase();
  localStorage.setItem(STORAGE_SEARCH_KEY, entriesSearch);
  renderStacks();
}

function onPortsSearch(event) {
  portsSearch = String(event.target.value || "").trim().toLowerCase();
  localStorage.setItem(STORAGE_PORT_SEARCH_KEY, portsSearch);
  renderPorts();
}

function onSystemdSearch(event) {
  systemdSearch = String(event.target.value || "").trim().toLowerCase();
  localStorage.setItem(STORAGE_SYSTEMD_SEARCH_KEY, systemdSearch);
  renderSystemd();
}

async function loadStacksProgressive(options = {}) {
  const forceLatest = Boolean(options.forceLatest);
  const fast = Boolean(options.fast);
  const mode = String(options.mode || "refresh");
  const runId = ++stackLoadRunId;

  try {
    const indexResponse = await fetch("/api/links/index");
    const indexPayload = await parseJsonResponse(indexResponse, "links index");
    if (!indexResponse.ok) {
      throw new Error(indexPayload.error || "Failed to load directory index");
    }

    if (runId !== stackLoadRunId) {
      return;
    }

    const indexed = Array.isArray(indexPayload) ? indexPayload : [];
    const existing = new Map(linkedStacks.map((stack) => [stack.id, stack]));
    linkedStacks = indexed.map((entry) => {
      const prev = existing.get(entry.id);
      if (prev) {
        return prev;
      }

      return {
        id: entry.id,
        createdAt: entry.createdAt,
        dirPath: entry.dirPath,
        directoryName: entry.directoryName,
        available: false,
        composePath: entry.dirPath,
        services: [],
        updateCount: 0
      };
    });

    renderSidebar();
    renderComposeEditorStackOptions();
    renderImportTargetDirectoryOptions();
    renderStacks();
    renderPorts();

    if (!indexed.length) {
      return;
    }

    // Fast mode: all requests are runtime-only (no registry), fire in parallel for speed
    // Silent modes (auto/visibility refresh) don't show per-stack progress — they should be invisible.
    const silentMode = mode === "auto-refresh" || mode === "visibility-refresh";
    if (fast) {
      if (!silentMode) {
        for (const entry of indexed) {
          setStackProgress(entry.id, {
            active: true,
            label: progressLabelForMode(mode, entry.directoryName),
            percent: 35
          });
        }
      }

      await Promise.allSettled(
        indexed.map(async (entry) => {
          try {
            const response = await fetch(`/api/links/${encodeURIComponent(entry.id)}?fast=1`);
            const payload = await parseJsonResponse(response, `stack ${entry.directoryName}`);
            if (runId !== stackLoadRunId) return;
            if (response.ok) {
              linkedStacks = linkedStacks.map((stack) => (stack.id === entry.id ? payload : stack));
            }
          } catch (error) {
            logOutput(`ERROR loading ${entry.directoryName}: ${error.message}`);
          } finally {
            clearStackProgress(entry.id);
          }
        })
      );

      if (runId !== stackLoadRunId) return;
      renderSidebar();
      renderComposeEditorStackOptions();
      renderImportTargetDirectoryOptions();
      renderStacks();
      renderPorts();
      return;
    }

    // Sequential load for non-fast modes — each stack waits for the previous so
    // per-stack progress is meaningful and backend registry queue isn't flooded.
    for (const entry of indexed) {
      if (runId !== stackLoadRunId) {
        return;
      }

      if (!silentMode) {
        setStackProgress(entry.id, {
          active: true,
          label: progressLabelForMode(mode, entry.directoryName),
          percent: 35
        });
      }

      try {
        const params = new URLSearchParams();
        if (forceLatest) {
          params.set("forceLatest", "1");
        }
        const response = await fetch(`/api/links/${encodeURIComponent(entry.id)}?${params.toString()}`);
        const payload = await parseJsonResponse(response, `stack ${entry.directoryName}`);

        if (runId !== stackLoadRunId) {
          return;
        }

        if (response.ok) {
          linkedStacks = linkedStacks.map((stack) => (stack.id === entry.id ? payload : stack));
        } else {
          throw new Error(payload.error || "Failed to hydrate stack");
        }
      } catch (error) {
        logOutput(`ERROR loading ${entry.directoryName}: ${error.message}`);
      }

      if (!silentMode) {
        setStackProgress(entry.id, {
          active: true,
          label: `${progressLabelForMode(mode, entry.directoryName)} done`,
          percent: 100
        });
      }

      renderSidebar();
      renderComposeEditorStackOptions();
      renderImportTargetDirectoryOptions();
      renderStacks();
      renderPorts();

      clearStackProgress(entry.id);
    }
  } catch (error) {
    logOutput(`ERROR loading stacks: ${error.message}`);
  }
}

function progressLabelForMode(mode, name) {
  const action =
    mode === "check"
      ? "Checking updates"
      : mode === "launch"
        ? "Loading"
        : mode === "launch-hydrate"
          ? "Hydrating"
          : mode === "auto-refresh"
            ? "Auto refresh"
            : mode === "visibility-refresh"
              ? "Refresh"
              : "Refreshing";

    return `${action}: ${name}`;
}

function renderComposeEditorStackOptions() {
  if (!composeEditorStackSelect) {
    return;
  }

  const currentValue = composeEditorStackSelect.value;
  composeEditorStackSelect.innerHTML = "";

  if (!linkedStacks.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No linked stacks";
    composeEditorStackSelect.appendChild(option);
    return;
  }

  for (const stack of linkedStacks) {
    const option = document.createElement("option");
    option.value = stack.id;
    option.textContent = `${stack.directoryName} (${stack.dirPath})`;
    composeEditorStackSelect.appendChild(option);
  }

  if (currentValue && linkedStacks.some((stack) => stack.id === currentValue)) {
    composeEditorStackSelect.value = currentValue;
  }
}

function renderImportTargetDirectoryOptions() {
  if (!importTargetDirOptions) {
    return;
  }

  importTargetDirOptions.innerHTML = "";
  const seen = new Set();

  for (const stack of linkedStacks) {
    const dir = String(stack?.dirPath || "").trim();
    if (!dir || seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    const option = document.createElement("option");
    option.value = dir;
    importTargetDirOptions.appendChild(option);
  }
}

function setStackProgress(id, progress) {
  if (!id) {
    return;
  }
  stackProgress.set(id, progress);
  renderStacks();
}

function clearStackProgress(id) {
  if (!id) {
    return;
  }
  if (stackProgress.delete(id)) {
    renderStacks();
  }
}

function setServiceProgress(stackId, serviceName, progress) {
  serviceProgress.set(`${stackId}::${serviceName}`, progress);
  renderStacks();
}

function clearServiceProgress(stackId, serviceName) {
  if (serviceProgress.delete(`${stackId}::${serviceName}`)) {
    renderStacks();
  }
}

async function loadSystemd() {
  try {
    const response = await fetch("/api/systemd/services");
    const payload = await parseJsonResponse(response, "systemd services");
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load systemd services");
    }

    systemdServices = {
      system: Array.isArray(payload.system) ? payload.system : [],
      user: Array.isArray(payload.user) ? payload.user : [],
      errors: {
        system: payload?.errors?.system || null,
        user: payload?.errors?.user || null
      }
    };
    renderSystemd();
  } catch (error) {
    systemdServices = {
      system: [],
      user: [],
      errors: {
        system: error.message,
        user: error.message
      }
    };
    renderSystemd();
    logOutput(`ERROR loading systemd services: ${error.message}`);
  }
}

async function parseJsonResponse(response, label, options = {}) {
  const raw = await response.text();
  if (response.status === 401 && !options.allowUnauthorized) {
    setAuthenticated(false, true);
    throw new Error("Authentication required");
  }

  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const preview = raw.replace(/\s+/g, " ").slice(0, 80);
    throw new Error(`Invalid ${label} response (${response.status}): ${preview}`);
  }
}

function hasActiveTextSelection() {
  const sel = window.getSelection ? window.getSelection() : null;
  return Boolean(sel && String(sel).trim().length > 0);
}

function clearAuthRetryCountdown() {
  authRetryUntilMs = 0;
  if (authRetryInterval) {
    clearInterval(authRetryInterval);
    authRetryInterval = null;
  }
}

function startAuthRetryCountdown(retrySeconds) {
  const safeSeconds = Math.max(1, Number(retrySeconds) || 1);
  authRetryUntilMs = Date.now() + safeSeconds * 1000;
  authSubmitBtn.disabled = true;
  authPasswordInput.disabled = true;

  if (authRetryInterval) {
    clearInterval(authRetryInterval);
  }

  const tick = () => {
    const remaining = Math.ceil((authRetryUntilMs - Date.now()) / 1000);
    if (remaining <= 0) {
      clearAuthRetryCountdown();
      authSubmitBtn.disabled = false;
      authPasswordInput.disabled = false;
      authMessage.textContent = "Lockout ended. You can try again.";
      return;
    }

    authMessage.textContent = `Too many attempts. Try again in ${formatSeconds(remaining)}.`;
  };

  tick();
  authRetryInterval = setInterval(tick, 1000);
}

function formatSeconds(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes <= 0) {
    return `${rem}s`;
  }
  return `${minutes}m ${rem}s`;
}

async function onCheckUpdates() {
  setBusy(true);
  logOutput("Checking registries for latest digests...");

  try {
    // First pass: load cached state immediately so UI shows current known results.
    await loadStacksProgressive({ mode: "manual-refresh" });

    // Second pass: check each stack one at a time and update the UI as each resolves.
    // This gives live incremental feedback instead of one long wait.
    const stackIds = linkedStacks.map((s) => s.id).filter(Boolean);
    let checked = 0;
    for (const id of stackIds) {
      const stack = linkedStacks.find((s) => s.id === id);
      const name = stack?.directoryName || id;
      setJobProgress(`Checking ${name} (${checked + 1}/${stackIds.length})...`);
      setStackProgress(id, {
        active: true,
        label: `Checking updates: ${name}`,
        percent: 35
      });

      try {
        const response = await fetch(`/api/links/${encodeURIComponent(id)}?forceLatest=1`);
        const payload = await parseJsonResponse(response, `stack ${name}`);
        if (response.ok) {
          // Merge updated stack into state and re-render live.
          linkedStacks = linkedStacks.map((s) => (s.id === id ? payload : s));
          renderStacks();
          renderPorts();
        }
      } catch (err) {
        logOutput(`ERROR checking ${name}: ${err.message}`);
      }

      checked++;
      setStackProgress(id, {
        active: true,
        label: `Checked: ${name}`,
        percent: 100
      });
      clearStackProgress(id);
    }

    setJobProgress("");
    logOutput(`Check complete. Checked ${checked} stack(s).`);
  } catch (error) {
    logOutput(`ERROR checking updates: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function onDockerLogin() {
  setBusy(true);
  logOutput("Starting docker login. If a device code appears in output, complete it in your browser.");
  openLoginModal();
  activeLoginJobId = null;

  try {
    await runUpdateJob("/api/auth/docker/login", "Docker login", {
      onStarted: (jobId) => {
        activeLoginJobId = jobId;
      },
      onProgress: (payload) => updateLoginModalFromJob(payload),
      onComplete: () => {
        setLoginModalState("success", "Login successful", "You are authenticated. Closing popup...");
        activeLoginJobId = null;
        if (loginAutoCloseHandle) {
          clearTimeout(loginAutoCloseHandle);
        }
        loginAutoCloseHandle = setTimeout(() => {
          closeLoginModal();
        }, 1600);
      },
      onFailed: (payload) => {
        activeLoginJobId = null;
        setLoginModalState("error", "Login failed", payload?.error || "Please retry from terminal if needed.");
      }
    });
    await loadStacksProgressive({ forceLatest: true, mode: "manual-refresh" });
    await loadAuthStatus();
  } catch (error) {
    logOutput(`ERROR docker login: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function onDockerLogout() {
  setBusy(true);
  logOutput("Running docker logout docker.io...");

  try {
    await runUpdateJob("/api/auth/docker/logout", "Docker logout");
    await loadStacksProgressive({ mode: "manual-refresh" });
    await loadAuthStatus();
  } catch (error) {
    logOutput(`ERROR docker logout: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function loadAuthStatus() {
  if (!appAuthenticated) {
    return;
  }

  try {
    const response = await fetch("/api/auth/status");
    const payload = await parseJsonResponse(response, "docker auth status");
    if (!response.ok) {
      throw new Error(payload.error || payload.message || "Failed to load auth status");
    }

    const username = payload.username ? String(payload.username) : null;
    const loggedIn = Boolean(payload.loggedIn && username);

    if (loggedIn) {
      dockerAuthInfo.textContent = `Docker: ${username}`;
      dockerLoginBtn.style.display = "none";
      dockerLogoutBtn.style.display = "inline-block";
    } else {
      dockerAuthInfo.textContent = "Docker: not logged in";
      dockerLoginBtn.style.display = "inline-block";
      dockerLogoutBtn.style.display = "none";
    }
  } catch {
    dockerAuthInfo.textContent = "Docker auth status unavailable";
    dockerLoginBtn.style.display = "inline-block";
    dockerLogoutBtn.style.display = "inline-block";
  }
}

async function onScanDirectory() {
  const dirPath = dirPathInput.value.trim();
  if (!dirPath) {
    logOutput("Enter a directory path to scan.");
    return;
  }

  setBusy(true);
  logOutput(`Scanning ${dirPath} for compose files...`);
  try {
    const response = await fetch("/api/links/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dirPath })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Scan failed");
    }

    if (payload.added === 0) {
      logOutput(`Scan complete: no new compose directories found (${payload.skipped} already linked, ${payload.total} total found).`);
    } else {
      dirPathInput.value = "";
      logOutput(`Scan complete: added ${payload.added} director${payload.added === 1 ? "y" : "ies"}${payload.skipped ? `, skipped ${payload.skipped} already linked` : ""}.`);
      await loadStacksProgressive({ mode: "manual-refresh" });
    }
  } catch (error) {
    logOutput(`ERROR scanning directory: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function onAddDirectory(event) {
  event.preventDefault();
  const dirPath = dirPathInput.value.trim();
  if (!dirPath) {
    return;
  }

  setBusy(true);
  try {
    const response = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dirPath })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to link directory");
    }

    dirPathInput.value = "";
    logOutput(`Linked: ${payload.directoryName} (${payload.dirPath})`);
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR linking directory: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function onImportCompose(event) {
  event.preventDefault();
  const sourcePath = sourceComposePathInput.value.trim();
  const sourceContent = selectedImportFileContent;
  const sourceName = selectedImportFileName;
  const targetDir = targetComposeDirInput.value.trim();
  const mode = String(importModeSelect.value || "merge");
  const overwrite = Boolean(importOverwriteInput.checked);
  const linkAfterImport = Boolean(importLinkInput.checked);

  if ((!sourcePath && !sourceContent) || !targetDir) {
    logOutput("Provide a source compose file (browse or path) and target directory.");
    return;
  }

  setBusy(true);
  logOutput(`Importing compose from ${sourcePath} into ${targetDir} (${mode})...`);

  try {
    const response = await fetch("/api/compose/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath,
        sourceContent,
        sourceName,
        targetDir,
        mode,
        overwrite,
        linkAfterImport
      })
    });

    const payload = await parseJsonResponse(response, "compose import");
    if (!response.ok) {
      const conflictText = Array.isArray(payload.conflicts) && payload.conflicts.length
        ? ` Conflicts: ${payload.conflicts.join(", ")}`
        : "";
      throw new Error(`${payload.error || "Import failed"}${conflictText}`);
    }

    logOutput(
      `Import complete: ${payload.composePath}${payload.createdLink ? " (linked)" : ""}`
    );
    closeImportComposeModal();
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR importing compose: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function onImportFileSelected(event) {
  const file = event.target?.files?.[0];
  if (!file) {
    selectedImportFileName = "";
    selectedImportFileContent = "";
    sourceComposeFileHint.textContent = "Choose a local file above, or enter a server path.";
    return;
  }

  try {
    selectedImportFileName = file.name;
    selectedImportFileContent = await file.text();
    sourceComposeFileHint.textContent = `Selected local file: ${file.name}`;
  } catch (error) {
    selectedImportFileName = "";
    selectedImportFileContent = "";
    sourceComposeFileInput.value = "";
    sourceComposeFileHint.textContent = "Failed to read local file.";
    logOutput(`ERROR reading local compose file: ${error.message}`);
  }
}

async function onAddComposeServices(event) {
  event.preventDefault();
  const linkId = String(composeEditorStackSelect.value || "").trim();
  const yamlText = composeServiceYamlInput.value.trim();
  const overwrite = Boolean(composeServiceOverwriteInput.checked);

  if (!linkId) {
    logOutput("Select a linked stack first.");
    return;
  }
  if (!yamlText) {
    logOutput("Service YAML snippet is required.");
    return;
  }

  setBusy(true);
  logOutput("Applying service YAML snippet to compose file...");

  try {
    const response = await fetch(`/api/compose/services/${encodeURIComponent(linkId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yamlText, overwrite })
    });

    const payload = await parseJsonResponse(response, "compose service update");
    if (!response.ok) {
      const conflictText = Array.isArray(payload.conflicts) && payload.conflicts.length
        ? ` Conflicts: ${payload.conflicts.join(", ")}`
        : "";
      throw new Error(`${payload.error || "Failed to add services"}${conflictText}`);
    }

    logOutput(
      `Services updated: ${Array.isArray(payload.addedServices) ? payload.addedServices.join(", ") : "(none)"}`
    );
    closeComposeServiceModal();
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR updating compose services: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function removeComposeService(linkId, serviceName) {
  if (!confirm(`Remove service '${serviceName}' from this compose file?`)) {
    return;
  }

  setBusy(true);
  logOutput(`Removing service '${serviceName}' from compose file...`);

  try {
    const response = await fetch(
      `/api/compose/services/${encodeURIComponent(linkId)}/${encodeURIComponent(serviceName)}`,
      { method: "DELETE" }
    );
    const payload = await parseJsonResponse(response, "compose service removal");
    if (!response.ok) {
      throw new Error(payload.error || "Failed to remove service");
    }

    logOutput(`Removed service: ${payload.removedService || serviceName}`);
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR removing compose service: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function openImportComposeModal() {
  renderImportTargetDirectoryOptions();
  sourceComposeFileInput.value = "";
  selectedImportFileName = "";
  selectedImportFileContent = "";
  sourceComposeFileHint.textContent = "Choose a local file above, or enter a server path.";
  importComposeModal.classList.remove("hidden");
  importComposeModal.setAttribute("aria-hidden", "false");
}

function closeImportComposeModal() {
  sourceComposeFileInput.value = "";
  selectedImportFileName = "";
  selectedImportFileContent = "";
  sourceComposeFileHint.textContent = "Choose a local file above, or enter a server path.";
  importComposeModal.classList.add("hidden");
  importComposeModal.setAttribute("aria-hidden", "true");
}

function openComposeServiceModal(linkId) {
  renderComposeEditorStackOptions();
  if (linkId && linkedStacks.some((stack) => stack.id === linkId)) {
    composeEditorStackSelect.value = linkId;
  }
  composeServiceModal.classList.remove("hidden");
  composeServiceModal.setAttribute("aria-hidden", "false");
}

function closeComposeServiceModal() {
  composeServiceModal.classList.add("hidden");
  composeServiceModal.setAttribute("aria-hidden", "true");
}

async function onUpdateAll() {
  setBusy(true);
  logOutput("Running update for all linked compose directories...");

  try {
    await runUpdateJob("/api/update/all", "Update all stacks");
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR updating all: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function renderSidebar() {
  directoryList.innerHTML = "";

  if (!linkedStacks.length) {
    const li = document.createElement("li");
    li.className = "notice";
    li.textContent = "No linked directories yet.";
    directoryList.appendChild(li);
    return;
  }

  for (const stack of linkedStacks) {
    const li = document.createElement("li");

    const top = document.createElement("div");
    top.className = "dir-top";

    const name = document.createElement("strong");
    name.textContent = stack.directoryName;

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-mini btn-ghost";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeDirectory(stack.id, stack.directoryName));

    top.append(name, removeBtn);

    const pathEl = document.createElement("div");
    pathEl.className = "path";
    pathEl.textContent = stack.dirPath;

    li.append(top, pathEl);
    directoryList.appendChild(li);
  }
}

function renderStacks() {
  stackContainer.innerHTML = "";

  const visibleStacks = filterStacksForEntries(linkedStacks, entriesSearch);

  if (!visibleStacks.length) {
    const empty = document.createElement("div");
    empty.className = "notice";
    empty.textContent = linkedStacks.length
      ? "No entries match your search."
      : "Link a directory with a compose file to get started.";
    stackContainer.appendChild(empty);
    entriesCount.textContent = "0 visible";
    return;
  }

  const visibleServiceCount = visibleStacks.reduce(
    (total, stack) => total + (stack.services || []).length,
    0
  );
  entriesCount.textContent = `${visibleServiceCount} entries across ${visibleStacks.length} stack(s)`;

  for (const stack of visibleStacks) {
    const card = document.createElement("details");
    card.className = "stack-card stack-details";
    card.open = openStackIds.has(stack.id);
    card.addEventListener("toggle", () => {
      if (card.open) {
        openStackIds.add(stack.id);
      } else {
        openStackIds.delete(stack.id);
      }
    });
    if (stack.updateCount > 0) {
      card.classList.add("has-updates");
    }

    const stackRuntime = summarizeStackRuntime(stack.services || []);

    const summary = document.createElement("summary");
    summary.className = "stack-top";

    const titleWrap = document.createElement("div");
    titleWrap.className = "stack-title-wrap";

    const titleHead = document.createElement("div");
    titleHead.className = "stack-title-head";

    const stackDot = document.createElement("span");
    stackDot.className = `status-dot ${stackRuntime.dotClass}`;
    stackDot.title = stackRuntime.title;

    const title = document.createElement("div");
    title.className = "stack-title";
    title.textContent =
      stack.updateCount > 0
        ? `${stack.directoryName} (${stack.updateCount} update${stack.updateCount > 1 ? "s" : ""})`
        : stack.directoryName;

    titleHead.append(stackDot, title);

    const sub = document.createElement("div");
    sub.className = "stack-sub";
    sub.textContent = `${stackRuntime.label} | ${stack.composePath || stack.dirPath}`;
    titleWrap.append(titleHead, sub);

    const stackProgressState = stackProgress.get(stack.id);
    if (stackProgressState?.active) {
      const progressWrap = document.createElement("div");
      progressWrap.className = "stack-progress";

      const progressLabel = document.createElement("div");
      progressLabel.className = "stack-progress-label";
      progressLabel.textContent = stackProgressState.label || "Working...";

      const progressTrack = document.createElement("div");
      progressTrack.className = "stack-progress-track";

      const progressFill = document.createElement("div");
      progressFill.className = "stack-progress-fill";
      const percent = Number(stackProgressState.percent);
      const width = Number.isFinite(percent) ? Math.max(2, Math.min(100, percent)) : 35;
      progressFill.style.width = `${width}%`;
      if (!Number.isFinite(percent)) {
        progressFill.classList.add("indeterminate");
      }

      progressTrack.appendChild(progressFill);
      progressWrap.append(progressLabel, progressTrack);
      titleWrap.appendChild(progressWrap);
    }

    const updateBtn = document.createElement("button");
    updateBtn.className = "btn btn-mini btn-secondary";
    updateBtn.type = "button";
    updateBtn.textContent = "Update Compose";
    updateBtn.disabled = !stack.available;
    updateBtn.addEventListener("click", () => updateCompose(stack.id, stack.directoryName));

    const controls = document.createElement("div");
    controls.className = "stack-actions";

    const stackPrimaryAction = stackRuntime.allRunning ? "stop" : "start";
    const primaryStackBtn = stackPrimaryAction === "stop"
      ? makeIconButton(ICON_STOP, "Stop stack", () => controlStack(stack.id, stack.directoryName, "stop"))
      : makeControlButton("Start", () => controlStack(stack.id, stack.directoryName, "start"));
    const restartStackBtn = makeIconButton(ICON_RESTART, "Restart stack", () =>
      controlStack(stack.id, stack.directoryName, "restart")
    );
    const checkStackBtn = makeIconButton(ICON_CHECK, "Check updates for this stack", () =>
      onCheckUpdatesForStack(stack.id, stack.directoryName)
    );
    const addServicesBtn = makeControlButton("Add Services", () => openComposeServiceModal(stack.id));

    primaryStackBtn.disabled = !stack.available;
    restartStackBtn.disabled = !stack.available;
    checkStackBtn.disabled = !stack.available;
    addServicesBtn.disabled = !stack.available;

    controls.append(primaryStackBtn, restartStackBtn, checkStackBtn, updateBtn, addServicesBtn);

    summary.append(titleWrap, controls);
    card.appendChild(summary);

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "stack-body";

    if (!stack.available) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = stack.error || "Compose not available.";
      bodyWrap.appendChild(error);
      card.appendChild(bodyWrap);
      stackContainer.appendChild(card);
      continue;
    }

    const autoWrap = document.createElement("div");
    autoWrap.className = "stack-auto-update-row";

    const autoLabel = document.createElement("label");
    autoLabel.className = "inline-toggle";

    const autoInput = document.createElement("input");
    autoInput.type = "checkbox";
    autoInput.checked = isStackAutoUpdateEnabled(stack.id);
    autoInput.disabled = autoUpdateAllEnabled;
    autoInput.addEventListener("change", (event) => {
      onStackAutoUpdateToggleChanged(stack.id, event.target.checked);
    });

    const autoText = document.createElement("span");
    autoText.textContent = autoUpdateAllEnabled
      ? "Auto update enabled by global toggle"
      : "Auto update this compose stack";

    autoLabel.append(autoInput, autoText);
    autoWrap.appendChild(autoLabel);
    bodyWrap.appendChild(autoWrap);

    const serviceList = document.createElement("div");
    serviceList.className = "service-list";

    for (const service of stack.services || []) {
      const fragment = serviceTemplate.content.cloneNode(true);
      const details = fragment.querySelector("details");
      const titleEl = fragment.querySelector(".service-title");
      const body = fragment.querySelector(".service-body");
      const updateServiceBtn = fragment.querySelector(".update-service-btn");
      const servicePrimaryBtn = fragment.querySelector(".service-primary-btn");
      const serviceRestartBtn = fragment.querySelector(".service-restart-btn");
      const serviceCheckBtn = fragment.querySelector(".service-check-btn");
      const serviceRemoveBtn = fragment.querySelector(".service-remove-btn");

      const serviceKey = `${stack.id}::${service.name}`;
      details.open = openServiceKeys.has(serviceKey);
      details.addEventListener("toggle", () => {
        if (details.open) {
          openServiceKeys.add(serviceKey);
        } else {
          openServiceKeys.delete(serviceKey);
        }
      });

      const head = document.createElement("div");
      head.className = "service-head";

      const statusDot = document.createElement("span");
      statusDot.className = `status-dot ${service.runtime?.isRunning ? "up" : "down"}`;
      statusDot.title = service.runtime?.isRunning
        ? `Running (${service.runtime?.state || "running"})`
        : `Down (${service.runtime?.state || "not running"})`;
      head.appendChild(statusDot);

      titleEl.textContent = service.name;
      head.appendChild(titleEl);

      if (service.version?.updateAvailable) {
        const badge = document.createElement("span");
        badge.className = "badge update";
        badge.textContent = "Update available";
        head.appendChild(badge);
        details.classList.add("has-update");
      } else if (service.version?.status === "up-to-date") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Up to date";
        head.appendChild(badge);
      } else if (service.version?.status === "unknown") {
        const badge = document.createElement("span");
        const isRateLimited = String(service.version?.reason || "").toLowerCase().includes("rate limit");
        badge.className = isRateLimited ? "badge rate-limited" : "badge warn";
        badge.textContent = isRateLimited ? "Rate limited" : "Unknown";
        badge.title = service.version?.reason || "";
        head.appendChild(badge);
      }

      const sourceRegistry = String(service.version?.latestSourceRegistry || "").toLowerCase();
      const hasDigest = Boolean(service.version?.latestDigest);
      if (sourceRegistry && hasDigest) {
        const sourceBadge = document.createElement("span");
        const isKnownRegistry = sourceRegistry === "ghcr" || sourceRegistry === "dockerhub";
        sourceBadge.className = `badge registry ${isKnownRegistry ? sourceRegistry : "other"}`;
        sourceBadge.textContent = sourceRegistry === "dockerhub"
          ? "Docker Hub"
          : sourceRegistry === "ghcr"
            ? "GHCR"
            : sourceRegistry; // Show hostname like "lscr.io", "quay.io" directly
        const sourceRef = service.version?.latestSource || service.version?.imageRef || "";
        if (sourceRef) {
          sourceBadge.title = `Checked via ${sourceRef}`;
        }
        head.appendChild(sourceBadge);
      }

      const summary = details.querySelector("summary");
      summary.prepend(head);

      // Per-service pull progress bar — visible in the summary even when collapsed
      const svcProgress = serviceProgress.get(serviceKey);
      if (svcProgress?.active) {
        const progWrap = document.createElement("div");
        progWrap.className = "service-progress";

        const progLabel = document.createElement("div");
        progLabel.className = "stack-progress-label";
        progLabel.textContent = svcProgress.label || "Working...";

        const progTrack = document.createElement("div");
        progTrack.className = "stack-progress-track";

        const progFill = document.createElement("div");
        progFill.className = "stack-progress-fill";
        const pct = Number(svcProgress.percent);
        if (Number.isFinite(pct)) {
          progFill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
        } else {
          progFill.classList.add("indeterminate");
        }

        progTrack.appendChild(progFill);
        progWrap.append(progLabel, progTrack);
        summary.appendChild(progWrap);
        details.open = true; // auto-expand so the progress is easy to see
      }

      const servicePrimaryAction = service.runtime?.isRunning ? "stop" : "start";
      if (servicePrimaryAction === "stop") {
        servicePrimaryBtn.innerHTML = ICON_STOP;
        servicePrimaryBtn.title = "Stop";
      } else {
        servicePrimaryBtn.innerHTML = ICON_PLAY;
        servicePrimaryBtn.title = "Start";
      }
      servicePrimaryBtn.classList.add("btn-icon");
      servicePrimaryBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        await controlService(stack.id, stack.directoryName, service.name, servicePrimaryAction);
      });

      serviceRestartBtn.innerHTML = ICON_RESTART;
      serviceRestartBtn.title = "Restart";
      serviceRestartBtn.classList.add("btn-icon");
      serviceRestartBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        await controlService(stack.id, stack.directoryName, service.name, "restart");
      });

      serviceCheckBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        await onCheckUpdatesForStack(stack.id, stack.directoryName);
      });

      updateServiceBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        await updateOneService(stack.id, stack.directoryName, service.name);
      });

      serviceRemoveBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        await removeComposeService(stack.id, service.name);
      });

      const kvEntries = [
        ["Current Version", valueOrFallback(service.version?.current)],
        ["Latest Version", valueOrFallback(service.version?.latest)],
        ["Latest Source", valueOrFallback(service.version?.latestSource)],
        // Status Reason only shown when something is wrong — for up-to-date services it's just noise
        ...(service.version?.status !== "up-to-date" ? [["Status Reason", valueOrFallback(service.version?.reason)]] : []),
        ["Runtime", valueOrFallback(service.runtime?.state)],
        ["Image", valueOrFallback(service.image)],
        ["Container", valueOrFallback(service.containerName)],
        ["Ports", listOrFallback(service.ports)],
        ["Volumes", listOrFallback(service.volumes)],
        ["Environment", listOrFallback(service.environment)],
        ["Networks", listOrFallback(service.networks)],
        ["Restart", valueOrFallback(service.restart)],
        ["Depends On", listOrFallback(service.dependsOn)],
        ["Command", valueOrFallback(service.command)],
      ];
      for (const [label, value] of kvEntries) {
        if (value !== "-") body.appendChild(keyValue(label, value));
      }

      serviceList.appendChild(fragment);
    }

    bodyWrap.appendChild(serviceList);
    card.appendChild(bodyWrap);
    stackContainer.appendChild(card);
  }
}

function summarizeStackRuntime(services) {
  const total = services.length;
  const running = services.filter((service) => service.runtime?.isRunning).length;

  if (total === 0 || running === 0) {
    return {
      dotClass: "down",
      allRunning: false,
      label: "all offline",
      title: `All offline (${running}/${total} running)`
    };
  }

  if (running === total) {
    return {
      dotClass: "up",
      allRunning: true,
      label: "all online",
      title: `All online (${running}/${total} running)`
    };
  }

  return {
    dotClass: "partial",
    allRunning: false,
    label: "partial",
    title: `Partial (${running}/${total} running)`
  };
}

function renderPorts() {
  portsContainer.innerHTML = "";

  const allPortRows = collectPorts(linkedStacks);
  const visibleRows = filterPorts(allPortRows, portsSearch);

  if (!visibleRows.length) {
    const empty = document.createElement("div");
    empty.className = "notice";
    empty.textContent = allPortRows.length
      ? "No ports match your search."
      : "No published ports found in linked compose entries.";
    portsContainer.appendChild(empty);
    portsCount.textContent = "0 visible";
    return;
  }

  portsCount.textContent = `${visibleRows.length} port mapping(s)`;

  const table = document.createElement("table");
  table.className = "ports-table";

  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>Service</th><th>Directory</th><th>Host Port</th><th>Container Port</th><th>Protocol</th><th>Raw</th></tr>";

  const tbody = document.createElement("tbody");

  for (const row of visibleRows) {
    const tr = document.createElement("tr");
    if (row.conflict) {
      tr.classList.add("conflict");
    }

    const hostPort = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = `port-chip${row.conflict ? " conflict" : ""}`;
    chip.textContent = row.hostPort || "-";
    hostPort.appendChild(chip);

    const containerPort = document.createElement("td");
    containerPort.textContent = row.containerPort || "-";

    const protocol = document.createElement("td");
    protocol.textContent = row.protocol || "-";

    const directory = document.createElement("td");
    directory.textContent = row.directoryName;

    const service = document.createElement("td");
    service.textContent = row.serviceName;

    const raw = document.createElement("td");
    raw.textContent = row.raw;

    tr.append(service, directory, hostPort, containerPort, protocol, raw);
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  portsContainer.appendChild(table);
}

function renderSystemd() {
  systemdContainer.innerHTML = "";

  const visibleSystem = filterSystemd(systemdServices.system || [], systemdSearch);
  const visibleUser = filterSystemd(systemdServices.user || [], systemdSearch);
  const totalVisible = visibleSystem.length + visibleUser.length;
  systemdCount.textContent = `${totalVisible} service(s) visible`;

  const systemScope = buildSystemdScopeSection(
    "System Services",
    visibleSystem,
    "system",
    systemdServices?.errors?.system
  );
  const userScope = buildSystemdScopeSection(
    "User Services",
    visibleUser,
    "user",
    systemdServices?.errors?.user
  );

  systemdContainer.append(systemScope, userScope);
}

function buildSystemdScopeSection(title, services, scopeKey, error) {
  const section = document.createElement("section");
  section.className = "systemd-scope";

  const heading = document.createElement("div");
  heading.className = "systemd-scope-head";

  const label = document.createElement("h3");
  label.textContent = `${title} (${services.length})`;

  heading.appendChild(label);
  section.appendChild(heading);

  if (error) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = error;
    section.appendChild(notice);
    return section;
  }

  if (!services.length) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = scopeKey === "user" ? "No user services found." : "No system services found.";
    section.appendChild(notice);
    return section;
  }

  const table = document.createElement("table");
  table.className = "systemd-table";

  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>Service</th><th>Running</th><th>Enabled</th><th>Active</th><th>Sub</th><th>Description</th><th>Control</th></tr>";

  const tbody = document.createElement("tbody");

  for (const item of services) {
    const tr = document.createElement("tr");

    const service = document.createElement("td");
    service.className = "mono";
    service.textContent = valueOrFallback(item.name);

    const running = document.createElement("td");
    running.appendChild(makeStatusBadge(item.running ? "running" : "stopped", item.running ? "ok" : "bad"));

    const enabled = document.createElement("td");
    const enabledKind = item.enabled ? "ok" : "bad";
    enabled.appendChild(makeStatusBadge(valueOrFallback(item.enabledState), enabledKind));

    const active = document.createElement("td");
    active.textContent = valueOrFallback(item.activeState);

    const sub = document.createElement("td");
    sub.textContent = valueOrFallback(item.subState);

    const description = document.createElement("td");
    description.textContent = valueOrFallback(item.description);

    const control = document.createElement("td");
    const controlWrap = document.createElement("div");
    controlWrap.className = "systemd-controls";
    const startBtn = makeControlButton("Start", () => controlSystemdService(scopeKey, item.name, "start"));
    const stopBtn = makeControlButton("Stop", () => controlSystemdService(scopeKey, item.name, "stop"));
    const restartBtn = makeControlButton("Restart", () => controlSystemdService(scopeKey, item.name, "restart"));
    startBtn.classList.add("btn-mini");
    stopBtn.classList.add("btn-mini");
    restartBtn.classList.add("btn-mini");
    controlWrap.append(startBtn, stopBtn, restartBtn);
    control.appendChild(controlWrap);

    tr.append(service, running, enabled, active, sub, description, control);
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  section.appendChild(table);
  return section;
}

function makeStatusBadge(text, kind) {
  const badge = document.createElement("span");
  badge.className = `badge ${kind === "ok" ? "ok" : "warn"}`;
  badge.textContent = text;
  return badge;
}

function filterSystemd(services, search) {
  if (!search) {
    return services;
  }

  return services.filter((item) => {
    const blob = [
      item.name,
      item.description,
      item.activeState,
      item.subState,
      item.enabledState,
      item.running ? "running" : "stopped"
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return blob.includes(search);
  });
}

function filterStacksForEntries(stacks, search) {
  if (!search) {
    return stacks;
  }

  return stacks
    .map((stack) => {
      const dirMatch = stack.directoryName.toLowerCase().includes(search);
      const services = (stack.services || []).filter((service) => {
        const blob = [
          service.name,
          service.image,
          service.containerName,
          service.version?.current,
          service.version?.latest,
          service.version?.status,
          service.version?.reason
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return dirMatch || blob.includes(search);
      });

      return {
        ...stack,
        services,
        updateCount: services.filter((service) => service.version?.updateAvailable).length
      };
    })
    .filter((stack) => stack.services.length > 0 || stack.directoryName.toLowerCase().includes(search));
}

function collectPorts(stacks) {
  const rows = [];

  for (const stack of stacks) {
    if (!stack.available) {
      continue;
    }

    for (const service of stack.services || []) {
      for (const entry of service.ports || []) {
        const parsed = parsePortEntry(String(entry));
        rows.push({
          directoryName: stack.directoryName,
          serviceName: service.name,
          hostPort: parsed.hostPort,
          containerPort: parsed.containerPort,
          protocol: parsed.protocol,
          raw: String(entry),
          conflict: false
        });
      }
    }
  }

  const byHostPort = new Map();
  for (const row of rows) {
    if (!row.hostPort) {
      continue;
    }
    const key = `${row.hostPort}/${row.protocol || "any"}`;
    byHostPort.set(key, (byHostPort.get(key) || 0) + 1);
  }

  for (const row of rows) {
    if (!row.hostPort) {
      continue;
    }
    const key = `${row.hostPort}/${row.protocol || "any"}`;
    row.conflict = (byHostPort.get(key) || 0) > 1;
  }

  rows.sort((a, b) => {
    const aPort = Number(a.hostPort || 0);
    const bPort = Number(b.hostPort || 0);
    if (aPort !== bPort) {
      return aPort - bPort;
    }
    return `${a.directoryName}/${a.serviceName}`.localeCompare(`${b.directoryName}/${b.serviceName}`);
  });

  return rows;
}

function parsePortEntry(raw) {
  const input = String(raw || "").trim();
  const protocol = input.includes("/") ? input.split("/").pop() : "tcp";
  const base = input.split("/")[0];

  const parts = base.split(":");
  if (parts.length === 1) {
    const only = parts[0].trim();
    return {
      hostPort: null,
      containerPort: digitsOnly(only),
      protocol
    };
  }

  const containerPart = parts[parts.length - 1].trim();
  const hostPart = parts[parts.length - 2].trim();

  return {
    hostPort: digitsOnly(hostPart),
    containerPort: digitsOnly(containerPart),
    protocol
  };
}

function digitsOnly(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : null;
}

function filterPorts(rows, search) {
  if (!search) {
    return rows;
  }

  return rows.filter((row) => {
    const blob = [
      row.hostPort,
      row.containerPort,
      row.protocol,
      row.directoryName,
      row.serviceName,
      row.raw
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return blob.includes(search);
  });
}

function keyValue(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "kv";

  const span = document.createElement("span");
  span.textContent = label;

  const code = document.createElement("code");
  code.textContent = value;

  wrap.append(span, code);
  return wrap;
}

function listOrFallback(values) {
  if (!Array.isArray(values) || !values.length) {
    return "-";
  }
  return values.join("\n");
}

function valueOrFallback(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

async function updateCompose(id, directoryName) {
  setBusy(true);
  logOutput(`Updating compose stack: ${directoryName}`);
  setStackProgress(id, {
    active: true,
    label: `Updating compose: ${directoryName}`,
    percent: 15
  });

  try {
    await runUpdateJob(`/api/update/link/${encodeURIComponent(id)}`, `Update compose: ${directoryName}`);
    setStackProgress(id, {
      active: true,
      label: `Refreshing after update: ${directoryName}`,
      percent: 70
    });
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR updating compose: ${error.message}`);
  } finally {
    clearStackProgress(id);
    setBusy(false);
  }
}

async function controlStack(id, directoryName, action) {
  setBusy(true);
  logOutput(`${capitalize(action)} stack: ${directoryName}`);
  setStackProgress(id, {
    active: true,
    label: `${capitalize(action)}: ${directoryName}`,
    percent: 20
  });

  try {
    await runUpdateJob(
      `/api/control/link/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
      `${capitalize(action)} stack: ${directoryName}`
    );
    setStackProgress(id, {
      active: true,
      label: `Refreshing: ${directoryName}`,
      percent: 70
    });
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR ${action} stack: ${error.message}`);
  } finally {
    clearStackProgress(id);
    setBusy(false);
  }
}

async function updateOneService(id, directoryName, serviceName) {
  setBusy(true);
  logOutput(`Updating ${serviceName} in ${directoryName}`);
  setStackProgress(id, {
    active: true,
    label: `Updating: ${directoryName}`,
    percent: 20
  });
  setServiceProgress(id, serviceName, { active: true, label: "Pulling image...", percent: null });

  try {
    const encodedService = encodeURIComponent(serviceName);
    await runUpdateJob(
      `/api/update/service/${encodeURIComponent(id)}/${encodedService}`,
      `Update service: ${directoryName}/${serviceName}`
    );
    setServiceProgress(id, serviceName, { active: true, label: "Restarting container...", percent: 80 });
    setStackProgress(id, {
      active: true,
      label: `Refreshing after service update: ${directoryName}`,
      percent: 70
    });
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR updating service: ${error.message}`);
  } finally {
    clearServiceProgress(id, serviceName);
    clearStackProgress(id);
    setBusy(false);
  }
}

async function controlService(id, directoryName, serviceName, action) {
  setBusy(true);
  logOutput(`${capitalize(action)} ${serviceName} in ${directoryName}`);
  setStackProgress(id, {
    active: true,
    label: `${capitalize(action)} ${serviceName}: ${directoryName}`,
    percent: 20
  });

  try {
    const encodedService = encodeURIComponent(serviceName);
    await runUpdateJob(
      `/api/control/service/${encodeURIComponent(id)}/${encodedService}/${encodeURIComponent(action)}`,
      `${capitalize(action)} service: ${directoryName}/${serviceName}`
    );
    setStackProgress(id, {
      active: true,
      label: `Refreshing: ${directoryName}`,
      percent: 70
    });
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR ${action} service: ${error.message}`);
  } finally {
    clearStackProgress(id);
    setBusy(false);
  }
}

async function controlSystemdService(scope, serviceName, action) {
  setBusy(true);
  const scopeLabel = scope === "user" ? "user" : "system";
  logOutput(`${capitalize(action)} ${serviceName} (${scopeLabel})`);

  try {
    await runUpdateJob(
      `/api/systemd/control/${encodeURIComponent(scope)}/${encodeURIComponent(serviceName)}/${encodeURIComponent(action)}`,
      `${capitalize(action)} ${serviceName} (${scopeLabel})`
    );
    await loadSystemd();
  } catch (error) {
    if (!systemdEnabled) return;
    logOutput(`ERROR ${action} ${serviceName}: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function removeDirectory(id, directoryName) {
  setBusy(true);

  try {
    const response = await fetch(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to remove directory");
    }

    logOutput(`Removed: ${directoryName}`);
    await loadStacksProgressive({ mode: "manual-refresh" });
  } catch (error) {
    logOutput(`ERROR removing directory: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  isBusy = busy;
  document.querySelectorAll("button").forEach((button) => {
    const allowBusy = button.getAttribute("data-allow-busy") === "true";
    button.disabled = busy && !allowBusy;
  });
}

async function runUpdateJob(url, label, options = {}) {
  const response = await fetch(url, { method: "POST" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `${label} failed to start`);
  }

  const jobId = payload.jobId;
  if (!jobId) {
    throw new Error("No job id returned from server");
  }

  if (typeof options.onStarted === "function") {
    options.onStarted(jobId);
  }

  setJobProgress(`${label}: starting...`);
  await watchJob(jobId, label, options);
}

async function watchJob(jobId, label, options = {}) {
  let lineIndex = 0;

  while (true) {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to read update progress");
    }

    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (lineIndex < lines.length) {
      const newLines = lines.slice(lineIndex);
      lineIndex = lines.length;
      logOutput(newLines.join("\n"));
    }

    if (typeof options.onProgress === "function") {
      options.onProgress(payload);
    }

    const percent =
      typeof payload.progressPercent === "number" ? `${Math.round(payload.progressPercent)}%` : "running";
    setJobProgress(`${label}: ${percent}`);

    if (payload.state === "completed") {
      setJobProgress(`${label}: done`);
      if (typeof options.onComplete === "function") {
        options.onComplete(payload);
      }
      return;
    }

    if (payload.state === "failed") {
      const message = payload.error || "Update job failed";
      setJobProgress(`${label}: failed`);
      if (typeof options.onFailed === "function") {
        options.onFailed(payload);
      }
      throw new Error(message);
    }

    await wait(900);
  }
}

function setJobProgress(text) {
  jobProgress.textContent = text || "";
}

function makeControlButton(label, handler) {
  const button = document.createElement("button");
  button.className = "btn btn-mini btn-ghost";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function makeIconButton(iconHtml, label, handler) {
  const button = document.createElement("button");
  button.className = "btn btn-mini btn-ghost btn-icon";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = iconHtml;
  button.addEventListener("click", handler);
  return button;
}

async function onCheckUpdatesForStack(id, directoryName) {
  setBusy(true);
  logOutput(`Checking updates for ${directoryName}...`);
  setJobProgress(`Checking ${directoryName}...`);
  setStackProgress(id, {
    active: true,
    label: `Checking updates: ${directoryName}`,
    percent: 20
  });
  try {
    const response = await fetch(`/api/links/${encodeURIComponent(id)}?forceLatest=1`);
    const payload = await parseJsonResponse(response, `stack ${directoryName}`);
    if (!response.ok) {
      throw new Error(payload.error || "Failed to check updates");
    }
    linkedStacks = linkedStacks.map((s) => (s.id === id ? payload : s));
    renderStacks();
    renderPorts();
    logOutput(`Check complete for ${directoryName}.`);
    setStackProgress(id, {
      active: true,
      label: `Check complete: ${directoryName}`,
      percent: 100
    });
  } catch (error) {
    logOutput(`ERROR checking ${directoryName}: ${error.message}`);
  } finally {
    setJobProgress("");
    setTimeout(() => clearStackProgress(id), 700);
    setBusy(false);
  }
}

function capitalize(value) {
  const text = String(value || "");
  if (!text) {
    return text;
  }

  return text[0].toUpperCase() + text.slice(1);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logOutput(message) {
  const timestamp = new Date().toLocaleString();
  actionOutput.textContent = `[${timestamp}] ${message}\n\n${actionOutput.textContent}`.trim();
}

function openLoginModal() {
  if (loginAutoCloseHandle) {
    clearTimeout(loginAutoCloseHandle);
    loginAutoCloseHandle = null;
  }

  loginModal.classList.remove("hidden");
  loginModal.setAttribute("aria-hidden", "false");
  loginDeviceCode.textContent = "-";
  loginActivationUrl.textContent = "https://login.docker.com/activate";
  loginActivationUrl.href = "https://login.docker.com/activate";
  loginModalLog.textContent = "Starting docker login...";
  setLoginModalState(
    "pending",
    "Waiting for device confirmation",
    "If a code appears, complete it in your browser."
  );
}

async function closeLoginModal() {
  if (loginAutoCloseHandle) {
    clearTimeout(loginAutoCloseHandle);
    loginAutoCloseHandle = null;
  }

  if (activeLoginJobId) {
    try {
      await fetch(`/api/jobs/${encodeURIComponent(activeLoginJobId)}/cancel`, { method: "POST" });
      logOutput("Docker login cancelled.");
    } catch {
      // best effort cancellation
    }
    activeLoginJobId = null;
  }

  loginModal.classList.add("hidden");
  loginModal.setAttribute("aria-hidden", "true");
}

function setLoginModalState(kind, text, hint) {
  loginModalStatusIcon.classList.remove("pending", "success", "error");
  loginModalStatusIcon.classList.add(kind);
  loginModalStatusText.textContent = text;
  loginModalHint.textContent = hint;
}

function updateLoginModalFromJob(payload) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const plain = lines.join("\n");
  loginModalLog.textContent = plain || "Waiting for output...";

  const codeMatch =
    plain.match(/one-time device confirmation code is:\s*([A-Z0-9-]+)/i) ||
    plain.match(/confirmation code is:\s*([A-Z0-9-]+)/i) ||
    plain.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
  if (codeMatch) {
    loginDeviceCode.textContent = codeMatch[1];
  }

  const urlMatch = plain.match(/https:\/\/[^\s]+/i);
  if (urlMatch) {
    loginActivationUrl.textContent = urlMatch[0];
    loginActivationUrl.href = urlMatch[0];
  }

  if (/waiting for authentication in the browser/i.test(plain)) {
    setLoginModalState("pending", "Waiting for browser authentication", "Complete login in your browser.");
  }
  if (/login succeeded/i.test(plain)) {
    setLoginModalState("success", "Login successful", "Credentials detected. Closing popup...");
  }
}

async function copyDeviceCodeToClipboard() {
  const code = String(loginDeviceCode.textContent || "").trim();
  if (!code || code === "-") {
    return;
  }

  const originalLabel = copyDeviceCodeBtn.textContent;
  let copied = false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied) {
    copied = legacyCopyText(code);
  }

  if (!copied) {
    window.prompt("Copy device code:", code);
  }

  copyDeviceCodeBtn.textContent = copied ? "Copied" : "Manual";

  setTimeout(() => {
    copyDeviceCodeBtn.textContent = originalLabel;
  }, 1200);
}

function legacyCopyText(text) {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "-9999px";
  el.style.left = "-9999px";
  document.body.appendChild(el);

  el.focus();
  el.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(el);
  return ok;
}
