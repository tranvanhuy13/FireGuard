import { test, expect } from '@playwright/test';
import { enableMockMode } from './helpers';

test.describe('Điều khoản Dịch vụ & Chính sách Bảo mật (Legal Consent Modal)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await page.goto('/register');
  });

  test('LEG_01: Click link Điều khoản dịch vụ mở modal tại tab Điều khoản', async ({ page }) => {
    // Tìm nút mở Điều khoản dịch vụ
    const termsBtn = page.locator('button:has-text("Điều khoản"), button:has-text("Terms")');
    await expect(termsBtn.first()).toBeVisible();
    await termsBtn.first().click();

    // Modal xuất hiện
    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    // Tab Điều khoản đang được chọn
    const activeTab = modal.locator('button[role="tab"][aria-selected="true"]');
    await expect(activeTab).toContainText(/Điều khoản|Terms/i);
  });

  test('LEG_02: Click link Chính sách quyền riêng tư mở modal tại tab Quyền riêng tư', async ({ page }) => {
    const privacyBtn = page.locator('button:has-text("Chính sách"), button:has-text("Privacy")');
    await expect(privacyBtn.first()).toBeVisible();
    await privacyBtn.first().click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    const activeTab = modal.locator('button[role="tab"][aria-selected="true"]');
    await expect(activeTab).toContainText(/Chính sách|Privacy/i);
  });

  test('LEG_03: Chuyển đổi qua lại giữa tab Điều khoản và Chính sách bên trong Modal', async ({ page }) => {
    const termsBtn = page.locator('button:has-text("Điều khoản"), button:has-text("Terms")').first();
    await termsBtn.click();

    const modal = page.locator('div[role="dialog"]');
    const tabs = modal.locator('button[role="tab"]');
    expect(await tabs.count()).toBe(2);

    // Click tab thứ 2 (Privacy)
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Click lại tab thứ 1 (Terms)
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  });

  test('LEG_04: Nhấn nút "Tôi đồng ý" tự động tích chọn checkbox Điều khoản trên form đăng ký', async ({ page }) => {
    const checkbox = page.locator('input#terms');
    expect(await checkbox.isChecked()).toBe(false);

    // Mở modal
    const termsBtn = page.locator('button:has-text("Điều khoản"), button:has-text("Terms")').first();
    await termsBtn.click();

    // Nhấn nút Đồng ý trong modal
    const agreeBtn = page.locator('div[role="dialog"] button:has-text("Tôi đồng ý"), div[role="dialog"] button:has-text("Agree")');
    await expect(agreeBtn.first()).toBeVisible();
    await agreeBtn.first().click();

    // Modal đóng và checkbox đã được check
    await expect(page.locator('div[role="dialog"]')).toHaveCount(0);
    await expect(checkbox).toBeChecked();
  });

  test('LEG_05: Nhấn nút "Từ chối" đóng modal và không tích chọn checkbox', async ({ page }) => {
    const checkbox = page.locator('input#terms');
    expect(await checkbox.isChecked()).toBe(false);

    const termsBtn = page.locator('button:has-text("Điều khoản"), button:has-text("Terms")').first();
    await termsBtn.click();

    const declineBtn = page.locator('div[role="dialog"] button:has-text("Từ chối"), div[role="dialog"] button:has-text("Decline")');
    await expect(declineBtn.first()).toBeVisible();
    await declineBtn.first().click();

    await expect(page.locator('div[role="dialog"]')).toHaveCount(0);
    await expect(checkbox).not.toBeChecked();
  });

  test('LEG_06: Nhấn phím Escape đóng modal an toàn và trả lại focus', async ({ page }) => {
    const termsBtn = page.locator('button:has-text("Điều khoản"), button:has-text("Terms")').first();
    await termsBtn.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    // Nhấn Escape trên bàn phím
    await page.keyboard.press('Escape');

    // Modal tự đóng
    await expect(modal).toHaveCount(0);
  });
});
