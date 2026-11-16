import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Week 6 main employee journey in a real browser:
// Login -> Create Post -> Comment -> Bookmark -> Upload File -> Search
// -> open result -> Download File -> Bookmarks page -> clean up -> Logout
test("employee journey: post, comment, bookmark, file, search, download", async ({ page }) => {
  const marker = `e2e${Date.now().toString(36)}`;
  const title = `[TEST] E2E journey ${marker}`;
  const fileName = `e2e-notes-${marker}.txt`;
  const fileText = `Private E2E file ${marker}`;

  page.on("dialog", (dialog) => dialog.accept());

  // Login
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill("ali@nozom.local");
  await page.getByLabel("Password").fill("NozomDev#2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/feed/);
  await expect(page.getByText("Member · IT")).toBeVisible();

  // Create Post
  await page.getByRole("button", { name: "+ Add New Post" }).click();
  await page.getByPlaceholder("Title").fill(title);
  await page.getByPlaceholder("Content").fill(`E2E knowledge about printers ${marker}`);
  await page.locator("form.post-form select").first().selectOption("IT");
  await page.getByRole("button", { name: "Add Post" }).click();
  await page.getByRole("heading", { name: title }).click();
  await expect(page).toHaveURL(/\/posts\/\d+$/);
  const postUrl = page.url();

  // Comment
  await page.getByLabel("Add a comment").fill(`E2E comment ${marker}`);
  await page.getByRole("button", { name: "Add Comment" }).click();
  await expect(page.getByText(`E2E comment ${marker}`)).toBeVisible();

  // Bookmark
  await page.getByRole("button", { name: "☆ Bookmark" }).click();
  await expect(page.getByRole("button", { name: "★ Bookmarked" })).toBeVisible();

  // Unsupported file -> Arabic error, nothing uploaded
  const fileInput = page.getByLabel("Attach a PDF or TXT file (max 10 MB)");
  await fileInput.setInputFiles({ name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await page.getByRole("button", { name: "Upload File" }).click();
  await expect(page.locator(".form-error")).toContainText("نوع الملف غير مدعوم");

  // Upload a valid TXT file
  await fileInput.setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(fileText) });
  await page.getByRole("button", { name: "Upload File" }).click();
  await expect(page.getByRole("link", { name: fileName })).toBeVisible();

  // Search (keyword) finds the Post and the Comment
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Keyword").fill(marker);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Comment on “${title}”` })).toBeVisible();

  // Open the result and download the private file
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(postUrl);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: fileName }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(fileName);
  expect(await readFile(await download.path())).toEqual(Buffer.from(fileText));

  // Bookmarks page lists the saved Post
  await page.getByRole("link", { name: "Bookmarks" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Clean up: delete the Post (also removes its comments, bookmark and file)
  await page.goto(postUrl);
  await page.getByRole("button", { name: "Delete Post" }).click();
  await expect(page).toHaveURL(/\/feed$/);

  // Search no longer returns it
  await page.goto(`/search?q=${marker}`);
  await expect(page.getByRole("heading", { name: "No results" })).toBeVisible();

  // Logout
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});
