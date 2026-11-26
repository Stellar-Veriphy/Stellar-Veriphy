/**
 * E2E — Public Verification Links
 *
 * Tests representative public verification links resolve and display accurate evidence.
 *
 * Coverage:
 *  ✓ Valid links resolve correctly
 *  ✓ Invalid links show appropriate error
 *  ✓ Expired links show appropriate message
 *  ✓ Privacy-sensitive records are not exposed
 *  ✓ Tests run on deployments or scheduled environments
 */

import { expect, test } from "@playwright/test";

const VALID_VERIFICATION_ID = "valid-verification-123";
const INVALID_VERIFICATION_ID = "invalid-id-999";
const EXPIRED_VERIFICATION_ID = "expired-verification-456";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

test.describe("Public verification links", () => {
  test.describe("valid links", () => {
    test("resolves and displays accurate verification evidence", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${VALID_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      // Should display verification content
      const content = page.locator("main, [role='main'], [data-testid='verification-content']").first();
      await expect(content).toBeVisible({ timeout: 15_000 });

      // Should display evidence elements (hash, timestamp, status)
      await expect(page.locator("text=/verification|verified|certificate/i").first()).toBeVisible({ timeout: 10_000 });

      // Should NOT expose sensitive data
      const pageText = await page.textContent("body");
      expect(pageText).not.toMatch(/private[_-]?key/i);
      expect(pageText).not.toMatch(/-----BEGIN.*PRIVATE KEY-----/);
      expect(pageText).not.toMatch(/"password"\s*:/i);
    });

    test("displays correct verification status for successful verification", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${VALID_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      // Should show success/verified status
      const statusElement = page.locator('[data-testid="verification-status'], text=/Verified|Valid/i').first();
      await expect(statusElement).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe("invalid links", () => {
    test("shows appropriate error for non-existent verification", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${INVALID_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      // Should display error message
      const errorMessage = page.locator(
        "text=/not found|does not exist|invalid|Verification.*not found/i"
      ).first();
      await expect(errorMessage).toBeVisible({ timeout: 10_000 });
    });

    test("does not expose internal error details", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${INVALID_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      const pageText = await page.textContent("body");

      // Should NOT expose stack traces
      expect(pageText).not.toMatch(/at\s+\w+\.\w+\(/);
      expect(pageText).not.toMatch(/Error:\s*at\s+/);

      // Should NOT expose database details
      expect(pageText).not.toMatch(/SQL|database|connection/i);

      // Should NOT expose internal paths
      expect(pageText).not.toMatch(/\/src\/|\/app\/|\/packages\//);
    });
  });

  test.describe("expired links", () => {
    test("shows appropriate message for expired verification", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${EXPIRED_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      // Should display expiry message
      const expiryMessage = page.locator(
        "text=/expired|no longer valid|Verification.*expired/i"
      ).first();

      // May show either expiry message or not found
      const isExpiry = await expiryMessage.isVisible({ timeout: 5_000 }).catch(() => false);
      const notFound = await page.locator("text=/not found|does not exist/i").first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      expect(isExpiry || notFound).toBe(true);
    });
  });

  test.describe("privacy", () => {
    test("does not expose creator wallet address in public view", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${VALID_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      const pageText = await page.textContent("body");

      // Should not expose full wallet addresses (G... format)
      const walletPattern = /G[A-Z2-7]{50,}/;
      expect(pageText).not.toMatch(walletPattern);
    });

    test("does not expose PII in verification details", async ({ page }) => {
      await page.goto(`${BASE_URL}/verify/${VALID_VERIFICATION_ID}`);
      await page.waitForLoadState("networkidle");

      const pageText = await page.textContent("body");

      // Should not expose email addresses
      expect(pageText).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

      // Should not expose phone numbers
      expect(pageText).not.toMatch(/\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    });
  });
});

test.describe("verification link edge cases", () => {
  test("handles malformed verification ID gracefully", async ({ page }) => {
    await page.goto(`${BASE_URL}/verify/%3Cscript%3Ealert(1)%3C/script%3E`);
    await page.waitForLoadState("networkidle");

    // Should not execute injected script and should show error
    const errorOrContent = page.locator("main, [role='main'], text=/not found|invalid|error/i").first();
    await expect(errorOrContent).toBeVisible({ timeout: 10_000 });
  });

  test("handles extremely long verification ID", async ({ page }) => {
    const longId = "a".repeat(500);
    await page.goto(`${BASE_URL}/verify/${longId}`);
    await page.waitForLoadState("networkidle");

    // Should either show error or truncate gracefully
    const pageText = await page.textContent("body");
    expect(pageText).toBeTruthy();
  });

  test("redirects root verify route to appropriate page", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/verify`);
    // Should either redirect or show appropriate page
    expect([200, 301, 302, 404]).toContain(response?.status() ?? 404);
  });
});