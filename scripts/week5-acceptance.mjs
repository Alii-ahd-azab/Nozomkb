// Week 5 acceptance tests — real HTTP requests against a running app,
// exactly like a browser / Postman / fetch() "attacker" would send them.
//
// Usage:
//   npm run build && npm run start          (in one terminal)
//   node scripts/week5-acceptance.mjs       (in another)
//   BASE_URL=http://localhost:3000 node scripts/week5-acceptance.mjs
//
// Needs the local test users from database/seed.sql (or
// database/dev/week5_upgrade_existing_local_data.sql).
// Rows created by this script have titles starting with "[TEST]".
// Remove them afterwards with:
//   DELETE FROM posts WHERE title LIKE '[TEST]%';
//   DELETE FROM pages WHERE title LIKE '[TEST]%';

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.TEST_PASSWORD ?? "NozomDev#2026";
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token/;

const results = [];

function check(number, name, passed, detail = "") {
  results.push({ number, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  [${number}] ${name}${detail ? `  (${detail})` : ""}`);
}

class Browser {
  cookies = new Map();

  store(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const expired = /max-age=0/i.test(raw) || /expires=thu, 01 jan 1970/i.test(raw);

      if (!value || expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
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

  async csrf() {
    const response = await this.request("/api/auth/csrf");
    return (await response.json()).csrfToken;
  }

  async login(email, password = PASSWORD) {
    const csrfToken = await this.csrf();
    const response = await this.request("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/feed` }),
    });
    return { status: response.status, location: response.headers.get("location") ?? "" };
  }

  async logout() {
    const csrfToken = await this.csrf();
    await this.request("/api/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/login` }),
    });
  }
}

const ids = (list) => (Array.isArray(list) ? list.map((item) => item.id) : []);

