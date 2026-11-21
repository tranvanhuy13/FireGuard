/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Validation logic from deploy/launcher/build.mjs
 */
function validateOrigin(name, rawValue) {
  const url = new URL(rawValue || "");
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be a public HTTPS origin without a path`);
  }
  return url.origin;
}

/**
 * Probe logic from deploy/launcher/launcher.js
 */
async function probe(url, service, customFetch = fetch) {
  try {
    const response = await customFetch(url, {
      cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === "ready" && (service !== "frontend" || data.service === "frontend");
  } catch {
    return false;
  }
}

test("Launcher build: valid public HTTPS origin passes validation", () => {
  assert.equal(validateOrigin("FRONTEND_URL", "https://fireguard.onrender.com"), "https://fireguard.onrender.com");
  assert.equal(validateOrigin("BACKEND_URL", "https://api-fireguard.onrender.com"), "https://api-fireguard.onrender.com");
  assert.equal(validateOrigin("FRONTEND_URL", "https://app.example.com:8443"), "https://app.example.com:8443");
});

test("Launcher build: boundary & error cases reject invalid origins", () => {
  // Empty, null or undefined -> throws TypeError Invalid URL
  assert.throws(() => validateOrigin("FRONTEND_URL", ""), /Invalid URL/);
  assert.throws(() => validateOrigin("FRONTEND_URL", null), /Invalid URL/);
  assert.throws(() => validateOrigin("FRONTEND_URL", undefined), /Invalid URL/);

  // Non-HTTPS protocol
  assert.throws(() => validateOrigin("FRONTEND_URL", "http://fireguard.onrender.com"), /must be a public HTTPS origin/);
  assert.throws(() => validateOrigin("FRONTEND_URL", "ws://fireguard.onrender.com"), /must be a public HTTPS origin/);
  assert.throws(() => validateOrigin("FRONTEND_URL", "ftp://fireguard.onrender.com"), /must be a public HTTPS origin/);

  // URL with path
  assert.throws(() => validateOrigin("FRONTEND_URL", "https://fireguard.onrender.com/login"), /must be a public HTTPS origin/);
  assert.throws(() => validateOrigin("FRONTEND_URL", "https://fireguard.onrender.com/api/health"), /must be a public HTTPS origin/);

  // URL with query parameters or hash
  assert.throws(() => validateOrigin("FRONTEND_URL", "https://fireguard.onrender.com?ref=launcher"), /must be a public HTTPS origin/);
  assert.throws(() => validateOrigin("FRONTEND_URL", "https://fireguard.onrender.com#main"), /must be a public HTTPS origin/);

  // URL with credentials
  assert.throws(() => validateOrigin("FRONTEND_URL", "https://user:pass@fireguard.onrender.com"), /must be a public HTTPS origin/);

  // Malformed non-URL string
  assert.throws(() => validateOrigin("FRONTEND_URL", "not-a-valid-url"), /Invalid URL/);
});

test("Launcher probe: frontend readiness succeeds only when status is ready and service is frontend", async () => {
  const mockFetchOk = async () => ({
    ok: true,
    json: async () => ({ status: "ready", service: "frontend" }),
  });
  const result = await probe("https://fe.example.com/api/health", "frontend", mockFetchOk);
  assert.equal(result, true);

  // Missing service field
  const mockFetchMissingService = async () => ({
    ok: true,
    json: async () => ({ status: "ready" }),
  });
  assert.equal(await probe("https://fe.example.com/api/health", "frontend", mockFetchMissingService), false);

  // Wrong service name
  const mockFetchWrongService = async () => ({
    ok: true,
    json: async () => ({ status: "ready", service: "backend" }),
  });
  assert.equal(await probe("https://fe.example.com/api/health", "frontend", mockFetchWrongService), false);

  // Status not ready
  const mockFetchNotReady = async () => ({
    ok: true,
    json: async () => ({ status: "starting", service: "frontend" }),
  });
  assert.equal(await probe("https://fe.example.com/api/health", "frontend", mockFetchNotReady), false);
});

test("Launcher probe: backend readiness succeeds when status is ready", async () => {
  const mockFetchBackendOk = async () => ({
    ok: true,
    json: async () => ({ status: "ready", database: "mysql" }),
  });
  const result = await probe("https://be.example.com/health/ready", "backend", mockFetchBackendOk);
  assert.equal(result, true);

  // Database 503 unavailable
  const mockFetch503 = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: "Database unavailable" }),
  });
  assert.equal(await probe("https://be.example.com/health/ready", "backend", mockFetch503), false);
});

test("Launcher probe: handles network error, timeout, and malformed body safely", async () => {
  // Network error (fetch rejects)
  const mockFetchNetworkError = async () => {
    throw new Error("Failed to fetch / Connection refused");
  };
  assert.equal(await probe("https://be.example.com/health/ready", "backend", mockFetchNetworkError), false);

  // Timeout AbortError
  const mockFetchTimeout = async () => {
    const err = new Error("The operation was aborted");
    err.name = "TimeoutError";
    throw err;
  };
  assert.equal(await probe("https://fe.example.com/api/health", "frontend", mockFetchTimeout), false);

  // Invalid non-JSON body (json() rejects)
  const mockFetchBadJson = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  });
  assert.equal(await probe("https://fe.example.com/api/health", "frontend", mockFetchBadJson), false);
});
