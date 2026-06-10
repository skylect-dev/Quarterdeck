require("dotenv").config();

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { createHmac, randomUUID, timingSafeEqual } = require("crypto");
const { spawn } = require("child_process");
const yaml = require("js-yaml");

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 3099;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LINKS_FILE = path.join(DATA_DIR, "linked-directories.json");
const JOB_MAX_LINES = 500;
const LATEST_DIGEST_TTL_MS = Number(process.env.LATEST_DIGEST_TTL_MS || 24 * 60 * 60 * 1000);
const REGISTRY_QUEUE_DELAY_MS = Number(process.env.REGISTRY_QUEUE_DELAY_MS || 350);
const FORCE_LATEST_MIN_RECHECK_MS = Number(process.env.FORCE_LATEST_MIN_RECHECK_MS || 5 * 60 * 1000);
const PREFER_GHCR = ["1", "true", "yes", "on"].includes(String(process.env.PREFER_GHCR || "").toLowerCase());
const GHCR_ONLY = ["1", "true", "yes", "on"].includes(String(process.env.GHCR_ONLY || "").toLowerCase());
const GHCR_NEGATIVE_TTL_MS = Number(process.env.GHCR_NEGATIVE_TTL_MS || 24 * 60 * 60 * 1000);
const CACHE_FILE = path.join(DATA_DIR, "digest-cache.json");
const APP_PASSWORD = String(process.env.APP_PASSWORD || "");
const SESSION_SECRET = String(process.env.SESSION_SECRET || APP_PASSWORD);
const SESSION_COOKIE_NAME = "quarterdeck_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const REMEMBER_LOGIN_DAYS = Math.max(1, Number(process.env.REMEMBER_LOGIN_DAYS || 30));
const COOKIE_SECURE = ["1", "true", "yes", "on"].includes(String(process.env.COOKIE_SECURE || "").toLowerCase());
const LOGIN_WINDOW_MS = Math.max(10_000, Number(process.env.LOGIN_WINDOW_MS || 10 * 60 * 1000));
const LOGIN_MAX_ATTEMPTS = Math.max(1, Number(process.env.LOGIN_MAX_ATTEMPTS || 8));
const LOGIN_LOCKOUT_MS = Math.max(30_000, Number(process.env.LOGIN_LOCKOUT_MS || 15 * 60 * 1000));
const SYSTEMD_ENABLED = !["0", "false", "no", "off"].includes(String(process.env.ENABLE_SYSTEMD || "true").toLowerCase());
// Rate-limited failures retry after 1h; successful checks are cached for LATEST_DIGEST_TTL_MS (24h)
const RATE_LIMIT_RETRY_MS = Number(process.env.RATE_LIMIT_RETRY_MS || 60 * 60 * 1000);

if (APP_PASSWORD && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set when APP_PASSWORD is enabled.");
}

const COMPOSE_CANDIDATES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml"
];

const jobs = new Map();
const loginRateLimitByIp = new Map();
const latestDigestCache = new Map();
const latestDigestInFlight = new Map();
// Tracks GHCR refs that returned "not found" so we skip them until the TTL expires
const ghcrNegativeCache = new Map();
let cacheDirty = false;
let cacheSaveTimeout = null;

// Serialized queue for outgoing registry checks — prevents burst rate-limiting.
let registryQueueTail = Promise.resolve();
function enqueueRegistryCheck(fn) {
  const next = registryQueueTail.then(() => fn()).then(
    (result) => { return new Promise((resolve) => setTimeout(() => resolve(result), REGISTRY_QUEUE_DELAY_MS)); },
    (err) => { return new Promise((_res, reject) => setTimeout(() => reject(err), REGISTRY_QUEUE_DELAY_MS)); }
  );
  registryQueueTail = next.catch(() => {});
  return next;
}

// ── Persistent cache ──────────────────────────────────────────────────────────

function scheduleCacheSave() {
  cacheDirty = true;
  if (cacheSaveTimeout) return;
  cacheSaveTimeout = setTimeout(() => {
    cacheSaveTimeout = null;
    saveCacheToDisk().catch(() => {});
  }, 60_000);
}

async function saveCacheToDisk() {
  if (!cacheDirty) return;
  cacheDirty = false;
  const data = {
    digests: [...latestDigestCache.entries()],
    ghcrNegative: [...ghcrNegativeCache.entries()]
  };
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(data), "utf8");
  } catch {
    cacheDirty = true; // retry next cycle
  }
}

async function loadCacheFromDisk() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.digests)) {
      for (const [k, v] of data.digests) latestDigestCache.set(k, v);
    }
    if (Array.isArray(data.ghcrNegative)) {
      for (const [k, v] of data.ghcrNegative) ghcrNegativeCache.set(k, v);
    }
    console.log(`[cache] Loaded ${latestDigestCache.size} digests, ${ghcrNegativeCache.size} GHCR negatives from disk.`);
  } catch {
    // File missing or corrupt — start fresh, no action needed
  }
}

async function gracefulShutdown(signal) {
  console.log(`[cache] ${signal} received, flushing cache to disk...`);
  if (cacheSaveTimeout) { clearTimeout(cacheSaveTimeout); cacheSaveTimeout = null; }
  cacheDirty = true; // force write even if nothing changed since last auto-save
  await saveCacheToDisk().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// ─────────────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (!APP_PASSWORD) {
    return next();
  }

  if (!req.path.startsWith("/api/")) {
    return next();
  }

  if (req.path === "/api/health" || req.path === "/api/session/status" || req.path === "/api/session/login") {
    return next();
  }

  if (!hasValidSession(req)) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Authentication required", authRequired: true });
  }

  return next();
});

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/session/status", (req, res) => {
  res.json({
    enabled: Boolean(APP_PASSWORD),
    authenticated: APP_PASSWORD ? hasValidSession(req) : true,
    message: APP_PASSWORD ? "Enter the app password to continue." : "Authentication disabled",
    systemdEnabled: SYSTEMD_ENABLED
  });
});

app.post("/api/session/login", (req, res) => {
  if (!APP_PASSWORD) {
    return res.json({ ok: true, enabled: false, authenticated: true });
  }

  const clientIp = getClientIp(req);
  const throttled = checkLoginThrottle(clientIp);
  if (throttled.locked) {
    const retrySeconds = Math.max(1, Math.ceil((throttled.retryAt - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retrySeconds));
    return res.status(429).json({
      error: "Too many login attempts. Try again later.",
      retryAfterSeconds: retrySeconds
    });
  }

  const password = String(req.body?.password || "");
  const remember = Boolean(req.body?.remember);
  if (!password) {
    recordLoginFailure(clientIp);
    return res.status(400).json({ error: "Password is required" });
  }

  if (!safeEquals(password, APP_PASSWORD)) {
    clearSessionCookie(res);
    recordLoginFailure(clientIp);
    return res.status(401).json({ error: "Invalid password" });
  }

  clearLoginFailures(clientIp);
  setSessionCookie(res, { remember });
  res.json({ ok: true, enabled: true, authenticated: true, remember });
});

app.post("/api/session/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/systemd/services", async (_req, res) => {
  if (!SYSTEMD_ENABLED) {
    return res.status(404).json({ error: "Systemd control is disabled" });
  }
  try {
    const [systemScope, userScope] = await Promise.all([
      listSystemdServices("system"),
      listSystemdServices("user")
    ]);

    res.json({
      system: systemScope.services,
      user: userScope.services,
      errors: {
        system: systemScope.error,
        user: userScope.error
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      system: [],
      user: [],
      errors: {
        system: error.message,
        user: error.message
      }
    });
  }
});

app.post("/api/systemd/control/:scope/:serviceName/:action", async (req, res) => {
  if (!SYSTEMD_ENABLED) {
    return res.status(404).json({ error: "Systemd control is disabled" });
  }
  const scope = String(req.params.scope || "").toLowerCase();
  const action = String(req.params.action || "").toLowerCase();
  const serviceName = String(req.params.serviceName || "").trim();

  if (![("system"), ("user")].includes(scope)) {
    return res.status(400).json({ error: "Invalid scope" });
  }
  if (!["start", "stop", "restart"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }
  if (!/^[A-Za-z0-9@._-]+\.service$/.test(serviceName)) {
    return res.status(400).json({ error: "Invalid service name" });
  }

  const label = `${action} ${serviceName} (${scope})`;
  const job = createJob(label);
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, `${capitalize(action)} ${serviceName} in ${scope} scope...`);
    const result = await controlSystemdService(scope, serviceName, action, (line) => addJobLine(job, line));
    if (!result.ok) {
      throw new Error(result.output || `${label} failed`);
    }
    addJobLine(job, `${capitalize(action)} complete for ${serviceName}.`);
  });
});

