import { test, expect } from "./fixtures";

// IME (中文輸入法) composition: pressing Enter to confirm a candidate must NOT send the
// message. Real IMEs aren't scriptable in headless Chromium, so we synthesize the exact
// event streams real browsers produce — including the Safari/WebKit ordering where the
// committing keydown fires AFTER compositionend with isComposing already false
// (WebKit bug 165004). These guard the composition-ref fix the same way a real IME would.
//
// Video is enabled for these tests (test.use below) so the behavior is reviewable.

test.use({ video: "on" });

// Small helper so the recording has time to capture each visible state.
const beat = (ms = 450) => new Promise((r) => setTimeout(r, ms));

test("plain Enter sends the message (no composition)", async ({ page }) => {
  await page.goto("/");
  const box = page.getByPlaceholder(/Ask the coworker/);
  await expect(box).toBeVisible();
  await box.fill("hello agent");
  await beat();
  await box.press("Enter");
  await expect(page.getByText(/Echo: hello agent/)).toBeVisible();
  await beat();
});

test("Enter confirming an IME candidate does NOT send (Chrome/Firefox ordering)", async ({ page }) => {
  await page.goto("/");
  const box = page.getByPlaceholder(/Ask the coworker/);
  await expect(box).toBeVisible();
  await box.focus();
  await box.fill("你好"); // provisional text already in the box
  await beat();
  // Chrome/Firefox: the committing keydown carries isComposing=true.
  await page.evaluate(() => {
    const el = document.querySelector("textarea")!;
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
    );
  });
  await beat();
  await expect(page.getByText(/Echo:/)).toHaveCount(0); // nothing sent
  await expect(box).toHaveValue("你好"); // draft survives
  await beat();
});

test("Enter after compositionend does NOT send (WebKit/Safari ordering — the hardening target)", async ({ page }) => {
  await page.goto("/");
  const box = page.getByPlaceholder(/Ask the coworker/);
  await expect(box).toBeVisible();
  await box.focus();
  await box.fill("你好");
  await beat();
  // WebKit fires the committing keydown AFTER compositionend, with isComposing=false.
  // composingRef is set on compositionstart and reset one tick later, so this Enter —
  // arriving synchronously after compositionend — must still be swallowed.
  await page.evaluate(() => {
    const el = document.querySelector("textarea")!;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: false }),
    );
  });
  await beat();
  await expect(page.getByText(/Echo:/)).toHaveCount(0); // NOT sent — the fix works
  await expect(box).toHaveValue("你好");
  await beat();

  // And once the guard releases, a genuine Enter still sends.
  await box.press("Enter");
  await expect(page.getByText(/Echo: 你好/)).toBeVisible();
  await beat();
});
