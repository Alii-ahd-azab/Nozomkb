// Week 6 acceptance / integration tests — real HTTP against a running app,
// real PostgreSQL, real private file storage.
//
// Usage:
//   npm run build && npm run start                         (terminal 1)
//   BASE_URL=http://localhost:3000 npm run test:week6      (terminal 2)
//
// The script cleans up everything it creates ([TEST] rows and uploaded files).
// It reads DATABASE_URL from the environment or .env.local ONLY for the final
// cleanup sweep and never prints it.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { BASE, Browser } from "./lib/test-browser.mjs";

const ROOT = process.cwd();
const STORAGE = path.resolve(process.env.FILE_STORAGE_DIR ?? path.join(ROOT, "storage", "private"));
const M = `w6${Date.now().toString(36)}`; // unique marker for this run
const MB10 = 10 * 1024 * 1024;

const results = [];
function check(number, name, passed, detail = "") {
  results.push({ number, name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  [${number}] ${name}${detail ? `  (${detail})` : ""}`);
}

const created = { posts: [], pageFiles: [], comments: [] };

async function listFilesRecursive(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else out.push(full);
  }
  return out;
}

async function filesContaining(dir, marker) {
  const hits = [];
  for (const file of await listFilesRecursive(dir)) {
    const info = await stat(file);
    if (info.size > 12 * 1024 * 1024) continue;
    if ((await readFile(file)).includes(marker)) hits.push(file);
  }
  return hits;
}

const search = (browser, params) =>
  browser.json(`/api/search?${new URLSearchParams(params).toString()}`);
const has = (list, type, id) => list.some((r) => r.type === type && r.id === id);

async function main() {
  const anonymous = new Browser();
  const admin = await new Browser().login("admin@nozom.local");
  const ali = await new Browser().login("ali@nozom.local");     // Member IT
  const ahmed = await new Browser().login("ahmed@nozom.local"); // Member HR
  const mona = await new Browser().login("mona@nozom.local");   // Editor Accounting

  const adminPosts = (await admin.json("/api/posts")).data;
  const adminPages = (await admin.json("/api/pages")).data;
  const hrPost = adminPosts.find((p) => p.title === "HR Payroll Calendar Notes");
  const draftPage = adminPages.find((p) => p.title === "Notice Period Policy");
  const onboarding = adminPages.find((p) => p.title === "Employee Onboarding");

  const newPost = async (browser, fields) => {
    const r = await browser.json("/api/posts", "POST", { tag: "IT", ...fields });
    if (r.status === 201) created.posts.push({ id: r.data.id, owner: browser });
    return r;
  };

  // ---------------- COMMENTS ----------------
  const post = await newPost(ali, {
    title: `[TEST] Week6 journey ${M}`,
    content: `Shared printer knowledge ${M}`,
    tag: "IT",
  });
  const postId = post.data?.id;
  check(1, "Member creates a Post", post.status === 201, `status=${post.status}`);

  const c1 = await ali.json(`/api/posts/${postId}/comments`, "POST", {
    content: `First comment ${M}`,
    userId: 2, // forged author: ignored
  });
  check(2, "Member adds a Comment (author from session)",
    c1.status === 201 && c1.data?.authorName === "Ali", `status=${c1.status}, author=${c1.data?.authorName}`);

  const ahmedSees = await ahmed.json(`/api/posts/${postId}/comments`);
  const monaSees = await mona.json(`/api/posts/${postId}/comments`);
  check(3, "Another permitted reader sees the Comment",
    ahmedSees.status === 200 && ahmedSees.data.some((c) => c.id === c1.data.id) &&
      monaSees.data?.some((c) => c.id === c1.data.id) &&
      ahmedSees.data.find((c) => c.id === c1.data.id)?.canEdit === false);

  const edit = await ali.json(`/api/comments/${c1.data.id}`, "PATCH", { content: `Edited comment ${M}` });
  check(4, "Author edits own Comment", edit.status === 200 && edit.data?.content === `Edited comment ${M}`);

  const otherEdit = await ahmed.json(`/api/comments/${c1.data.id}`, "PATCH", { content: "hacked" });
  const otherDelete = await ahmed.json(`/api/comments/${c1.data.id}`, "DELETE");
  const editorEdit = await mona.json(`/api/comments/${c1.data.id}`, "PATCH", { content: "hacked" });
  const emptyComment = await ali.json(`/api/posts/${postId}/comments`, "POST", { content: "   " });
  check(5, "Another Member cannot edit/delete the Comment (server rejects)",
    otherEdit.status === 403 && otherDelete.status === 403 && editorEdit.status === 403 &&
      emptyComment.status === 400 && /تعليق/.test(emptyComment.data?.error ?? ""),
    `PATCH=${otherEdit.status}, DELETE=${otherDelete.status}, editor=${editorEdit.status}, empty=${emptyComment.status} "${emptyComment.data?.error}"`);

  const del = await ali.json(`/api/comments/${c1.data.id}`, "DELETE");
  const afterDel = await ali.json(`/api/comments/${c1.data.id}`);
  check(6, "Author deletes own Comment", del.status === 200 && afterDel.status === 404);

  const c2 = await ali.json(`/api/posts/${postId}/comments`, "POST", { content: `Searchable comment ${M}` });
  const hrComment = await ahmed.json(`/api/posts/${hrPost.id}/comments`, "POST", { content: `HR secret comment ${M}` });
  created.comments.push({ id: hrComment.data?.id, owner: ahmed });
  const aliHr = await Promise.all([
    ali.json(`/api/posts/${hrPost.id}/comments`),
    ali.json(`/api/comments/${hrComment.data?.id}`),
    ali.json(`/api/comments/${hrComment.data?.id}`, "PATCH", { content: "x" }),
    ali.json(`/api/comments/${hrComment.data?.id}`, "DELETE"),
    ali.json(`/api/posts/${hrPost.id}/comments`, "POST", { content: "x" }),
  ]);
  check(7, "Comment on department content is inaccessible to another department",
    hrComment.status === 201 && aliHr.every((r) => r.status === 404),
    aliHr.map((r) => r.status).join(","));

  // ---------------- BOOKMARKS ----------------
  const bm = await ali.json("/api/bookmarks", "POST", { kind: "post", id: postId });
  check(8, "Member bookmarks a readable Post", bm.status === 201);

  const bmList = await ali.json("/api/bookmarks");
  const bmPage = await ali.html("/bookmarks");
  check(9, "Bookmark appears on /bookmarks",
    bmList.data.some((b) => b.kind === "post" && b.id === postId) && bmPage.text.includes(`Week6 journey ${M}`));

  const dup = await ali.json("/api/bookmarks", "POST", { kind: "post", id: postId });
  const afterDup = (await ali.json("/api/bookmarks")).data.filter((b) => b.kind === "post" && b.id === postId);
  check(10, "Duplicate Bookmark prevented",
    dup.status === 409 && afterDup.length === 1, `status=${dup.status} "${dup.data?.error}", copies=${afterDup.length}`);

  const rm = await ali.json("/api/bookmarks", "DELETE", { kind: "post", id: postId });
  const afterRm = (await ali.json("/api/bookmarks")).data.some((b) => b.kind === "post" && b.id === postId);
  check(11, "User removes Bookmark", rm.status === 200 && !afterRm);

  const badBookmarks = await Promise.all([
    ali.json("/api/bookmarks", "POST", { kind: "post", id: hrPost.id }),
    ali.json("/api/bookmarks", "POST", { kind: "page", id: draftPage.id }),
    ali.json("/api/bookmarks", "POST", { kind: "post", id: 99999999 }),
  ]);
  // A bookmark must disappear when its target stops being readable.
  await ahmed.json("/api/bookmarks", "POST", { kind: "post", id: postId });
  await ali.json(`/api/posts/${postId}`, "PATCH", { title: `[TEST] Week6 journey ${M}`, content: `Shared printer knowledge ${M}`, status: "draft" });
  const hiddenWhileDraft = !(await ahmed.json("/api/bookmarks")).data.some((b) => b.id === postId && b.kind === "post");
  await ali.json(`/api/posts/${postId}`, "PATCH", { title: `[TEST] Week6 journey ${M}`, content: `Shared printer knowledge ${M}`, status: "published" });
  const visibleAgain = (await ahmed.json("/api/bookmarks")).data.some((b) => b.id === postId && b.kind === "post");
  await ahmed.json("/api/bookmarks", "DELETE", { kind: "post", id: postId });
  check(12, "Bookmarking inaccessible content rejected; bookmarks re-check access",
    badBookmarks.every((r) => r.status === 404) && hiddenWhileDraft && visibleAgain,
    `${badBookmarks.map((r) => r.status).join(",")}, hidden when draft=${hiddenWhileDraft}`);

  // ---------------- PROFILE ----------------
  const originalProfile = (await ali.json("/api/profile")).data;
  const newSpecialty = `Printers ${M}`;
  const spec = await ali.json("/api/profile", "PATCH", { specialty: newSpecialty });
  const profileHtml = await ali.html("/profile");
  check(13, "Profile shows name, role, department, specialty",
    ["Ali", "ali@nozom.local", "Member", "IT", newSpecialty].every((t) => profileHtml.text.includes(t)));
  check(14, "Employee updates specialty", spec.status === 200 && spec.data?.specialty === newSpecialty);

  const forged = await Promise.all([
    ali.json("/api/profile", "PATCH", { specialty: "x", role: "Admin" }),
    ali.json("/api/profile", "PATCH", { specialty: "x", departmentId: 2 }),
    ali.json("/api/profile", "PATCH", { role: "Admin" }),
  ]);
  const afterForge = (await ali.json("/api/profile")).data;
  const stillMember = (await ali.json("/api/pages", "POST", { title: "x", content: "y" })).status === 403;
  check(15, "Forged role/department change rejected",
    forged.every((r) => r.status === 400) && afterForge.role === "Member" &&
      afterForge.departmentName === "IT" && afterForge.specialty === newSpecialty && stillMember,
    `${forged.map((r) => r.status).join(",")} "${forged[0].data?.error}"`);
  await ali.json("/api/profile", "PATCH", { specialty: originalProfile.specialty });

  // ---------------- FILES ----------------
  const txtContent = `Private TXT ${M}\nسطر عربي للتجربة\n`;
  const txt = await ali.upload(`/api/posts/${postId}/files`, {
    name: `notes-${M}.txt`, type: "text/plain", bytes: Buffer.from(txtContent, "utf8"),
  });
  check(16, "Owner uploads valid TXT", txt.status === 201 && !("storageKey" in (txt.data ?? {})),
    `status=${txt.status}, storage key hidden=${!("storageKey" in (txt.data ?? {}))}`);

  const pdfBytes = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${M}-pdf\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
  const pdf = await ali.upload(`/api/posts/${postId}/files`, {
    name: `guide-${M}.pdf`, type: "application/pdf", bytes: pdfBytes,
  });
  check(17, "Owner uploads valid PDF", pdf.status === 201 && pdf.data?.mimeType === "application/pdf");

  const inStorage = await filesContaining(STORAGE, `Private TXT ${M}`);
  const inPublic = await filesContaining(path.join(ROOT, "public"), M);
  check(18, "File stored in PRIVATE storage, not under public/",
    inStorage.length === 1 && /^[0-9a-f-]{36}\.txt$/.test(path.basename(inStorage[0])) && inPublic.length === 0,
    `${path.relative(ROOT, inStorage[0] ?? "?")}, public hits=${inPublic.length}`);

  const dl = await ahmed.request(`/api/files/${txt.data.id}/download`);
  const dlText = await dl.text();
  check(19, "Permitted reader downloads the File",
    dl.status === 200 && dlText === txtContent && /attachment/.test(dl.headers.get("content-disposition") ?? ""),
    `status=${dl.status}, type=${dl.headers.get("content-type")}`);

  const hrFile = await ahmed.upload(`/api/posts/${hrPost.id}/files`, {
    name: `hr-${M}.txt`, type: "text/plain", bytes: Buffer.from(`HR only ${M}`),
  });
  const guesses = await Promise.all([
    ali.request(`/api/files/${hrFile.data?.id}/download`),
    ali.request(`/api/files/${hrFile.data?.id}`, { method: "DELETE" }),
    anonymous.request(`/api/files/${hrFile.data?.id}/download`),
  ]);
  const guessBody = await guesses[0].text();
  check(20, "Wrong department guessing a file download URL -> not found",
    hrFile.status === 201 && guesses[0].status === 404 && guesses[1].status === 404 &&
      guesses[2].status === 401 && !guessBody.includes(`HR only ${M}`),
    `other dept=${guesses[0].status}, delete=${guesses[1].status}, anonymous=${guesses[2].status}`);

  const bad = await Promise.all([
    ali.upload(`/api/posts/${postId}/files`, { name: "tool.exe", type: "application/octet-stream", bytes: Buffer.from("MZ...") }),
    ali.upload(`/api/posts/${postId}/files`, { name: "page.html", type: "text/html", bytes: Buffer.from("<script>") }),
    ali.upload(`/api/posts/${postId}/files`, { name: "fake.pdf", type: "application/pdf", bytes: Buffer.from("not really a pdf") }),
    ali.upload(`/api/posts/${postId}/files`, { name: "binary.txt", type: "text/plain", bytes: Buffer.from([0x41, 0x00, 0x42]) }),
    ali.upload(`/api/posts/${postId}/files`, { name: "renamed.txt", type: "application/pdf", bytes: Buffer.from("text") }),
  ]);
  check(21, "Unsupported type rejected with Arabic message",
    bad.every((r) => r.status === 415 && /[؀-ۿ]/.test(r.data?.error ?? "")),
    `${bad.map((r) => r.status).join(",")} "${bad[0].data?.error}"`);

  const tooBig = await ali.upload(`/api/posts/${postId}/files`, {
    name: "big.txt", type: "text/plain", bytes: Buffer.alloc(MB10 + 1, 0x61),
  });
  const wayTooBig = await ali.upload(`/api/posts/${postId}/files`, {
    name: "huge.txt", type: "text/plain", bytes: Buffer.alloc(MB10 + 1024 * 1024, 0x61),
  });
  check(22, "File over 10 MB rejected with clear message",
    tooBig.status === 413 && wayTooBig.status === 413 && /10/.test(tooBig.data?.error ?? ""),
    `10MB+1B=${tooBig.status}, 11MB=${wayTooBig.status} "${tooBig.data?.error}"`);

  const storageBefore = new Set(await readdir(STORAGE));
  const traversal = await Promise.all([
    ali.upload(`/api/posts/${postId}/files`, { name: `../../evil-${M}.txt`, type: "text/plain", bytes: Buffer.from(`traversal ${M}`) }),
    ali.upload(`/api/posts/${postId}/files`, { name: `..\\..\\evil2-${M}.txt`, type: "text/plain", bytes: Buffer.from(`traversal2 ${M}`) }),
  ]);
  const newDiskNames = (await readdir(STORAGE)).filter((n) => !storageBefore.has(n));
  // Look for a file literally named "evil-..." in the project and one level up.
  const parentEntries = (await readdir(path.dirname(ROOT)).catch(() => [])).map((n) => path.join(path.dirname(ROOT), n));
  const escaped = [...(await listFilesRecursive(ROOT)), ...parentEntries]
    .filter((f) => path.basename(f).startsWith("evil") && path.basename(f).includes(M));
  check(23, "Path traversal filename cannot escape private storage",
    traversal.every((r) => r.status === 201) &&
      traversal[0].data.originalName === `evil-${M}.txt` &&
      traversal[1].data.originalName === `evil2-${M}.txt` &&
      newDiskNames.length === 2 && newDiskNames.every((n) => /^[0-9a-f-]{36}\.txt$/.test(n)) &&
      escaped.length === 0,
    `stored as display names "${traversal[0].data?.originalName}", disk=${newDiskNames.join(" ")}`);

  const unauthorizedUploads = await Promise.all([
    ahmed.upload(`/api/posts/${postId}/files`, { name: "x.txt", type: "text/plain", bytes: Buffer.from("x") }),
    mona.upload(`/api/posts/${postId}/files`, { name: "x.txt", type: "text/plain", bytes: Buffer.from("x") }),
    ali.upload(`/api/pages/${onboarding.id}/files`, { name: "x.txt", type: "text/plain", bytes: Buffer.from("x") }),
    ahmed.json(`/api/files/${txt.data.id}`, "DELETE"),
    mona.json(`/api/files/${txt.data.id}`, "DELETE"),
    anonymous.upload(`/api/posts/${postId}/files`, { name: "x.txt", type: "text/plain", bytes: Buffer.from("x") }),
  ]);
  const pageFile = await mona.upload(`/api/pages/${onboarding.id}/files`, {
    name: `policy-${M}.txt`, type: "text/plain", bytes: Buffer.from(`Official file ${M}`),
  });
  const aliReadsPageFile = (await ali.request(`/api/files/${pageFile.data?.id}/download`)).status;
  const pdfDelete = await ali.json(`/api/files/${pdf.data.id}`, "DELETE");
  const pdfGone = (await filesContaining(STORAGE, `${M}-pdf`)).length === 0;
  check(24, "Unauthorized upload/delete on another user's Post rejected",
    unauthorizedUploads.slice(0, 5).every((r) => r.status === 403) && unauthorizedUploads[5].status === 401 &&
      pageFile.status === 201 && aliReadsPageFile === 200 && pdfDelete.status === 200 && pdfGone,
    `${unauthorizedUploads.map((r) => r.status).join(",")} | editor page upload=${pageFile.status}, member downloads=${aliReadsPageFile}, owner delete=${pdfDelete.status}, disk removed=${pdfGone}`);
  created.pageFiles.push(pageFile.data?.id);

  // ---------------- SEARCH ----------------
  const page = await mona.json("/api/pages", "POST", {
    title: `[TEST] Official ${M}`, content: `Official guidance ${M}`, status: "published",
  });
  const draftPost = await newPost(ali, { title: `[TEST] Draft ${M}`, content: `draft ${M}`, status: "draft" });
  const archivedPost = await newPost(ali, { title: `[TEST] Archived ${M}`, content: `archived ${M}` });
  await ali.json(`/api/posts/${archivedPost.data.id}`, "PATCH", { title: `[TEST] Archived ${M}`, content: `archived ${M}`, status: "archived" });
  const draftComment = await ali.json(`/api/posts/${draftPost.data.id}/comments`, "POST", { content: `draft-parent comment ${M}` });
  const archivedComment = await ali.json(`/api/posts/${archivedPost.data.id}/comments`, "POST", { content: `archived-parent comment ${M}` });
  const draftPageT = await mona.json("/api/pages", "POST", { title: `[TEST] Draft page ${M}`, content: `draft page ${M}`, status: "draft" });
  const hrOnlyPost = await newPost(ahmed, { title: `[TEST] HR only ${M}`, content: `hr only ${M}`, scope: "department", tag: "HR" });
  const hrTagged = await newPost(ali, { title: `[TEST] HR tagged ${M}`, content: `tagged ${M}`, tag: "HR" });

  const sPost = await search(ali, { q: M, type: "post" });
  check(25, "Search finds a Published Post by keyword", has(sPost.data.results, "post", postId));

  const sPage = await search(ali, { q: M, type: "page" });
  check(26, "Search finds a Published Official Page by keyword", has(sPage.data.results, "page", page.data.id));

  const sComment = await search(ali, { q: M, type: "comment" });
  check(27, "Search finds a Comment by keyword",
    has(sComment.data.results, "comment", c2.data.id) &&
      sComment.data.results.find((r) => r.id === c2.data.id)?.parentId === postId);

  const sAll = (await search(ali, { q: M })).data.results;
  check(28, "Type filter works (post/page/comment/all)",
    sPost.data.results.every((r) => r.type === "post") && sPage.data.results.every((r) => r.type === "page") &&
      sComment.data.results.every((r) => r.type === "comment") &&
      ["post", "page", "comment"].every((t) => sAll.some((r) => r.type === t)),
    `all=${sAll.length}, post=${sPost.data.total}, page=${sPage.data.total}, comment=${sComment.data.total}`);

  const hrDeptId = String(hrPost.departmentId);
  const ahmedHrOnly = (await search(ahmed, { q: M, department: hrDeptId })).data.results;
  const ahmedCompany = (await search(ahmed, { q: M, department: "company" })).data.results;
  const aliHrFilter = await search(ali, { q: M, department: hrDeptId });
  check(29, "Department filter narrows results and never bypasses permissions",
    has(ahmedHrOnly, "post", hrOnlyPost.data.id) && ahmedHrOnly.every((r) => r.scope === "department") &&
      !has(ahmedCompany, "post", hrOnlyPost.data.id) && ahmedCompany.every((r) => r.scope === "company") &&
      aliHrFilter.status === 200 && aliHrFilter.data.total === 0,
    `HR member HR filter=${ahmedHrOnly.length}, IT member forcing HR filter=${aliHrFilter.data.total}`);

  const tagIt = (await search(ali, { q: M, tag: "IT" })).data.results;
  const tagHr = (await search(ali, { q: M, tag: "HR" })).data.results;
  check(30, "Tag filter works (Posts + Comments via parent Post)",
    has(tagIt, "post", postId) && !has(tagIt, "post", hrTagged.data.id) && has(tagIt, "comment", c2.data.id) &&
      has(tagHr, "post", hrTagged.data.id) && !has(tagHr, "post", postId) && !has(tagHr, "comment", c2.data.id) &&
      !tagIt.some((r) => r.type === "page"));

  // Separate marker so these 25 rows do not push other results off page 1.
  const P = `pg${M.slice(2)}x`;
  for (let i = 0; i < 25; i++) {
    await newPost(ali, { title: `[TEST] Page item ${i} ${P}`, content: `pagination ${P}` });
  }
  const p1 = (await search(ali, { q: P, page: "1" })).data;
  const p2 = (await search(ali, { q: P, page: "2" })).data;
  const p3 = (await search(ali, { q: P, page: "3" })).data;
  const overlap = p1.results.filter((r) => p2.results.some((s) => s.id === r.id)).length;
  const pageHtml = await ali.html(`/search?q=${P}&type=all&department=all&tag=all&page=1`);
  const badPage = await search(ali, { q: P, page: "0" });
  check(31, "Search pagination (server-side LIMIT/OFFSET)",
    p1.total === 25 && p1.results.length === 20 && p2.results.length === 5 && p3.results.length === 0 &&
      p1.totalPages === 2 && overlap === 0 && pageHtml.text.includes("Next") && badPage.status === 400,
    `total=${p1.total}, page1=${p1.results.length}, page2=${p2.results.length}, page3=${p3.results.length}`);

  const none = await search(ali, { q: `zzz${M}nothing` });
  const noneHtml = await ali.html(`/search?q=zzz${M}nothing`);
  const emptyQuery = await search(ali, { q: "" });
  check(32, "No-results Search shows a useful empty state",
    none.data.total === 0 && noneHtml.text.includes("No results") && emptyQuery.status === 400 &&
      /[؀-ۿ]/.test(emptyQuery.data?.error ?? ""));

  const searchers = [ali, mona, ahmed, admin];
  const allViews = await Promise.all(searchers.map(async (b) => (await search(b, { q: M })).data.results));
  // Guard: every view fits on one page, so "absent" really means absent.
  check(33, "Draft content absent from Search (even for its owner/editor)",
    allViews.every((list) => list.length > 0 && list.length < 20) &&
    allViews.every((list) =>!has(list, "post", draftPost.data.id) && !has(list, "page", draftPageT.data.id)));
  check(34, "Archived content absent from Search",
    allViews.every((list) => !has(list, "post", archivedPost.data.id)) &&
      (await search(ali, { q: "Old Expense Policy" })).data.total === 0 &&
      (await search(ali, { q: "Old Printer Driver" })).data.total === 0);
  check(35, "Wrong-department content absent from Search",
    !has(allViews[0], "post", hrOnlyPost.data.id) && !has(allViews[1], "post", hrOnlyPost.data.id) &&
      !has(allViews[0], "comment", hrComment.data.id) &&
      has(allViews[2], "post", hrOnlyPost.data.id) && has(allViews[3], "post", hrOnlyPost.data.id),
    "IT/Accounting excluded; HR member + Admin included");
  check(36, "Comments on Draft/Archived/inaccessible parents absent from Search",
    allViews.every((list) => !has(list, "comment", draftComment.data.id) && !has(list, "comment", archivedComment.data.id)) &&
      !has(allViews[0], "comment", hrComment.data.id) && !has(allViews[1], "comment", hrComment.data.id) &&
      (await search(ali, { q: "Draft note: add screenshots" })).data.total === 0);

  // Security extras: SQL injection text and LIKE wildcards are plain text.
  const injection = await search(ali, { q: "' OR 1=1; DROP TABLE posts; --" });
  const wildcard = await search(ali, { q: "%" });
  const stillThere = await ali.json("/api/posts");
  check("S1", "SQL injection / wildcard text treated as plain text",
    injection.status === 200 && injection.data.total === 0 && wildcard.status === 200 &&
      wildcard.data.total === 0 && stillThere.status === 200,
    `injection total=${injection.data?.total}, "%" total=${wildcard.data?.total}`);

  const anon = await Promise.all([
    anonymous.json(`/api/search?q=${M}`),
    anonymous.request("/search?q=x"),
    anonymous.json(`/api/posts/${postId}/comments`),
    anonymous.json("/api/bookmarks"),
    anonymous.json("/api/profile"),
  ]);
  check("S2", "Unauthenticated Week 6 requests rejected",
    anon[0].status === 401 && [302, 303, 307].includes(anon[1].status) && anon[2].status === 401 &&
      anon[3].status === 401 && anon[4].status === 401, anon.map((r) => r.status).join(","));

  // ---------------- FULL JOURNEY ----------------
  const employee = await new Browser().login("ahmed@nozom.local");
  const J = `${M}journey`;
  const jPost = await newPost(employee, { title: `[TEST] Journey ${J}`, content: `How to request leave ${J}`, tag: "HR" });
  const jComment = await employee.json(`/api/posts/${jPost.data.id}/comments`, "POST", { content: `Tip ${J}` });
  const jBookmark = await employee.json("/api/bookmarks", "POST", { kind: "post", id: jPost.data.id });
  const jFileText = `Leave form ${J}`;
  const jFile = await employee.upload(`/api/posts/${jPost.data.id}/files`, { name: "leave-form.txt", type: "text/plain", bytes: Buffer.from(jFileText) });
  const jSearch = (await search(employee, { q: J })).data.results;
  const jResult = jSearch.find((r) => r.type === "post");
  const jOpen = await employee.html(`/posts/${jResult?.parentId}`);
  const jDownload = await employee.request(`/api/files/${jFile.data.id}/download`);
  const jDownloaded = await jDownload.text();
  check(37, "Full journey: login → post → comment → bookmark → upload → search → open → download",
    jPost.status === 201 && jComment.status === 201 && jBookmark.status === 201 && jFile.status === 201 &&
      jResult?.id === jPost.data.id && jSearch.some((r) => r.type === "comment") &&
      jOpen.status === 200 && jOpen.text.includes("leave-form.txt") && jOpen.text.includes(`Tip ${J}`) &&
      jDownload.status === 200 && jDownloaded === jFileText);

  // ---------------- REGRESSION ----------------
  const crudEdit = await ali.json(`/api/posts/${postId}`, "PATCH", { title: `[TEST] Week6 journey ${M} (edited)`, content: `Shared printer knowledge ${M}` });
  const crudForbidden = await ahmed.json(`/api/posts/${postId}`, "PATCH", { title: "x", content: "y" });
  const journeyKeys = await filesContaining(STORAGE, `Private TXT ${M}`);
  const crudDelete = await ali.json(`/api/posts/${postId}`, "DELETE");
  created.posts = created.posts.filter((p) => p.id !== postId);
  const filesRemoved = (await filesContaining(STORAGE, `Private TXT ${M}`)).length === 0;
  const commentGone = (await ali.json(`/api/comments/${c2.data.id}`)).status === 404;
  check(39, "Posts CRUD still works (delete also removes comments + private files)",
    crudEdit.status === 200 && crudForbidden.status === 403 && crudDelete.status === 200 &&
      journeyKeys.length === 1 && filesRemoved && commentGone);

  const memberPage = await ali.json("/api/pages", "POST", { title: "x", content: "y" });
  const memberPublish = await ali.json(`/api/pages/${page.data.id}`, "PATCH", { title: "x", content: "y", status: "archived" });
  const editorArchive = await mona.json(`/api/pages/${page.data.id}`, "PATCH", { title: `[TEST] Official ${M}`, content: `Official guidance ${M}`, status: "archived" });
  const aliAfterArchive = (await ali.json(`/api/pages/${page.data.id}`)).status;
  check(40, "Official Pages authorization still works",
    memberPage.status === 403 && memberPublish.status === 403 && editorArchive.status === 200 && aliAfterArchive === 404);

  console.log("\n(Test 38 = Week 5 regression: run `npm run test:week5`.)");
}

async function cleanup() {
  const admin = await new Browser().login("admin@nozom.local").catch(() => null);
  const mona = await new Browser().login("mona@nozom.local").catch(() => null);

  // API deletes remove private files from disk as well.
  for (const fileId of created.pageFiles) {
    if (fileId && mona) await mona.json(`/api/files/${fileId}`, "DELETE");
  }
  for (const { id } of created.posts) {
    if (admin) await admin.json(`/api/posts/${id}`, "DELETE");
  }
  for (const { id } of created.comments) {
    if (id && admin) await admin.json(`/api/comments/${id}`, "DELETE");
  }

  // Files on the seeded HR post (uploaded by the test) + leftover rows.
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(path.join(ROOT, ".env.local")); } catch { /* ignore */ }
  }
  if (!process.env.DATABASE_URL) return;

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const leftovers = await client.query(
      `SELECT id FROM files WHERE original_name LIKE $1`, [`%${M}%`]
    );
    for (const row of leftovers.rows) {
      if (admin) await admin.json(`/api/files/${row.id}`, "DELETE");
    }
    await client.query(`DELETE FROM comments WHERE content LIKE $1`, [`%${M}%`]);
    await client.query(`DELETE FROM pages WHERE title LIKE '[TEST]%'`);
    await client.query(`DELETE FROM posts WHERE title LIKE '[TEST]%'`);
  } finally {
    await client.end();
  }
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. (BASE_URL=${BASE})`);
process.exitCode = failed.length || exitCode ? 1 : 0;
