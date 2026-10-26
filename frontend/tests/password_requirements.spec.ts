import { test, expect } from '@playwright/test';
import { checkPasswordRules, getPasswordStrengthScore, isPasswordValid, MIN_PASSWORD_LENGTH } from '../src/components/PasswordRequirements';

test.describe('Quy tắc & Độ mạnh Mật khẩu (Password Requirements Component)', () => {
  test('MIN_PASSWORD_LENGTH phải bằng 8 theo chuẩn hệ thống', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  test('checkPasswordRules kiểm tra chính xác 4 điều kiện: độ dài, chữ hoa, chữ thường, chữ số', () => {
    // 1. Rỗng
    const emptyRules = checkPasswordRules('');
    expect(emptyRules.length).toBe(false);
    expect(emptyRules.upper).toBe(false);
    expect(emptyRules.lower).toBe(false);
    expect(emptyRules.number).toBe(false);

    // 2. Chỉ có chữ thường ngắn
    const lowerOnly = checkPasswordRules('abc');
    expect(lowerOnly.length).toBe(false);
    expect(lowerOnly.upper).toBe(false);
    expect(lowerOnly.lower).toBe(true);
    expect(lowerOnly.number).toBe(false);

    // 3. Đủ độ dài nhưng thiếu chữ hoa và số
    const longLower = checkPasswordRules('abcdefgh');
    expect(longLower.length).toBe(true);
    expect(longLower.upper).toBe(false);
    expect(longLower.lower).toBe(true);
    expect(longLower.number).toBe(false);

    // 4. Có hoa, thường, đủ độ dài nhưng thiếu số
    const noNumber = checkPasswordRules('Abcdefgh');
    expect(noNumber.length).toBe(true);
    expect(noNumber.upper).toBe(true);
    expect(noNumber.lower).toBe(true);
    expect(noNumber.number).toBe(false);

    // 5. Thỏa mãn đầy đủ 4 tiêu chí
    const valid = checkPasswordRules('Abcdefg1');
    expect(valid.length).toBe(true);
    expect(valid.upper).toBe(true);
    expect(valid.lower).toBe(true);
    expect(valid.number).toBe(true);
  });

  test('getPasswordStrengthScore tính điểm chính xác từ 0 đến 4', () => {
    expect(getPasswordStrengthScore(checkPasswordRules(''))).toBe(0);
    expect(getPasswordStrengthScore(checkPasswordRules('a'))).toBe(1);
    expect(getPasswordStrengthScore(checkPasswordRules('aB'))).toBe(2);
    expect(getPasswordStrengthScore(checkPasswordRules('aB1'))).toBe(3);
    expect(getPasswordStrengthScore(checkPasswordRules('aB123456'))).toBe(4);
  });

  test('isPasswordValid chỉ trả về true khi thỏa mãn cả 4 điều kiện', () => {
    expect(isPasswordValid('')).toBe(false);
    expect(isPasswordValid('12345678')).toBe(false);
    expect(isPasswordValid('abcdefgh')).toBe(false);
    expect(isPasswordValid('ABCDEFGH')).toBe(false);
    expect(isPasswordValid('Abcdefgh')).toBe(false);
    expect(isPasswordValid('abcdefg1')).toBe(false);
    expect(isPasswordValid('ABCDEFG1')).toBe(false);
    expect(isPasswordValid('Ab1')).toBe(false); // Quá ngắn (< 8)

    // Hợp lệ:
    expect(isPasswordValid('TestPassword123')).toBe(true);
    expect(isPasswordValid('Vyvy12345678')).toBe(true);
  });
});