async function main() {
  // ---------------- AUTHENTICATION ----------------
  const anonymous = new Browser();
  const admin = new Browser();
  const ali = new Browser();    // Member, IT
  const ahmed = new Browser();  // Member, HR
  const mona = new Browser();   // Editor, Accounting

  await admin.login("admin@nozom.local");
  const aliLogin = await ali.login("ali@nozom.local");
  await ahmed.login("ahmed@nozom.local");
  await mona.login("mona@nozom.local");

  const aliPosts = await ali.json("/api/posts");
  check(1, "Correct credentials -> login succeeds",
    ali.hasSession() && aliPosts.status === 200 && !aliLogin.location.includes("error"),
    `redirect=${new URL(aliLogin.location, BASE).pathname}`);

  const wrongPassword = new Browser();
  const wp = await wrongPassword.login("ali@nozom.local", "wrong-password");
  const unknownEmail = new Browser();
  const ue = await unknownEmail.login("nobody@nozom.local", "wrong-password");
  const wpTarget = new URL(wp.location, BASE);
  const ueTarget = new URL(ue.location, BASE);
  check(2, "Wrong password -> login fails with a generic error",
    !wrongPassword.hasSession() &&
      wpTarget.pathname === "/login" && wpTarget.searchParams.has("error") &&
      ueTarget.pathname === wpTarget.pathname &&
      ueTarget.searchParams.get("error") === wpTarget.searchParams.get("error"),
    `wrong password and unknown email both -> ${wpTarget.pathname}?error=${wpTarget.searchParams.get("error")}`);

  const unauthenticated = await Promise.all([
    anonymous.json("/api/posts"),
    anonymous.json("/api/posts", "POST", { title: "x", content: "y", tag: "IT" }),
    anonymous.json("/api/posts/1", "PATCH", { title: "x", content: "y" }),
    anonymous.json("/api/posts/1", "DELETE"),
    anonymous.json("/api/pages"),
    anonymous.request("/feed"),
    anonymous.request("/posts/1"),
    anonymous.request("/official"),
  ]);
  const apiStatuses = unauthenticated.slice(0, 5).map((r) => r.status);
  const pageRedirects = unauthenticated.slice(5).map((r) =>
    `${r.status}->${new URL(r.headers.get("location") ?? "/", BASE).pathname}`);
  check(3, "Unauthenticated request to protected API/page -> rejected",
    apiStatuses.every((s) => s === 401) &&
      pageRedirects.every((r) => /^30[37]->\/login$/.test(r)),
    `API: ${apiStatuses.join(",")} | pages: ${pageRedirects.join(", ")}`);

  const logoutUser = new Browser();
  await logoutUser.login("ali@nozom.local");
  const beforeLogout = await logoutUser.json("/api/posts");
  await logoutUser.logout();
  const afterLogout = await logoutUser.json("/api/posts");
  const feedAfterLogout = await logoutUser.request("/feed");
  check(4, "Logout -> old browser session can no longer access content",
    beforeLogout.status === 200 && !logoutUser.hasSession() &&
      afterLogout.status === 401 && feedAfterLogout.status >= 300 && feedAfterLogout.status < 400,
    `before=${beforeLogout.status}, after=${afterLogout.status}, /feed=${feedAfterLogout.status}`);

  // 5: a tampered / expired token must be rejected (simulates expiry).
  const tampered = new Browser();
  for (const [name, value] of ali.cookies) {
    tampered.cookies.set(name, SESSION_COOKIE.test(name) ? value.slice(0, -6) + "AAAAAA" : value);
  }
  const tamperedResult = await tampered.json("/api/posts");
  check(5, "Invalid/expired session token -> treated as signed out",
    tamperedResult.status === 401, `status=${tamperedResult.status}`);

  // ---------------- OWNERSHIP ----------------
  const created = await ali.json("/api/posts", "POST", {
    title: "[TEST] Ali ownership post",
    content: "Created by the acceptance test.",
    tag: "IT",
    userId: 2, // forged author: must be ignored by the server
  });
  check(6, "Member A creates a Post (author taken from session, forged userId ignored)",
    created.status === 201 && created.data?.authorName === "Ali",
    `status=${created.status}, author=${created.data?.authorName}`);
  const postId = created.data?.id;

  const ahmedPage = await ahmed.request(`/posts/${postId}`);
  const ahmedHtml = await ahmedPage.text();
  const aliPage = await ali.request(`/posts/${postId}`);
  const aliHtml = await aliPage.text();

  const aliEdit = await ali.json(`/api/posts/${postId}`, "PATCH", {
    title: "[TEST] Ali ownership post (edited)",
    content: "Edited by its owner.",
  });
  check(7, "Member A edits own Post",
    aliEdit.status === 200 && aliEdit.data?.title.endsWith("(edited)"),
    `status=${aliEdit.status}`);

  check(9, "Member B sees no Edit/Delete for Member A's Post in the UI",
    ahmedPage.status === 200 && !ahmedHtml.includes("Edit Post") && !ahmedHtml.includes("Delete Post") &&
      aliHtml.includes("Edit Post"),
    `B page=${ahmedPage.status}, buttons for B=${ahmedHtml.includes("Edit Post")}, for owner=${aliHtml.includes("Edit Post")}`);

  const ahmedPatch = await ahmed.json(`/api/posts/${postId}`, "PATCH", {
    title: "hacked", content: "hacked", userId: 1,
  });
  check(10, "Member B PATCHes Member A's Post via API -> rejected",
    ahmedPatch.status === 403, `status=${ahmedPatch.status}`);

  const ahmedDelete = await ahmed.json(`/api/posts/${postId}`, "DELETE");
  const stillThere = await ali.json(`/api/posts/${postId}`);
  check(11, "Member B DELETEs Member A's Post via API -> rejected",
    ahmedDelete.status === 403 && stillThere.status === 200,
    `status=${ahmedDelete.status}, post still exists=${stillThere.status === 200}`);

  const editorPatch = await mona.json(`/api/posts/${postId}`, "PATCH", { title: "x", content: "y" });
  const adminPatch = await admin.json(`/api/posts/${postId}`, "PATCH", {
    title: "[TEST] Ali ownership post (admin edit)", content: "Admin moderation.",
  });
  check("6b", "Editor cannot edit others' Posts; Admin can",
    editorPatch.status === 403 && adminPatch.status === 200,
    `editor=${editorPatch.status}, admin=${adminPatch.status}`);

  const aliDelete = await ali.json(`/api/posts/${postId}`, "DELETE");
  const afterDelete = await ali.json(`/api/posts/${postId}`);
  check(8, "Member A deletes own Post",
    aliDelete.status === 200 && afterDelete.status === 404,
    `delete=${aliDelete.status}, then GET=${afterDelete.status}`);

  // ---------------- RBAC: Official Pages ----------------
  const adminPages = (await admin.json("/api/pages")).data;
  const pageByTitle = (title) => adminPages.find((p) => p.title === title);
  const onboarding = pageByTitle("Employee Onboarding");
  const hrPage = pageByTitle("HR Leave Request Procedure");
  const draftPage = pageByTitle("Notice Period Policy");
  const archivedPage = pageByTitle("Old Expense Policy");

  const memberCreate = await ali.json("/api/pages", "POST", {
    title: "[TEST] Member official page", content: "Should fail.", status: "published",
  });
  const memberPublish = await ali.json(`/api/pages/${onboarding.id}`, "PATCH", {
    title: onboarding.title, content: onboarding.content, status: "published",
  });
  const memberPublishDraft = await ali.json(`/api/pages/${draftPage.id}`, "PATCH", {
    title: draftPage.title, content: draftPage.content, status: "published",
  });
  check(12, "Member tries to create/publish an Official Page -> rejected",
    memberCreate.status === 403 && memberPublish.status === 403 && memberPublishDraft.status === 404,
    `create=${memberCreate.status}, edit published=${memberPublish.status}, publish draft=${memberPublishDraft.status}`);

  const editorCreate = await mona.json("/api/pages", "POST", {
    title: "[TEST] Editor official page", content: "Published by an Editor.", status: "published",
  });
  const editorPublish = await mona.json(`/api/pages/${draftPage.id}`, "PATCH", {
    title: draftPage.title, content: draftPage.content, status: "published",
  });
  const aliSeesPublished = await ali.json(`/api/pages/${draftPage.id}`);
  const editorArchive = await mona.json(`/api/pages/${editorCreate.data?.id}`, "PATCH", {
    title: "[TEST] Editor official page", content: "Archived by an Editor.", status: "archived",
  });
  // restore demo data
  await mona.json(`/api/pages/${draftPage.id}`, "PATCH", {
    title: draftPage.title, content: draftPage.content, status: "draft",
  });
  check(13, "Editor creates, publishes and archives Official Pages",
    editorCreate.status === 201 && editorPublish.status === 200 &&
      editorPublish.data?.status === "published" && aliSeesPublished.status === 200 &&
      editorArchive.status === 200,
    `create=${editorCreate.status}, publish=${editorPublish.status}, member then reads=${aliSeesPublished.status}, archive=${editorArchive.status}`);

  const editorOtherDept = await mona.json("/api/pages", "POST", {
    title: "[TEST] Editor HR page", content: "x", scope: "department", departmentId: hrPage.departmentId,
  });
  const editorEditHr = await mona.json(`/api/pages/${hrPage.id}`, "PATCH", {
    title: hrPage.title, content: hrPage.content,
  });
  check("13b", "Editor cannot manage another department's Official Pages",
    editorOtherDept.status === 403 && editorEditHr.status === 404,
    `create for HR=${editorOtherDept.status}, edit HR page=${editorEditHr.status}`);

  // ---------------- DEPARTMENT SCOPE ----------------
  const adminPosts = (await admin.json("/api/posts")).data;
  const postByTitle = (title) => adminPosts.find((p) => p.title === title);
  const hrPost = postByTitle("HR Payroll Calendar Notes");
  const companyPost = postByTitle("Annual Leave Policy");
  const draftPost = postByTitle("VPN Setup Notes");
  const archivedPost = postByTitle("Old Printer Driver Guide");

  const ahmedHrPostApi = await ahmed.json(`/api/posts/${hrPost.id}`);
  const ahmedHrPageApi = await ahmed.json(`/api/pages/${hrPage.id}`);
  const ahmedHrPostUrl = await ahmed.request(`/posts/${hrPost.id}`);
  const ahmedHrPageUrl = await ahmed.request(`/official/${hrPage.id}`);
  check(14, "Member in HR reads Published HR-department content",
    [ahmedHrPostApi.status, ahmedHrPageApi.status, ahmedHrPostUrl.status, ahmedHrPageUrl.status].every((s) => s === 200),
    `post API/page=${ahmedHrPostApi.status}/${ahmedHrPostUrl.status}, official API/page=${ahmedHrPageApi.status}/${ahmedHrPageUrl.status}`);

  const aliFeedPosts = ids((await ali.json("/api/posts")).data);
  const aliPageList = ids((await ali.json("/api/pages")).data);
  const aliFeedHtml = await (await ali.request("/feed")).text();
  const aliOfficialHtml = await (await ali.request("/official")).text();
  check(15, "Member in IT: HR content absent from normal navigation (lists)",
    !aliFeedPosts.includes(hrPost.id) && !aliPageList.includes(hrPage.id) &&
      !aliFeedHtml.includes(hrPost.title) && !aliOfficialHtml.includes(hrPage.title),
    "not in /api/posts, /api/pages, /feed or /official");

  const aliHrPostUrl = await ali.request(`/posts/${hrPost.id}`);
  const aliHrPageUrl = await ali.request(`/official/${hrPage.id}`);
  const aliHrPostHtml = await aliHrPostUrl.text();
  check(16, "Member in IT types the direct URL -> not returned",
    aliHrPostUrl.status === 404 && aliHrPageUrl.status === 404 && !aliHrPostHtml.includes(hrPost.content),
    `/posts/${hrPost.id}=${aliHrPostUrl.status}, /official/${hrPage.id}=${aliHrPageUrl.status}`);

  const aliHrApi = await Promise.all([
    ali.json(`/api/posts/${hrPost.id}`),
    ali.json(`/api/pages/${hrPage.id}`),
    ali.json(`/api/posts/${hrPost.id}`, "PATCH", { title: "x", content: "y" }),
    ali.json(`/api/posts/${hrPost.id}`, "DELETE"),
  ]);
  check(17, "Member in IT calls the API directly -> denied",
    aliHrApi.every((r) => r.status === 404) && !JSON.stringify(aliHrApi).includes(hrPost.content),
    aliHrApi.map((r) => r.status).join(","));

  const companyReads = await Promise.all([ali, ahmed, mona].flatMap((user) => [
    user.json(`/api/posts/${companyPost.id}`),
    user.json(`/api/pages/${onboarding.id}`),
  ]));
  const adminHr = await admin.json(`/api/posts/${hrPost.id}`);
  check(18, "Company-wide Published content -> readable by every department",
    companyReads.every((r) => r.status === 200),
    `${companyReads.map((r) => r.status).join(",")} | Admin cross-department read=${adminHr.status}`);

  // ---------------- LIFECYCLE ----------------
  check(19, "Published permitted content -> visible",
    aliFeedPosts.includes(companyPost.id) && aliPageList.includes(onboarding.id));

  const draftChecks = await Promise.all([
    ahmed.json(`/api/posts/${draftPost.id}`),
    ahmed.json(`/api/pages/${draftPage.id}`),
    ali.json(`/api/pages/${draftPage.id}`),
    ali.json(`/api/posts/${draftPost.id}`),  // owner
    mona.json(`/api/pages/${draftPage.id}`), // editor
  ]);
  const ahmedList = ids((await ahmed.json("/api/posts")).data);
  check(20, "Draft content hidden from normal readers (owner/editor still manage it)",
    draftChecks[0].status === 404 && draftChecks[1].status === 404 && draftChecks[2].status === 404 &&
      draftChecks[3].status === 200 && draftChecks[4].status === 200 && !ahmedList.includes(draftPost.id),
    `reader=${draftChecks.slice(0, 3).map((r) => r.status).join(",")}, owner=${draftChecks[3].status}, editor=${draftChecks[4].status}`);

  const archivedChecks = await Promise.all([
    ahmed.json(`/api/posts/${archivedPost.id}`),
    ahmed.json(`/api/pages/${archivedPage.id}`),
    ali.json(`/api/pages/${archivedPage.id}`),
    ahmed.request(`/posts/${archivedPost.id}`),
  ]);
  const ahmedPageList = ids((await ahmed.json("/api/pages")).data);
  check(21, "Archived content not returned to normal readers",
    archivedChecks.every((r) => r.status === 404) &&
      !ahmedList.includes(archivedPost.id) && !ahmedPageList.includes(archivedPage.id),
    archivedChecks.map((r) => r.status).join(","));

  // ---------------- SECRETS (HTTP side) ----------------
  const pagesHtml = await Promise.all(["/", "/login", "/feed", "/official"].map(async (path) =>
    (await ali.request(path)).text()));
  const apiBodies = JSON.stringify([adminPosts, adminPages]);
  const everything = pagesHtml.join("\n") + apiBodies;
  check("22a", "No password hashes / secret names leaked in HTML or API responses",
    !everything.includes("password_hash") && !/\$2[aby]\$10\$/.test(everything) &&
      !everything.includes("DATABASE_URL") && !everything.includes("AUTH_SECRET"));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
