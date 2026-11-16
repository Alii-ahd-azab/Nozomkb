// Minimal cookie-keeping HTTP client used by the acceptance scripts.
// It talks to the running app exactly like a browser / Postman would.

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const PASSWORD = process.env.TEST_PASSWORD ?? "NozomDev#2026";
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token/;

export class Browser {
  cookies = new Map();

  store(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const expired = /max-age=0/i.test(raw) || /expires=thu, 01 jan 1970/i.test(raw);

      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  hasSession() {
    return [...this.cookies.keys()].some((name) => SESSION_COOKIE.test(name));
  }

  async request(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;

    const response = await fetch(BASE + path, { ...options, headers, redirect: "manual" });
    this.store(response);
    return response;
  }

  async json(path, method = "GET", body) {
    const response = await this.request(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, data };
  }

  async html(path) {
    const response = await this.request(path);
    return { status: response.status, text: await response.text() };
  }

  async upload(path, { name, type, bytes }) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    const response = await this.request(path, { method: "POST", body: form });
    let data = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, data };
  }

  async login(email, password = PASSWORD) {
    const csrf = await this.request("/api/auth/csrf");
    const { csrfToken } = await csrf.json();
    await this.request("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/feed` }),
    });
    if (!this.hasSession()) throw new Error(`Login failed for ${email}`);
    return this;
  }
}
