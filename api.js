// Shared API helper for the Tetris frontend.
// All other scripts (auth.js, script.js) include this first.

const API_BASE = "https://tetris-api-ovpm.onrender.com";

const STORAGE = {
    access: "tetris.access_token",
    refresh: "tetris.refresh_token",
    email: "tetris.email",
};

function getAccess() { return localStorage.getItem(STORAGE.access); }
function getRefresh() { return localStorage.getItem(STORAGE.refresh); }
function getEmail() { return localStorage.getItem(STORAGE.email); }

function saveTokens({ access_token, refresh_token }, email) {
    localStorage.setItem(STORAGE.access, access_token);
    localStorage.setItem(STORAGE.refresh, refresh_token);
    if (email) localStorage.setItem(STORAGE.email, email);
}

function clearTokens() {
    localStorage.removeItem(STORAGE.access);
    localStorage.removeItem(STORAGE.refresh);
    localStorage.removeItem(STORAGE.email);
}

function isAuthed() {
    return !!getAccess();
}

async function tryRefresh() {
    const refresh = getRefresh();
    if (!refresh) return false;
    try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        localStorage.setItem(STORAGE.access, data.access_token);
        localStorage.setItem(STORAGE.refresh, data.refresh_token);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Fetch wrapper that attaches Bearer token and transparently refreshes once on 401.
 * Throws Error("Unauthorized") if refresh fails — caller may redirect to /login.html.
 */
async function authedFetch(path, opts = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const buildHeaders = () => {
        const h = new Headers(opts.headers || {});
        const t = getAccess();
        if (t) h.set("Authorization", `Bearer ${t}`);
        return h;
    };

    let res = await fetch(url, { ...opts, headers: buildHeaders() });
    if (res.status !== 401) return res;

    const ok = await tryRefresh();
    if (!ok) {
        clearTokens();
        throw new Error("Unauthorized");
    }
    res = await fetch(url, { ...opts, headers: buildHeaders() });
    if (res.status === 401) {
        clearTokens();
        throw new Error("Unauthorized");
    }
    return res;
}

/** Non-auth API call (public endpoints like /scores/highest). */
async function publicFetch(path, opts = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    return fetch(url, opts);
}

async function readError(res) {
    try {
        const d = await res.json();
        if (typeof d.detail === "string") return d.detail;
        if (Array.isArray(d.detail)) return d.detail.map(x => x.msg).join(", ");
        return `HTTP ${res.status}`;
    } catch (_) {
        return `HTTP ${res.status}`;
    }
}

// Convenience global so other modules can pass a one-shot flash via sessionStorage.
function setFlash(message) {
    sessionStorage.setItem("tetris.flash", message);
}
function popFlash() {
    const m = sessionStorage.getItem("tetris.flash");
    if (m) sessionStorage.removeItem("tetris.flash");
    return m;
}