app.get("/api/links", async (req, res) => {
  try {
    const forceLatest = req.query.forceLatest === "1" || req.query.forceLatest === "true";
    const fast = req.query.fast === "1" || req.query.fast === "true";
    const links = await readLinks();
    const hydrated = await Promise.all(links.map((link) => hydrateLink(link, { forceLatest, fast })));
    res.json(hydrated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/links/index", async (_req, res) => {
  try {
    const links = await readLinks();
    const payload = links.map((link) => {
      const dirPath = path.resolve(link.dirPath);
      return {
        id: link.id,
        createdAt: link.createdAt,
        dirPath,
        directoryName: path.basename(dirPath)
      };
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/links/:id", async (req, res) => {
  try {
    const forceLatest = req.query.forceLatest === "1" || req.query.forceLatest === "true";
    const fast = req.query.fast === "1" || req.query.fast === "true";
    const link = await getLinkById(req.params.id);
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }
    const hydrated = await hydrateLink(link, { forceLatest, fast });
    res.json(hydrated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    id: job.id,
    label: job.label,
    state: job.state,
    progressPercent: job.progressPercent,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lines: job.lines,
    error: job.error
  });
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.state !== "running") {
    return res.json({ ok: true, alreadyFinished: true, state: job.state });
  }

  if (typeof job.cancel === "function") {
    job.cancel();
    addJobLine(job, "Cancellation requested.");
    return res.json({ ok: true, cancelled: true });
  }

  return res.status(400).json({ ok: false, error: "Job is not cancellable" });
});

app.get("/api/auth/status", async (_req, res) => {
  try {
    const status = await getDockerAuthStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      loggedIn: false,
      username: null,
      message: error.message
    });
  }
});

app.post("/api/links", async (req, res) => {
  try {
    const inputPath = String(req.body?.dirPath || "").trim();
    if (!inputPath) {
      return res.status(400).json({ error: "dirPath is required" });
    }

    const dirPath = path.resolve(inputPath);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(400).json({ error: "Directory does not exist" });
    }

    const composeFile = await findComposeFile(dirPath);
    if (!composeFile) {
      return res.status(400).json({ error: "No compose file found in directory" });
    }

    const links = await readLinks();
    if (links.some((item) => item.dirPath === dirPath)) {
      return res.status(409).json({ error: "Directory is already linked" });
    }

    const next = {
      id: randomUUID(),
      dirPath,
      createdAt: new Date().toISOString()
    };

    links.push(next);
    await writeLinks(links);

    const hydrated = await hydrateLink(next);
    res.status(201).json(hydrated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scan a parent directory for all subdirectories containing compose files and
// bulk-add them as independent linked entries. Already-linked paths are skipped.
app.post("/api/links/scan", async (req, res) => {
  try {
    const inputPath = String(req.body?.dirPath || "").trim();
    if (!inputPath) {
      return res.status(400).json({ error: "dirPath is required" });
    }

    const rootDir = path.resolve(inputPath);
    const stat = await fs.stat(rootDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(400).json({ error: "Directory does not exist" });
    }

    const found = await scanForComposeDirs(rootDir);
    const links = await readLinks();
    const existing = new Set(links.map((l) => l.dirPath));

    const toAdd = found.filter((d) => !existing.has(d));
    for (const dirPath of toAdd) {
      links.push({ id: randomUUID(), dirPath, createdAt: new Date().toISOString() });
    }

    if (toAdd.length) {
      await writeLinks(links);
    }

    res.json({
      added: toAdd.length,
      skipped: found.length - toAdd.length,
      total: found.length,
      paths: toAdd
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/compose/import", async (req, res) => {
  try {
    const inputSourcePath = String(req.body?.sourcePath || "").trim();
    const inputSourceContent = String(req.body?.sourceContent || "");
    const inputSourceName = String(req.body?.sourceName || "").trim();
    const inputTargetDir = String(req.body?.targetDir || "").trim();
    const mode = String(req.body?.mode || "merge").toLowerCase();
    const overwrite = Boolean(req.body?.overwrite);
    const linkAfterImport = req.body?.linkAfterImport !== false;

    if (!inputSourcePath && !inputSourceContent) {
      return res.status(400).json({ error: "sourcePath or sourceContent is required" });
    }
    if (!inputTargetDir) {
      return res.status(400).json({ error: "targetDir is required" });
    }
    if (![
      "merge",
      "new"
    ].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'merge' or 'new'" });
    }

    const targetDir = path.resolve(inputTargetDir);

    let sourceRaw = inputSourceContent;
    let sourcePath = inputSourcePath ? path.resolve(inputSourcePath) : null;

    if (!sourceRaw) {
      const sourceStat = await fs.stat(sourcePath).catch(() => null);
      if (!sourceStat || !sourceStat.isFile()) {
        return res.status(400).json({ error: "Source compose file does not exist" });
      }
      sourceRaw = await fs.readFile(sourcePath, "utf8");
    }

    const sourceParsed = yaml.load(sourceRaw);
    if (!sourceParsed || typeof sourceParsed !== "object") {
      return res.status(400).json({ error: "Source compose file is invalid YAML" });
    }

    await fs.mkdir(targetDir, { recursive: true });

    const existingComposeName = await findComposeFile(targetDir);
    const composeFileName = existingComposeName || "docker-compose.yml";
    const targetComposePath = path.join(targetDir, composeFileName);

    if (mode === "new") {
      if (existingComposeName && !overwrite) {
        return res.status(409).json({
          error: "Target already has a compose file. Enable overwrite or use merge mode."
        });
      }

      await fs.writeFile(targetComposePath, sourceRaw, "utf8");
    } else {
      const targetRaw = existingComposeName
        ? await fs.readFile(targetComposePath, "utf8")
        : "";
      const targetParsed = targetRaw ? (yaml.load(targetRaw) || {}) : {};

      if (!targetParsed || typeof targetParsed !== "object") {
        return res.status(400).json({ error: "Target compose file is invalid YAML" });
      }

      const sourceServices =
        sourceParsed.services && typeof sourceParsed.services === "object"
          ? sourceParsed.services
          : {};
      const targetServices =
        targetParsed.services && typeof targetParsed.services === "object"
          ? targetParsed.services
          : {};

      const conflictingServices = Object.keys(sourceServices).filter((name) => name in targetServices);
      if (conflictingServices.length && !overwrite) {
        return res.status(409).json({
          error: "Service name conflicts found. Enable overwrite to replace existing services.",
          conflicts: conflictingServices
        });
      }

      const merged = { ...targetParsed };
      if (!merged.version && sourceParsed.version) {
        merged.version = sourceParsed.version;
      }

      merged.services = overwrite
        ? { ...targetServices, ...sourceServices }
        : { ...sourceServices, ...targetServices };

      for (const key of ["networks", "volumes", "secrets", "configs"]) {
        const sourceValue = sourceParsed[key];
        const targetValue = targetParsed[key];
        if (sourceValue && typeof sourceValue === "object") {
          if (targetValue && typeof targetValue === "object") {
            merged[key] = overwrite
              ? { ...targetValue, ...sourceValue }
              : { ...sourceValue, ...targetValue };
          } else {
            merged[key] = sourceValue;
          }
        }
      }

      const mergedYaml = yaml.dump(merged, { lineWidth: -1, noRefs: true });
      await fs.writeFile(targetComposePath, mergedYaml, "utf8");
    }

    let createdLink = false;
    if (linkAfterImport) {
      const links = await readLinks();
      if (!links.some((item) => path.resolve(item.dirPath) === targetDir)) {
        links.push({
          id: randomUUID(),
          dirPath: targetDir,
          createdAt: new Date().toISOString()
        });
        await writeLinks(links);
        createdLink = true;
      }
    }

    res.json({
      ok: true,
      mode,
      source: sourcePath || inputSourceName || "uploaded-content",
      targetDir,
      composeFile: composeFileName,
      composePath: targetComposePath,
      linked: linkAfterImport,
      createdLink
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/compose/services/:id", async (req, res) => {
  try {
    const link = await getLinkById(req.params.id);
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    const dirPath = path.resolve(link.dirPath);
    const composeFileName = await findComposeFile(dirPath);
    if (!composeFileName) {
      return res.status(400).json({ error: "No compose file found in linked directory" });
    }

    const composePath = path.join(dirPath, composeFileName);
    const yamlText = String(req.body?.yamlText || "").trim();
    const overwrite = Boolean(req.body?.overwrite);
    if (!yamlText) {
      return res.status(400).json({ error: "yamlText is required" });
    }

    const snippetRaw = yaml.load(yamlText);
    if (!snippetRaw || typeof snippetRaw !== "object") {
      return res.status(400).json({ error: "Invalid YAML snippet" });
    }

    const snippet =
      snippetRaw.services && typeof snippetRaw.services === "object"
        ? snippetRaw.services
        : snippetRaw;

    if (!snippet || typeof snippet !== "object" || Array.isArray(snippet)) {
      return res.status(400).json({ error: "Snippet must define one or more services" });
    }

    const serviceNames = Object.keys(snippet);
    if (!serviceNames.length) {
      return res.status(400).json({ error: "No services found in snippet" });
    }

    const composeRaw = await fs.readFile(composePath, "utf8");
    const composeParsed = yaml.load(composeRaw) || {};
    const currentServices =
      composeParsed.services && typeof composeParsed.services === "object"
        ? composeParsed.services
        : {};

    const conflicts = serviceNames.filter((name) => name in currentServices);
    if (conflicts.length && !overwrite) {
      return res.status(409).json({
        error: "Service already exists. Enable overwrite to replace existing service(s).",
        conflicts
      });
    }

    composeParsed.services = overwrite
      ? { ...currentServices, ...snippet }
      : { ...snippet, ...currentServices };

    const output = yaml.dump(composeParsed, { lineWidth: -1, noRefs: true });
    await fs.writeFile(composePath, output, "utf8");

    res.json({
      ok: true,
      composePath,
      addedServices: serviceNames,
      replacedServices: overwrite ? conflicts : []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/compose/services/:id/:serviceName", async (req, res) => {
  try {
    const link = await getLinkById(req.params.id);
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    const serviceName = String(req.params.serviceName || "").trim();
    if (!serviceName) {
      return res.status(400).json({ error: "serviceName is required" });
    }

    const dirPath = path.resolve(link.dirPath);
    const composeFileName = await findComposeFile(dirPath);
    if (!composeFileName) {
      return res.status(400).json({ error: "No compose file found in linked directory" });
    }

    const composePath = path.join(dirPath, composeFileName);
    const composeRaw = await fs.readFile(composePath, "utf8");
    const composeParsed = yaml.load(composeRaw) || {};
    const services =
      composeParsed.services && typeof composeParsed.services === "object"
        ? composeParsed.services
        : {};

    if (!(serviceName in services)) {
      return res.status(404).json({ error: "Service not found in compose file" });
    }

    delete services[serviceName];
    composeParsed.services = services;

    const output = yaml.dump(composeParsed, { lineWidth: -1, noRefs: true });
    await fs.writeFile(composePath, output, "utf8");

    res.json({ ok: true, composePath, removedService: serviceName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/links/:id", async (req, res) => {
  try {
    const links = await readLinks();
    const next = links.filter((item) => item.id !== req.params.id);
    if (next.length === links.length) {
      return res.status(404).json({ error: "Link not found" });
    }

    await writeLinks(next);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/update/all", async (_req, res) => {
  const job = createJob("Update all stacks");
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    const links = await readLinks();
    if (links.length === 0) {
      addJobLine(job, "No linked directories to update.");
      return;
    }

    for (const link of links) {
      const hydrated = await hydrateLink(link);
      const name = hydrated.directoryName || link.dirPath;

      if (!hydrated.available) {
        addJobLine(job, `[${name}] Skipped: ${hydrated.error || "Compose unavailable"}`);
        continue;
      }

      addJobLine(job, `[${name}] Starting update...`);
      const result = await updateComposeStack(hydrated.composePath, (line) => addJobLine(job, `[${name}] ${line}`));
      addJobLine(job, `[${name}] ${result.ok ? "Done" : "Failed"}`);
    }
  });
});

app.post("/api/update/link/:id", async (req, res) => {
  const link = await getLinkById(req.params.id);
  if (!link) {
    return res.status(404).json({ error: "Link not found" });
  }

  const hydrated = await hydrateLink(link);
  if (!hydrated.available) {
    return res.status(400).json({ error: hydrated.error || "Compose unavailable" });
  }

  const job = createJob(`Update compose ${hydrated.directoryName}`);
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, `Starting compose update for ${hydrated.directoryName}`);
    const result = await updateComposeStack(hydrated.composePath, (line) => addJobLine(job, line));
    if (!result.ok) {
      throw new Error("Compose update failed");
    }
    addJobLine(job, "Compose update complete.");
  });
});

app.post("/api/update/service/:id/:serviceName", async (req, res) => {
  const serviceName = String(req.params.serviceName || "").trim();
  if (!serviceName) {
    return res.status(400).json({ error: "serviceName is required" });
  }

  const link = await getLinkById(req.params.id);
  if (!link) {
    return res.status(404).json({ error: "Link not found" });
  }

  const hydrated = await hydrateLink(link);
  if (!hydrated.available) {
    return res.status(400).json({ error: hydrated.error || "Compose unavailable" });
  }

  const matching = hydrated.services.some((service) => service.name === serviceName);
  if (!matching) {
    return res.status(404).json({ error: "Service not found in compose" });
  }

  const job = createJob(`Update service ${serviceName}`);
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, `Starting service update: ${serviceName}`);
    const result = await updateService(hydrated.composePath, serviceName, (line) => addJobLine(job, line));
    if (!result.ok) {
      throw new Error("Service update failed");
    }
    addJobLine(job, `Service update complete: ${serviceName}`);
  });
});

app.post("/api/auth/docker/login", async (_req, res) => {
  const job = createJob("Docker login");
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, "Starting docker login...");
    addJobLine(job, "If prompted with a device code, open the URL and complete login in your browser.");
    const result = await runDockerLogin(job, (line) => addJobLine(job, line));
    if (!result.ok) {
      if (result.cancelled) {
        throw new Error("docker login cancelled");
      }
      throw new Error(`docker login failed: ${result.output || "unknown error"}`);
    }
    addJobLine(job, "docker login complete.");
  });
});

app.post("/api/auth/docker/logout", async (_req, res) => {
  const job = createJob("Docker logout");
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, "Running docker logout...");
    const result = await runDockerLogout((line) => addJobLine(job, line));
    if (!result.ok) {
      throw new Error(`docker logout failed: ${result.output || "unknown error"}`);
    }
    addJobLine(job, "docker logout complete.");
  });
});

app.post("/api/control/link/:id/:action", async (req, res) => {
  const action = String(req.params.action || "").toLowerCase();
  if (!["start", "stop", "restart"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  const link = await getLinkById(req.params.id);
  if (!link) {
    return res.status(404).json({ error: "Link not found" });
  }

  const hydrated = await hydrateLink(link);
  if (!hydrated.available) {
    return res.status(400).json({ error: hydrated.error || "Compose unavailable" });
  }

  const job = createJob(`${action} stack ${hydrated.directoryName}`);
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, `${action} stack: ${hydrated.directoryName}`);
    const result = await controlStack(hydrated.composePath, action, (line) => addJobLine(job, line));
    if (!result.ok) {
      throw new Error(`${action} stack failed`);
    }
    addJobLine(job, `${action} stack complete: ${hydrated.directoryName}`);
  });
});

app.post("/api/control/service/:id/:serviceName/:action", async (req, res) => {
  const action = String(req.params.action || "").toLowerCase();
  if (!["start", "stop", "restart"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  const serviceName = String(req.params.serviceName || "").trim();
  if (!serviceName) {
    return res.status(400).json({ error: "serviceName is required" });
  }

  const link = await getLinkById(req.params.id);
  if (!link) {
    return res.status(404).json({ error: "Link not found" });
  }

  const hydrated = await hydrateLink(link);
  if (!hydrated.available) {
    return res.status(400).json({ error: hydrated.error || "Compose unavailable" });
  }

  const matching = hydrated.services.some((service) => service.name === serviceName);
  if (!matching) {
    return res.status(404).json({ error: "Service not found in compose" });
  }

  const job = createJob(`${action} service ${serviceName}`);
  res.status(202).json({ ok: true, jobId: job.id });

  runJob(job, async () => {
    addJobLine(job, `${action} service: ${serviceName}`);
    const result = await controlService(hydrated.composePath, serviceName, action, (line) => addJobLine(job, line));
    if (!result.ok) {
      throw new Error(`${action} service failed`);
    }
    addJobLine(job, `${action} service complete: ${serviceName}`);
  });
});

app.listen(PORT, HOST, async () => {
  await ensureDataStore();
  await loadCacheFromDisk();
  const authState = APP_PASSWORD ? "enabled" : "disabled";
  console.log(`Quarterdeck running at http://${HOST}:${PORT} (app auth ${authState})`);
});

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const chunk of String(cookieHeader || "").split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function buildCookie(value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (typeof maxAgeSeconds === "number") {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  if (COOKIE_SECURE) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setSessionCookie(res, options = {}) {
  const remember = Boolean(options.remember);
  const expiresAt = Date.now() + (remember ? REMEMBER_LOGIN_DAYS * 24 * 60 * 60 * 1000 : SESSION_TTL_MS);
  const token = signSessionToken({
    sid: randomUUID(),
    exp: expiresAt,
    rm: remember ? 1 : 0
  });
  const maxAgeSeconds = remember ? Math.max(60, Math.floor((REMEMBER_LOGIN_DAYS * 24 * 60 * 60 * 1000) / 1000)) : undefined;
  res.setHeader("Set-Cookie", buildCookie(encodeURIComponent(token), maxAgeSeconds));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", buildCookie("", 0));
}

function signSessionToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readSessionToken(rawToken) {
  const token = String(rawToken || "");
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
  if (!safeEquals(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function hasValidSession(req) {
  const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE_NAME];
  if (!token) {
    return false;
  }

  return Boolean(readSessionToken(token));
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  const firstForwarded = forwarded.split(",")[0].trim();
  if (firstForwarded) {
    return firstForwarded;
  }
  return String(req.socket?.remoteAddress || "unknown");
}

function checkLoginThrottle(clientIp) {
  pruneLoginThrottle();
  const state = loginRateLimitByIp.get(clientIp);
  if (!state) {
    return { locked: false, retryAt: 0 };
  }

  if (state.lockedUntil > Date.now()) {
    return { locked: true, retryAt: state.lockedUntil };
  }

  return { locked: false, retryAt: 0 };
}

function recordLoginFailure(clientIp) {
  const now = Date.now();
  const state = loginRateLimitByIp.get(clientIp) || {
    attempts: [],
    lockedUntil: 0,
    lastSeenAt: now
  };

  state.lastSeenAt = now;
  state.attempts = state.attempts.filter((at) => at > now - LOGIN_WINDOW_MS);
  state.attempts.push(now);

  if (state.attempts.length >= LOGIN_MAX_ATTEMPTS) {
    state.lockedUntil = now + LOGIN_LOCKOUT_MS;
    state.attempts = [];
  }

  loginRateLimitByIp.set(clientIp, state);
}

function clearLoginFailures(clientIp) {
  loginRateLimitByIp.delete(clientIp);
}

function pruneLoginThrottle() {
  const now = Date.now();
  for (const [ip, state] of loginRateLimitByIp.entries()) {
    const hasRecentAttempts = Array.isArray(state.attempts)
      && state.attempts.some((at) => at > now - LOGIN_WINDOW_MS);
    const stillLocked = Number(state.lockedUntil || 0) > now;

    if (stillLocked) {
      continue;
    }

    if (!hasRecentAttempts && now - Number(state.lastSeenAt || 0) > LOGIN_WINDOW_MS) {
      loginRateLimitByIp.delete(ip);
    }
  }
}

async function listSystemdServices(scope) {
  const baseArgs = scope === "user" ? ["--user"] : [];

  const unitsResult = await runSystemctl([
    ...baseArgs,
    "list-units",
    "--type=service",
    "--all",
    "--no-legend",
    "--no-pager",
    "--plain"
  ]);

  const unitFilesResult = await runSystemctl([
    ...baseArgs,
    "list-unit-files",
    "--type=service",
    "--no-legend",
    "--no-pager",
    "--plain"
  ]);

  const unitsByName = parseSystemctlUnits(unitsResult.ok ? unitsResult.output : "");
  const enabledByName = parseSystemctlUnitFiles(unitFilesResult.ok ? unitFilesResult.output : "");

  const names = new Set([...unitsByName.keys(), ...enabledByName.keys()]);
  const services = Array.from(names)
    .map((name) => {
      const unit = unitsByName.get(name) || {};
      const enabledState = enabledByName.get(name) || "unknown";
      const activeState = unit.activeState || "inactive";
      const subState = unit.subState || "dead";

      return {
        scope,
        name,
        description: unit.description || "-",
        activeState,
        subState,
        running: activeState === "active" && subState === "running",
        enabledState,
        enabled: enabledState === "enabled" || enabledState === "enabled-runtime"
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  let error = null;
  if (!unitsResult.ok && !unitFilesResult.ok) {
    error =
      scope === "user"
        ? "Could not query user services (user systemd session may be unavailable)."
        : "Could not query system services.";
  }

  return { services, error };
}

function parseSystemctlUnits(output) {
  const map = new Map();
  const lines = stripControlChars(String(output || ""))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Legend:"));

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }

    const [name, , activeState, subState, ...descriptionParts] = parts;
    if (!name.endsWith(".service")) {
      continue;
    }

    map.set(name, {
      activeState,
      subState,
      description: stripControlChars(descriptionParts.join(" "))
    });
  }

  return map;
}

function parseSystemctlUnitFiles(output) {
  const map = new Map();
  const lines = stripControlChars(String(output || ""))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("UNIT FILE"))
    .filter((line) => !line.startsWith("0 unit files listed"));

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }

    const [name, enabledState] = parts;
    if (!name.endsWith(".service")) {
      continue;
    }

    map.set(name, enabledState || "unknown");
  }

  return map;
}

function stripControlChars(text) {
  return String(text || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function createJob(label) {
  const job = {
    id: randomUUID(),
    label,
    state: "running",
    progressPercent: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    cancel: null,
    lines: []
  };

  jobs.set(job.id, job);
  return job;
}

function runJob(job, work) {
  Promise.resolve()
    .then(() => work())
    .then(() => {
      job.state = "completed";
      job.finishedAt = new Date().toISOString();
      if (job.progressPercent === null) {
        job.progressPercent = 100;
      }
      addJobLine(job, "Job finished.");
    })
    .catch((error) => {
      job.state = "failed";
      job.finishedAt = new Date().toISOString();
      job.error = error.message;
      addJobLine(job, `ERROR: ${error.message}`);
    });
}

function addJobLine(job, text) {
  const raw = stripAnsi(String(text || ""));
  const lines = raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    job.lines.push(line);

    const matches = line.match(/(\d{1,3}(?:\.\d+)?)%/g);
    if (matches && matches.length > 0) {
      const last = matches[matches.length - 1].replace("%", "");
      const numeric = Number(last);
      if (Number.isFinite(numeric)) {
        job.progressPercent = Math.min(100, Math.max(0, numeric));
      }
    }

    if (job.lines.length > JOB_MAX_LINES) {
      job.lines.shift();
    }
  }
}

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

async function ensureDataStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const hasFile = await fs
    .access(LINKS_FILE)
    .then(() => true)
    .catch(() => false);

  if (!hasFile) {
    await writeLinks([]);
  }
}

async function readLinks() {
  await ensureDataStore();
  const raw = await fs.readFile(LINKS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLinks(links) {
  await fs.writeFile(LINKS_FILE, `${JSON.stringify(links, null, 2)}\n`, "utf8");
}

async function getLinkById(id) {
  const links = await readLinks();
  return links.find((item) => item.id === id);
}

async function hydrateLink(link, options = {}) {
  const dirPath = path.resolve(link.dirPath);
  const directoryName = path.basename(dirPath);

  const composeFileName = await findComposeFile(dirPath);
  if (!composeFileName) {
    return {
      id: link.id,
      createdAt: link.createdAt,
      dirPath,
      directoryName,
      available: false,
      error: "No compose file found"
    };
  }

  const composePath = path.join(dirPath, composeFileName);

  try {
    const fileContent = await fs.readFile(composePath, "utf8");
    const parsed = yaml.load(fileContent) || {};
    const baseServices = parseServices(parsed.services || {});
    const services = new Array(baseServices.length);

    // Keep UI/service order stable by preserving compose order in output,
    // while optionally checking higher-priority images first.
    const indexedServices = baseServices.map((service, index) => ({ service, index }));
    const toProcess = options.forceLatest
      ? [...indexedServices].sort((a, b) => registryPriority(a.service.image) - registryPriority(b.service.image))
      : indexedServices;

    await Promise.all(
      toProcess.map(async ({ service, index }) => {
        services[index] = await enrichServiceVersion(composePath, service, options);
      })
    );

    return {
      id: link.id,
      createdAt: link.createdAt,
      dirPath,
      directoryName,
      composeFile: composeFileName,
      composePath,
      available: true,
      updateCount: services.filter((service) => service.version?.updateAvailable).length,
      services
    };
  } catch (error) {
    return {
      id: link.id,
      createdAt: link.createdAt,
      dirPath,
      directoryName,
      composeFile: composeFileName,
      composePath,
      available: false,
      error: `Could not parse compose file: ${error.message}`
    };
  }
}

async function findComposeFile(dirPath) {
  for (const fileName of COMPOSE_CANDIDATES) {
    const fullPath = path.join(dirPath, fileName);
    const exists = await fs
      .access(fullPath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      return fileName;
    }
  }

  return null;
}

// Walk a directory tree, collecting any subdirectory (or the root itself) that
// contains a recognised compose file. Stops descending once a compose file is
// found in a dir (no nested stacks). Skips hidden dirs and node_modules.
async function scanForComposeDirs(rootDir, maxDepth = 5) {
  const found = [];

  const walk = async (dir, depth) => {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission error or broken symlink – skip silently
    }

    const hasCompose = COMPOSE_CANDIDATES.some((name) =>
      entries.some((e) => e.isFile() && e.name === name)
    );

    if (hasCompose) {
      found.push(dir);
      return; // don't descend – nested stacks are unusual and almost never intentional
    }

    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => walk(path.join(dir, e.name), depth + 1))
    );
  };

  await walk(rootDir, 0);
  return found;
}

function parseServices(rawServices) {
  return Object.entries(rawServices).map(([name, config]) => {
    const safeConfig = config && typeof config === "object" ? config : {};

    return {
      name,
      image: safeConfig.image || null,
      containerName: safeConfig.container_name || null,
      ports: toArray(safeConfig.ports),
      volumes: toArray(safeConfig.volumes),
      environment: toFlatEnvironment(safeConfig.environment),
      networks: toArray(safeConfig.networks),
      restart: safeConfig.restart || null,
      dependsOn: toArray(safeConfig.depends_on),
      command: safeConfig.command || null
    };
  });
}

function toArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    return Object.entries(value).map(([key, val]) => `${key}:${JSON.stringify(val)}`);
  }

  return [String(value)];
}

function toFlatEnvironment(environment) {
  if (!environment) {
    return [];
  }

  if (Array.isArray(environment)) {
    return environment;
  }

  if (typeof environment === "object") {
    return Object.entries(environment).map(([key, val]) => `${key}=${val}`);
  }

  return [String(environment)];
}

async function enrichServiceVersion(composePath, service, options = {}) {
  const imageRef = normalizeImageRef(service.image);
  const currentInfo = await getCurrentVersionInfo(composePath, service.name, imageRef);

  if (!imageRef) {
    return {
      ...service,
      runtime: {
        isRunning: currentInfo.isRunning,
        state: currentInfo.runtimeState || "unknown",
        containerId: currentInfo.containerId || null
      },
      version: {
        current: "n/a",
        latest: "n/a",
        status: "no-image",
        reason: "Service has no image field (build-only or inherited); runtime is read from container state.",
        updateAvailable: false
      }
    };
  }

  if (options.fast) {
    return {
      ...service,
      runtime: {
        isRunning: currentInfo.isRunning,
        state: currentInfo.runtimeState || "unknown",
        containerId: currentInfo.containerId || null
      },
      version: {
        imageRef,
        current: currentInfo.currentLabel,
        latest: "pending",
        currentDigest: currentInfo.currentDigest,
        latestDigest: null,
        currentImageId: currentInfo.currentImageId,
        status: "pending",
        reason: "Latest registry digest check is running in background.",
        updateAvailable: false
      }
    };
  }

  const latestInfo = await getLatestDigestInfo(imageRef, options);

  const compareCurrent = currentInfo.currentDigest || currentInfo.localDigest;
  const updateAvailable = Boolean(
    compareCurrent && latestInfo.latestDigest && compareCurrent !== latestInfo.latestDigest
  );

  let status = "up-to-date";
  let reason = "Local and remote digests match.";

  if (updateAvailable) {
    status = "update-available";
    reason = "Remote digest differs from local/running digest.";
  } else if (!latestInfo.latestDigest) {
    status = "unknown";
    reason = latestInfo.reason || "Could not resolve remote digest.";
  } else if (!currentInfo.currentImageId && !currentInfo.localImageId) {
    status = "not-running";
    reason = "No running container or local image found for this service image.";
  }

  return {
    ...service,
    runtime: {
      isRunning: currentInfo.isRunning,
      state: currentInfo.runtimeState || "unknown",
      containerId: currentInfo.containerId || null
    },
    version: {
      imageRef,
      current: currentInfo.currentLabel,
      latest: latestInfo.latestLabel,
      currentDigest: currentInfo.currentDigest,
      latestDigest: latestInfo.latestDigest,
      latestSource: latestInfo.sourceRef || null,
      latestSourceRegistry: latestInfo.sourceRegistry || null,
      currentImageId: currentInfo.currentImageId,
      status,
      reason,
      updateAvailable
    }
  };
}

function normalizeImageRef(imageRef) {
  const trimmed = String(imageRef || "").trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

async function getCurrentVersionInfo(composePath, serviceName, imageRef) {
  let localImageId = null;
  let localDigest = null;

  if (imageRef) {
    const localImageResult = await runDocker([
      "image",
      "inspect",
      imageRef,
      "--format",
      "{{json .Id}} {{json .RepoDigests}}"
    ]);

    if (localImageResult.ok) {
      const [idRaw, repoDigestsRaw] = splitJsonPair(localImageResult.output);
      localImageId = idRaw || null;
      localDigest = pickDigestFromRepoDigests(repoDigestsRaw, imageRef);
    }
  }

  const containerIdResult = await runDockerCompose(composePath, ["ps", "-q", serviceName]);
  let containerId = String(containerIdResult.output || "").trim();
  if (containerId.includes("\n")) {
    containerId = containerId.split("\n")[0].trim();
  }

  if (!containerId) {
    containerId = await findContainerIdFallback(serviceName, imageRef);
  }

  let currentImageId = null;
  let currentDigest = null;
  let runtimeState = null;
  let isRunning = false;

  if (containerId) {
    const inspectContainerResult = await runDocker([
      "inspect",
      containerId,
      "--format",
      "{{json .Image}} {{json .State.Status}}"
    ]);

    if (inspectContainerResult.ok) {
      const [imageRaw, stateRaw] = splitJsonPair(inspectContainerResult.output);
      currentImageId = imageRaw || null;
      runtimeState = typeof stateRaw === "string" ? stateRaw : null;
      isRunning = runtimeState === "running";
    }

    if (currentImageId && imageRef) {
      const currentDigestResult = await runDocker([
        "image",
        "inspect",
        currentImageId,
        "--format",
        "{{json .RepoDigests}}"
      ]);

      if (currentDigestResult.ok) {
        const repoDigests = safeJson(currentDigestResult.output);
        currentDigest = pickDigestFromRepoDigests(repoDigests, imageRef);
      }
    }
  }

  const currentLabel = currentDigest || localDigest || currentImageId || localImageId || imageRef || containerId || "n/a";

  return {
    containerId: containerId || null,
    runtimeState,
    isRunning,
    currentImageId,
    currentDigest,
    localImageId,
    localDigest,
    currentLabel
  };
}

async function findContainerIdFallback(serviceName, imageRef) {
  const labelLookup = await runDocker([
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.service=${serviceName}`,
    "--format",
    "{{.ID}} {{.Image}}"
  ]);

  if (labelLookup.ok) {
    const lines = String(labelLookup.output || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const imageBase = imageRef ? stripTagAndDigest(imageRef) : "";
    const preferred = imageBase
      ? lines.find((line) => {
          const parts = line.split(/\s+/);
          const image = parts.slice(1).join(" ");
          return image.startsWith(imageBase);
        })
      : "";

    const picked = preferred || lines[0] || "";
    const id = picked.split(/\s+/)[0] || "";
    if (id) {
      return id;
    }
  }

  return "";
}

async function getLatestDigestInfo(imageRef, options = {}) {
  const forceLatest = Boolean(options.forceLatest);
  const cached = latestDigestCache.get(imageRef);
  // Use per-entry TTL if set (e.g. shorter window for rate-limited failures), else global TTL.
  const ttl = (cached?.ttlMs != null) ? cached.ttlMs : (Number.isFinite(LATEST_DIGEST_TTL_MS) ? LATEST_DIGEST_TTL_MS : 24 * 60 * 60 * 1000);
  const isFresh = cached && Date.now() - cached.checkedAt < Math.max(10 * 1000, ttl);

  // Normal refresh: serve from cache if fresh.
  if (!forceLatest && isFresh) {
    return {
      latestDigest: cached.digest,
      latestLabel: cached.digest || "unknown",
      reason: cached.digest ? "Using cached registry digest." : cached.reason || "Cached unknown status.",
      sourceRef: cached.sourceRef || null,
      sourceRegistry: cached.sourceRegistry || null
    };
  }

  // forceLatest: still respect a short minimum recheck window per image to
  // avoid burning rate-limit quota when Check Updates is clicked repeatedly.
  if (forceLatest && cached && Date.now() - cached.checkedAt < FORCE_LATEST_MIN_RECHECK_MS) {
    return {
      latestDigest: cached.digest,
      latestLabel: cached.digest || "unknown",
      reason: cached.digest
        ? `Using recent registry digest (checked within last ${Math.round(FORCE_LATEST_MIN_RECHECK_MS / 60000)}m).`
        : cached.reason || "Cached unknown status.",
      sourceRef: cached.sourceRef || null,
      sourceRegistry: cached.sourceRegistry || null
    };
  }

  // Deduplicate concurrent requests for the same image.
  if (latestDigestInFlight.has(imageRef)) {
    return latestDigestInFlight.get(imageRef);
  }

  // Run through the serialized queue so we don't blast the registry in parallel.
  const lookupPromise = enqueueRegistryCheck(() => getLatestDigestInfoUncached(imageRef, cached));
  latestDigestInFlight.set(imageRef, lookupPromise);

  try {
    return await lookupPromise;
  } finally {
    latestDigestInFlight.delete(imageRef);
  }
}

async function getLatestDigestInfoUncached(imageRef, cached) {
  const candidates = getRemoteLookupCandidates(imageRef);
  if (!candidates.length) {
    return {
      latestDigest: null,
      latestLabel: "unknown",
      reason: "GHCR-only mode enabled and no GHCR reference could be derived for this image.",
      sourceRef: null,
      sourceRegistry: null
    };
  }

  let lastReason = "Remote digest lookup failed.";

  for (const candidateRef of candidates) {
    // Skip GHCR refs we already know don't host this image — avoids wasted calls every cycle.
    if (candidateRef.startsWith("ghcr.io/")) {
      const negAt = ghcrNegativeCache.get(candidateRef);
      if (negAt && Date.now() - negAt < GHCR_NEGATIVE_TTL_MS) {
        lastReason = "GHCR candidate skipped (previously not found, retry in 24h).";
        continue;
      }
    }

    const candidateResult = await getLatestDigestFromRegistry(candidateRef);

    // Remember GHCR misses so we don't re-probe them until the TTL expires.
    if (candidateResult.notFound && candidateRef.startsWith("ghcr.io/")) {
      ghcrNegativeCache.set(candidateRef, Date.now());
      scheduleCacheSave();
    }

    if (candidateResult.latestDigest) {
      const usedAlt = candidateRef !== imageRef;
      const successReason = usedAlt
        ? `Latest digest resolved via ${candidateRef}.`
        : candidateResult.reason || null;

      latestDigestCache.set(imageRef, {
        digest: candidateResult.latestDigest,
        reason: successReason,
        sourceRef: candidateRef,
        sourceRegistry: inferRegistryLabel(candidateRef),
        checkedAt: Date.now()
      });
      scheduleCacheSave();

      return {
        latestDigest: candidateResult.latestDigest,
        latestLabel: candidateResult.latestDigest,
        reason: successReason,
        sourceRef: candidateRef,
        sourceRegistry: inferRegistryLabel(candidateRef)
      };
    }

    if (candidateResult.reason) {
      lastReason = candidateResult.reason;
    }
  }

  if (cached?.digest) {
    return {
      latestDigest: cached.digest,
      latestLabel: cached.digest,
      reason: `Using cached digest. Latest check failed: ${lastReason}`,
      sourceRef: cached.sourceRef || null,
      sourceRegistry: cached.sourceRegistry || null
    };
  }

  const isRateLimited = lastReason.toLowerCase().includes("rate limit");
  latestDigestCache.set(imageRef, {
    digest: null,
    reason: lastReason,
    sourceRef: null,
    sourceRegistry: null,
    checkedAt: Date.now(),
    // Rate-limited entries retry sooner (1h) so they recover when the window resets
    ttlMs: isRateLimited ? RATE_LIMIT_RETRY_MS : null
  });
  scheduleCacheSave();

  return {
    latestDigest: null,
    latestLabel: "unknown",
    reason: lastReason,
    sourceRef: null,
    sourceRegistry: null
  };
}

function getRemoteLookupCandidates(imageRef) {
  const normalized = String(imageRef || "").trim();
  if (!normalized) {
    return [];
  }

  const ghcrCandidate = toGhcrCandidate(normalized);

  if (GHCR_ONLY) {
    return ghcrCandidate ? [ghcrCandidate] : [];
  }

  if (!PREFER_GHCR) {
    return [normalized];
  }

  if (ghcrCandidate && ghcrCandidate !== normalized) {
    return [ghcrCandidate, normalized];
  }

  return [normalized];
}

function toGhcrCandidate(imageRef) {
  if (!imageRef) {
    return null;
  }

  if (imageRef.startsWith("ghcr.io/")) {
    return imageRef;
  }

  if (imageRef.startsWith("docker.io/")) {
    const rest = imageRef.slice("docker.io/".length);
    // Don't guess GHCR for official bare images like docker.io/nginx — no org/name slash
    if (!rest.split(":")[0].includes("/")) return null;
    return `ghcr.io/${rest}`;
  }

  if (imageRef.startsWith("index.docker.io/")) {
    const rest = imageRef.slice("index.docker.io/".length);
    if (!rest.split(":")[0].includes("/")) return null;
    return `ghcr.io/${rest}`;
  }

  const firstSegment = imageRef.split("/")[0] || "";
  // Only use "." for registry detection — ":" also appears in bare image tags like "nginx:latest"
  const hasRegistryPrefix = firstSegment.includes(".") || firstSegment === "localhost";
  if (hasRegistryPrefix) {
    return null;
  }

  // Don't guess GHCR for official bare images with no org/name — e.g. "nginx:latest", "mariadb"
  const basePath = imageRef.split(":")[0].split("@")[0];
  if (!basePath.includes("/")) {
    return null;
  }

  return `ghcr.io/${imageRef}`;
}

async function getLatestDigestFromRegistry(imageRef) {
  const buildxArgs = [
    "buildx", "imagetools", "inspect",
    "--format", "{{json .Manifest.Digest}}",
    imageRef
  ];

  const buildx = await runDocker(buildxArgs);

  if (buildx.ok) {
    const digest = safeJson(buildx.output);
    if (typeof digest === "string" && digest.startsWith("sha256:")) {
      return { latestDigest: digest, latestLabel: digest, reason: null, notFound: false };
    }
  }

  // Rate-limited: return immediately, don't also try manifest inspect (same rate limit)
  if (isRateLimitOutput(buildx.output)) {
    return { latestDigest: null, latestLabel: "unknown", reason: explainManifestFailure(buildx.output), notFound: false };
  }

  // Image not found: skip manifest inspect (same outcome, saves a wasted request)
  if (isNotFoundOutput(buildx.output)) {
    return { latestDigest: null, latestLabel: "unknown", reason: "Image or tag not found in registry.", notFound: true };
  }

  const result = await runDocker(["manifest", "inspect", imageRef]);
  if (!result.ok) {
    return { latestDigest: null, latestLabel: "unknown", reason: explainManifestFailure(result.output), notFound: isNotFoundOutput(result.output) };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.output || "{}");
  } catch {
    return { latestDigest: null, latestLabel: "unknown", reason: "Manifest JSON parse failed.", notFound: false };
  }

  const fallbackDigest = pickManifestDigest(parsed);
  return {
    latestDigest: fallbackDigest,
    latestLabel: fallbackDigest || "unknown",
    reason: fallbackDigest ? null : "Remote manifest did not include a comparable digest.",
    notFound: false
  };
}

function inferRegistryLabel(imageRef) {
  const ref = String(imageRef || "").trim().toLowerCase();
  if (!ref) {
    return "unknown";
  }

  if (ref.startsWith("ghcr.io/")) {
    return "ghcr";
  }

  if (ref.startsWith("docker.io/") || ref.startsWith("index.docker.io/")) {
    return "dockerhub";
  }

  const parts = ref.split("/");
  const firstSegment = parts[0] || "";
  const hasPath = parts.length > 1;
  // A registry prefix has a dot (lscr.io, quay.io), is "localhost", or has colon:port FOLLOWED by a path
  // Don't count ":" in bare image tags like "mariadb:latest" (no slash after)
  const hasRegistryPrefix = firstSegment.includes(".") || firstSegment === "localhost" || (hasPath && firstSegment.includes(":"));
  if (hasRegistryPrefix) {
    // Return the actual hostname so the badge shows "lscr.io", "quay.io", etc.
    return firstSegment;
  }

  return "dockerhub";
}

function explainManifestFailure(output) {
  const text = String(output || "").toLowerCase();
  if (text.includes("unauthorized") || text.includes("denied")) {
    return "Registry auth required or access denied for this image.";
  }
  if (text.includes("toomanyrequests") || text.includes("rate limit")) {
    return "Registry rate limit reached while checking latest digest.";
  }
  if (text.includes("not found") || text.includes("manifest unknown") || text.includes("no such")) {
    return "Image or tag not found in registry.";
  }

  return "Remote digest lookup failed.";
}

function isRateLimitOutput(output) {
  const text = String(output || "").toLowerCase();
  return text.includes("toomanyrequests") || text.includes("rate limit");
}

function isNotFoundOutput(output) {
  const text = String(output || "").toLowerCase();
  return text.includes("not found") || text.includes("manifest unknown") || text.includes("no such");
}

function pickManifestDigest(manifest) {
  if (manifest?.config?.digest) {
    return manifest.config.digest;
  }

  if (Array.isArray(manifest?.manifests) && manifest.manifests.length > 0) {
    const preferredArch = mapNodeArchToDockerArch(process.arch);
    const preferredOs = process.platform === "linux" ? "linux" : process.platform;

    const exact = manifest.manifests.find((entry) => {
      const platform = entry?.platform || {};
      return platform.os === preferredOs && platform.architecture === preferredArch;
    });

    if (exact?.digest) {
      return exact.digest;
    }

    if (manifest.manifests[0]?.digest) {
      return manifest.manifests[0].digest;
    }
  }

  return null;
}

function mapNodeArchToDockerArch(nodeArch) {
  if (nodeArch === "x64") {
    return "amd64";
  }
  if (nodeArch === "arm64") {
    return "arm64";
  }
  return nodeArch;
}

function pickDigestFromRepoDigests(repoDigests, imageRef) {
  if (!Array.isArray(repoDigests) || repoDigests.length === 0) {
    return null;
  }

  const imageWithoutTag = stripTagAndDigest(imageRef);
  const matching = repoDigests.find((entry) => String(entry).startsWith(`${imageWithoutTag}@`));
  const selected = matching || repoDigests[0];
  const atIndex = String(selected).indexOf("@");
  if (atIndex === -1) {
    return null;
  }

  return selected.slice(atIndex + 1);
}

// Lower number = checked sooner when forceLatest is active.
// 0 = never checked or rate-limited/unknown (highest need)
// 1 = was rate-limited previously
// 2 = has a good cached digest (up-to-date, lower urgency)
function registryPriority(imageRef) {
  if (!imageRef) return 99;
  const cached = latestDigestCache.get(imageRef);
  if (!cached) return 0;
  if (!cached.digest) {
    const reason = String(cached.reason || "").toLowerCase();
    return reason.includes("rate limit") ? 0 : 1;
  }
  return 2;
}

function stripTagAndDigest(imageRef) {
  const noDigest = String(imageRef || "").split("@")[0];
  const lastSlash = noDigest.lastIndexOf("/");
  const lastColon = noDigest.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return noDigest.slice(0, lastColon);
  }

  return noDigest;
}

function splitJsonPair(output) {
  const raw = String(output || "").trim();
  if (!raw) {
    return [null, null];
  }

  const boundary = raw.indexOf(" ");
  if (boundary === -1) {
    return [safeJson(raw), null];
  }

  const first = raw.slice(0, boundary).trim();
  const second = raw.slice(boundary + 1).trim();
  return [safeJson(first), safeJson(second)];
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function updateComposeStack(composePath, onOutput) {
  const pull = await runDockerCompose(composePath, ["pull"], onOutput);
  if (!pull.ok) {
    return {
      ok: false,
      step: "pull",
      output: pull.output
    };
  }

  const up = await runDockerCompose(composePath, ["up", "-d", "--remove-orphans"], onOutput);
  return {
    ok: up.ok,
    step: "up",
    output: [pull.output, up.output].filter(Boolean).join("\n\n")
  };
}

async function updateService(composePath, serviceName, onOutput) {
  const pull = await runDockerCompose(composePath, ["pull", serviceName], onOutput);
  if (!pull.ok) {
    return {
      ok: false,
      step: "pull",
      output: pull.output
    };
  }

  const up = await runDockerCompose(composePath, ["up", "-d", serviceName], onOutput);
  return {
    ok: up.ok,
    step: "up",
    output: [pull.output, up.output].filter(Boolean).join("\n\n")
  };
}

async function controlStack(composePath, action, onOutput) {
  if (action === "start") {
    return runDockerCompose(composePath, ["up", "-d"], onOutput);
  }
  if (action === "stop") {
    return runDockerCompose(composePath, ["stop"], onOutput);
  }
  if (action === "restart") {
    return runDockerCompose(composePath, ["restart"], onOutput);
  }

  return { ok: false, output: `Unsupported stack action: ${action}` };
}

async function controlService(composePath, serviceName, action, onOutput) {
  if (action === "start") {
    return runDockerCompose(composePath, ["up", "-d", serviceName], onOutput);
  }
  if (action === "stop") {
    return runDockerCompose(composePath, ["stop", serviceName], onOutput);
  }
  if (action === "restart") {
    return runDockerCompose(composePath, ["restart", serviceName], onOutput);
  }

  return { ok: false, output: `Unsupported service action: ${action}` };
}

async function runDockerCompose(composePath, args, onOutput) {
  const workingDir = path.dirname(composePath);
  const fullArgs = ["compose", "-f", composePath, ...args];

  return runCommand("docker", fullArgs, workingDir, onOutput);
}

async function runDocker(args, onOutput) {
  return runCommand("docker", args, process.cwd(), onOutput);
}

async function runSystemctl(args, onOutput) {
  return runCommand("systemctl", args, process.cwd(), onOutput);
}

async function controlSystemdService(scope, serviceName, action, onOutput) {
  const baseArgs = scope === "user" ? ["--user"] : [];
  return runSystemctl([...baseArgs, action, serviceName], onOutput);
}

function capitalize(text) {
  const value = String(text || "");
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

async function runDockerLogin(job, onOutput) {
  const scriptResult = await runCancellableCommand(
    job,
    "script",
    ["-q", "-e", "-c", "docker login", "/dev/null"],
    process.cwd(),
    onOutput
  );

  if (scriptResult.ok) {
    return scriptResult;
  }

  const output = String(scriptResult.output || "").toLowerCase();
  const scriptUnavailable =
    output.includes("failed to run script") ||
    output.includes("no such file") ||
    output.includes("not found");

  if (scriptUnavailable) {
    if (onOutput) {
      onOutput("Pseudo-TTY tool not available, attempting direct docker login...");
    }

    const direct = await runDocker(["login"], onOutput);
    if (!direct.ok && String(direct.output || "").includes("non-TTY")) {
      return {
        ok: false,
        output:
          "Docker requires an interactive TTY for login on this host. Run 'docker login' in a terminal session once, then refresh auth status."
      };
    }

    return direct;
  }

  return scriptResult;
}

async function runCancellableCommand(job, command, args, cwd, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env
    });

    let output = "";
    let cancelled = false;

    job.cancel = () => {
      if (child.exitCode !== null || child.killed) {
        return;
      }

      cancelled = true;
      if (onOutput) {
        onOutput("Cancelling interactive command...");
      }
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGKILL");
        }
      }, 1500);
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onOutput) {
        onOutput(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onOutput) {
        onOutput(text);
      }
    });

    child.on("error", (error) => {
      job.cancel = null;
      resolve({ ok: false, output: `Failed to run ${command}: ${error.message}` });
    });

    child.on("close", (code) => {
      job.cancel = null;
      if (cancelled) {
        resolve({ ok: false, cancelled: true, output: output.trim() || "Cancelled" });
        return;
      }

      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}

async function runDockerLogout(onOutput) {
  const attempts = [
    ["logout"],
    ["logout", "docker.io"],
    ["logout", "https://index.docker.io/v1/"],
    ["logout", "ghcr.io"]
  ];

  let combinedOutput = "";
  let anySuccess = false;

  for (const args of attempts) {
    const result = await runDocker(args, onOutput);
    combinedOutput += `${result.output || ""}\n`;
    if (result.ok) {
      anySuccess = true;
    }
  }

  if (anySuccess) {
    return { ok: true, output: combinedOutput.trim() };
  }

  const lower = combinedOutput.toLowerCase();
  if (lower.includes("not logged in") || lower.includes("credentials not found")) {
    return { ok: true, output: combinedOutput.trim() };
  }

  return { ok: false, output: combinedOutput.trim() };
}

async function getDockerAuthStatus() {
  const info = await runDocker(["info"]);
  if (!info.ok) {
    return {
      loggedIn: false,
      username: null,
      message: "Could not read docker info"
    };
  }

  const usernameMatch = String(info.output || "").match(/^\s*Username:\s*(.+)$/im);
  const username = usernameMatch ? String(usernameMatch[1] || "").trim() : "";

  return {
    loggedIn: Boolean(username),
    username: username || null,
    message: username ? "Authenticated" : "Not authenticated"
  };
}

async function runCommand(command, args, cwd, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onOutput) {
        onOutput(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onOutput) {
        onOutput(text);
      }
    });

    child.on("error", (error) => {
      const message = `Failed to run ${command}: ${error.message}`;
      if (onOutput) {
        onOutput(message);
      }
      resolve({ ok: false, output: message });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        output: output.trim()
      });
    });
  });
}
