/* eslint-disable */
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { OTP_TTL_SECONDS, OTP_RESEND_COOLDOWN_SECONDS, MIN_PASSWORD_LENGTH } from "@/config";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Check,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Logo } from "@/components/Logo";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();

  // Phase state: 1 = Enter OTP, 2 = Set New Password
  const [phase, setPhase] = useState<1 | 2>(1);

  // Email state
  const [email, setEmail] = useState("");

  // Phase 1 (OTP) states
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [otpTimeLeft, setOtpTimeLeft] = useState(OTP_TTL_SECONDS);
  const [isOtpExpired, setIsOtpExpired] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isOtpLocked, setIsOtpLocked] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [otpError, setOtpError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);

  // Phase 2 (New Password) states
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [isFinalSuccess, setIsFinalSuccess] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 1. Redirect if user is already authenticated
  useEffect(() => {
    if (!isAuthLoading && user && user.id !== "0" && user.username !== "guest") {
      router.replace("/dashboard");
    }
  }, [user, isAuthLoading, router]);

  // 2. Load email from sessionStorage; redirect to /forgot-password if missing
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedEmail = sessionStorage.getItem("resetEmail");
    if (!storedEmail) {
      router.replace("/forgot-password");
      return;
    }
    setEmail(storedEmail);

    // Check locked state from previous 429
    if (sessionStorage.getItem("resetLocked") === "true") {
      setIsOtpLocked(true);
      setOtpError(t.auth.forgotFlow.errors.tooManyAttemptsLock);
    }

    // Initialize resend cooldown from resetLastSentAt
    const lastSentStr = sessionStorage.getItem("resetLastSentAt");
    if (lastSentStr) {
      const lastSent = parseInt(lastSentStr, 10);
      const elapsed = Math.floor((Date.now() - lastSent) / 1000);
      const remaining = Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsed);
      setResendCooldown(remaining);
    }
  }, [router, t]);

  // 3. OTP Countdown timer (Phase 1)
  useEffect(() => {
    if (phase !== 1) return;
    const updateCountdown = () => {
      const expiresAtStr = sessionStorage.getItem("resetExpiresAt");
      if (!expiresAtStr) return;
      const expiresAt = parseInt(expiresAtStr, 10);
      const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setOtpTimeLeft(diff);
      if (diff <= 0) {
        setIsOtpExpired(true);
      } else {
        setIsOtpExpired(false);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // 4. Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Mask email: ab***@gmail.com
  const maskEmail = (raw: string): string => {
    if (!raw) return "";
    const parts = raw.split("@");
    if (parts.length !== 2) return raw;
    const [name, domain] = parts;
    if (name.length <= 2) {
      return `${name.charAt(0)}***@${domain}`;
    }
    return `${name.slice(0, 2)}***@${domain}`;
  };

  // ==================== PHASE 1: OTP LOGIC ====================

  const handleOtpChange = (index: number, value: string) => {
    if (isOtpExpired || isOtpLocked) return;
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned && value !== "") return;

    const newOtp = [...otp];
    newOtp[index] = cleaned.slice(-1);
    setOtp(newOtp);
    if (otpError) setOtpError("");

    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto advance to Phase 2 when all 6 digits entered (WITHOUT calling API)
    if (cleaned && index === 5 && newOtp.every((d) => d.length === 1)) {
      goToPhase2(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    if (isOtpExpired || isOtpLocked) return;
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;

    const newOtp = [...otp];
    for (let i = 0; i < pasted.length; i++) {
      newOtp[i] = pasted[i];
    }
    setOtp(newOtp);
    if (otpError) setOtpError("");

    const nextIdx = Math.min(pasted.length, 5);
    inputRefs.current[nextIdx]?.focus();

    if (pasted.length === 6) {
      goToPhase2(pasted);
    }
  };

  const goToPhase2 = (code?: string) => {
    const fullCode = code || otp.join("");
    if (fullCode.length !== 6 || isOtpExpired || isOtpLocked) return;
    setOtpError("");
    setPasswordError("");
    setPhase(2);
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isResending || !email) return;

    try {
      setIsResending(true);
      setOtpError("");
      setResendNotice("");

      await authApi.forgotPassword(email);

      const now = Date.now();
      const newExpiresAt = now + OTP_TTL_SECONDS * 1000;
      sessionStorage.setItem("resetExpiresAt", newExpiresAt.toString());
      sessionStorage.setItem("resetLastSentAt", now.toString());
      sessionStorage.removeItem("resetLocked");

      setOtpTimeLeft(OTP_TTL_SECONDS);
      setIsOtpExpired(false);
      setIsOtpLocked(false);
      setOtp(["", "", "", "", "", ""]);
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setResendNotice(t.auth.forgotFlow.resendSuccess || "Đã gửi lại mã xác nhận nếu tài khoản tồn tại.");
      setTimeout(() => setResendNotice(""), 4000);

      inputRefs.current[0]?.focus();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 429) {
        const retryAfter = err.data?.retryAfter || OTP_RESEND_COOLDOWN_SECONDS;
        setResendCooldown(retryAfter);
        setOtpError(
          t.auth.forgotFlow.errors.rateLimited.replace("{seconds}", retryAfter.toString())
        );
      } else if (err instanceof ApiError && err.status === 502) {
        setOtpError(t.auth.forgotFlow.errors.server502);
      } else {
        setOtpError(t.auth.forgotFlow.errors.network);
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleChangeEmail = () => {
    sessionStorage.removeItem("resetEmail");
    sessionStorage.removeItem("resetExpiresAt");
    sessionStorage.removeItem("resetLastSentAt");
    sessionStorage.removeItem("resetLocked");
    router.push("/forgot-password");
  };

  // ==================== PHASE 2: NEW PASSWORD LOGIC ====================

  const rules = {
    length: newPassword.length >= MIN_PASSWORD_LENGTH,
    alphanumeric: /^[A-Za-z0-9]+$/.test(newPassword),
    match: confirmPassword.length > 0 && newPassword === confirmPassword,
  };

  const canSubmitPhase2 =
    rules.length &&
    rules.alphanumeric &&
    rules.match &&
    !isResettingPassword;

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitPhase2) return;

    const fullOtp = otp.join("");
    if (fullOtp.length !== 6) {
      setPhase(1);
      setOtpError(t.auth.forgotFlow.errors.otpRequired);
      return;
    }

    try {
      setIsResettingPassword(true);
      setPasswordError("");

      await authApi.resetPassword({
        email,
        otp: fullOtp,
        new_password: newPassword,
      });

      // Clear all temporary sessionStorage items
      sessionStorage.removeItem("resetEmail");
      sessionStorage.removeItem("resetExpiresAt");
      sessionStorage.removeItem("resetLastSentAt");
      sessionStorage.removeItem("resetLocked");

      // Save toast message for /login page
      sessionStorage.setItem("loginToastSuccess", t.auth.forgotFlow.resetSuccessToast);

      setIsFinalSuccess(true);

      setTimeout(() => {
        router.push("/login?resetSuccess=true");
      }, 1200);
    } catch (err: any) {
      if (err instanceof ApiError) {
        const detail = (typeof err.data?.detail === "string" ? err.data.detail : err.message || "").toLowerCase();

        // 1. Password error 400
        if (err.status === 400 && (detail.includes("special") || detail.includes("alphanumeric"))) {
          setPasswordError(t.auth.forgotFlow.errors.passwordSpecialChars);
          return;
        }
        if (err.status === 400 && (detail.includes("least") || detail.includes("short") || detail.includes("character"))) {
          setPasswordError(t.auth.forgotFlow.errors.passwordMinLength);
          return;
        }

        // 2. 429 Too many attempts (locks OTP input, requires requesting new code after cooldown)
        if (err.status === 429 || detail.includes("too many attempts")) {
          setPhase(1);
          setOtp(["", "", "", "", "", ""]);
          setIsOtpLocked(true);
          sessionStorage.setItem("resetLocked", "true");
          setOtpError(t.auth.forgotFlow.errors.tooManyAttemptsLock);
          return;
        }

        // 3. 400 Invalid or expired code
        if (err.status === 400 || detail.includes("invalid") || detail.includes("expired")) {
          setPhase(1);
          setOtp(["", "", "", "", "", ""]);
          setShakeKey((k) => k + 1);
          setOtpError(t.auth.forgotFlow.errors.invalidOrExpiredCode);
          setTimeout(() => {
            inputRefs.current[0]?.focus();
          }, 50);
          return;
        }

        // 4. 502 Bad Gateway
        if (err.status === 502) {
          setPasswordError(t.auth.forgotFlow.errors.server502);
          return;
        }

        // 5. Network error
        if (err.status === 0 || err.message === "REQUEST_TIMEOUT" || err.message === "NETWORK_ERROR") {
          setPasswordError(t.auth.forgotFlow.errors.network);
          return;
        }

        // Other server error
        if (err.status >= 500) {
          setPasswordError(t.auth.forgotFlow.errors.server);
          return;
        }

        setPasswordError(err.message || t.auth.forgotFlow.errors.network);
      } else {
        setPasswordError(t.auth.forgotFlow.errors.network);
      }
    } finally {
      setIsResettingPassword(false);
    }
  };

  const formattedOtpTimer = `${String(Math.floor(otpTimeLeft / 60)).padStart(2, "0")}:${String(
    otpTimeLeft % 60
  ).padStart(2, "0")}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative font-sans">
      <Link
        href="/login"
        className="absolute top-6 left-6 flex items-center gap-2 text-gray-500 hover:text-navy-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm font-medium">{t.auth.backToLogin}</span>
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full space-y-6 bg-white p-8 rounded-xl shadow-lg border border-gray-100"
      >
        {/* Header & Step Indicator */}
        <div className="flex flex-col items-center">
          <Logo className="mb-2" />

          {/* 1/2 and 2/2 Step Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-semibold mb-3 border border-sky-100">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
            <span>
              {phase === 1 ? t.auth.forgotFlow.phase1Step : t.auth.forgotFlow.phase2Step}
            </span>
          </div>

          <h2 className="text-center text-2xl font-bold text-navy-900">
            {phase === 1
              ? t.auth.forgotFlow.phase1Title
              : t.auth.forgotFlow.phase2Title}
          </h2>
          <p className="mt-1 text-center text-sm text-gray-600">
            {phase === 1
              ? t.auth.forgotFlow.phase1Desc
              : t.auth.forgotFlow.phase2Desc}
          </p>
        </div>

        {/* ======================================================== */}
        {/* BƯỚC 1: THU THẬP MÃ OTP 6 CHỮ SỐ (CHƯA GỌI API) */}
        {/* ======================================================== */}
        {phase === 1 && (
          <div className="space-y-5">
            {/* Masked Email Banner */}
            <div className="bg-sky-50/70 border border-sky-100 rounded-lg p-3 flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="block text-[11px] text-gray-500 font-medium">
                  {t.auth.forgotFlow.maskedEmailPrefix}
                </span>
                <span className="font-semibold text-sm text-navy-900 truncate block">
                  {maskEmail(email)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleChangeEmail}
                className="text-xs text-sky-600 hover:text-sky-700 font-semibold underline shrink-0 transition-colors"
              >
                {t.auth.forgotFlow.changeEmail}
              </button>
            </div>

            {/* 6 OTP boxes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                  {t.auth.forgotFlow.enterOtp}
                </label>
              </div>

              <motion.div
                key={shakeKey}
                animate={shakeKey > 0 ? { x: [-10, 10, -8, 8, -4, 4, 0] } : {}}
                transition={{ duration: 0.4 }}
                className="flex justify-between gap-2"
              >
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    disabled={isOtpExpired || isOtpLocked}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={handleOtpPaste}
                    className={`w-11 h-12 text-center text-xl font-bold font-mono rounded-lg border transition-all focus:outline-none ${
                      isOtpExpired || isOtpLocked
                        ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                        : digit
                        ? "border-sky-500 bg-sky-50/30 text-navy-900 shadow-sm"
                        : "border-gray-300 bg-white text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    }`}
                  />
                ))}
              </motion.div>

              {/* Countdown & Resend */}
              <div className="flex items-center justify-between mt-2.5 text-xs">
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  {isOtpExpired ? (
                    <span className="text-red-600 font-semibold">
                      {t.auth.forgotFlow.codeExpired}
                    </span>
                  ) : (
                    <span className="text-gray-600">
                      {t.auth.forgotFlow.codeExpiresIn}{" "}
                      <span className="font-mono font-bold text-sky-600">
                        {formattedOtpTimer}
                      </span>
                    </span>
                  )}
                </div>

                <div>
                  {resendCooldown > 0 ? (
                    <span className="text-gray-400 font-mono">
                      {t.auth.forgotFlow.resendCooldown.replace(
                        "{seconds}",
                        resendCooldown.toString()
                      )}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={isResending}
                      className="text-sky-600 hover:text-sky-700 font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${isResending ? "animate-spin" : ""}`}
                      />
                      <span>
                        {isOtpLocked
                          ? t.auth.forgotFlow.requestNewCode || "Gửi mã mới"
                          : t.auth.forgotFlow.resendOtp}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Resend Success Notice */}
            {resendNotice && (
              <div className="bg-sky-50 border border-sky-200 text-sky-800 text-xs p-3 rounded-lg flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-sky-600" />
                <span className="leading-relaxed">{resendNotice}</span>
              </div>
            )}

            {/* Error Display */}
            {otpError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                <span className="leading-relaxed">{otpError}</span>
              </div>
            )}

            {/* Continue Button to Step 2 (NO API call here) */}
            <Button
              type="button"
              onClick={() => goToPhase2()}
              disabled={
                otp.some((d) => !d) ||
                isOtpExpired ||
                isOtpLocked
              }
              className="w-full h-11 text-base font-semibold"
            >
              {t.auth.forgotFlow.continueButton || "Tiếp tục"}
            </Button>
          </div>
        )}

        {/* ======================================================== */}
        {/* BƯỚC 2: THIẾT LẬP MẬT KHẨU MỚI & GỬI API DUY NHẤT */}
        {/* ======================================================== */}
        {phase === 2 && (
          <div>
            {isFinalSuccess ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-green-50 text-green-800 p-6 rounded-xl text-center space-y-3 border border-green-200"
              >
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <CheckCircle className="w-7 h-7" />
                </div>
                <h3 className="font-semibold text-lg text-green-900">
                  {t.auth.forgotFlow.resetSuccessToast}
                </h3>
                <p className="text-xs text-green-700">
                  {t.auth.forgotFlow.redirectingToLogin}
                </p>
              </motion.div>
            ) : (
              <form className="space-y-5" onSubmit={handleResetPassword} noValidate>
                {/* Back to Step 1 Button */}
                <div className="flex justify-between items-center text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPhase(1);
                      setPasswordError("");
                    }}
                    className="text-sky-600 hover:text-sky-700 font-semibold inline-flex items-center gap-1 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Sửa mã OTP ({otp.join("")})</span>
                  </button>
                  <span className="text-gray-500 font-mono">
                    {maskEmail(email)}
                  </span>
                </div>

                {/* New Password Input */}
                <div>
                  <label
                    htmlFor="new-password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t.auth.forgotFlow.newPasswordLabel}
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (passwordError) setPasswordError("");
                      }}
                      disabled={isResettingPassword}
                      placeholder={t.auth.forgotFlow.newPasswordPlaceholder}
                      className="w-full bg-white border border-gray-300 text-gray-900 rounded-lg p-2.5 pr-10 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Password rules checklist */}
                  <div className="mt-2.5 p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-2">
                    <div className="text-xs font-medium text-gray-600">
                      {t.auth.forgotFlow.rules.title}
                    </div>

                    <div className="text-[11px] space-y-1 pt-0.5">
                      {/* Rule 1: Min length (MIN_PASSWORD_LENGTH) */}
                      <div
                        className={`flex items-center gap-1.5 ${
                          rules.length ? "text-green-600 font-medium" : "text-gray-400"
                        }`}
                      >
                        {rules.length ? (
                          <Check className="w-3.5 h-3.5 text-green-600 stroke-[3]" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
                        )}
                        <span>{t.auth.forgotFlow.rules.minLength}</span>
                      </div>

                      {/* Rule 2: Letters and digits only */}
                      <div
                        className={`flex items-center gap-1.5 ${
                          rules.alphanumeric ? "text-green-600 font-medium" : "text-gray-400"
                        }`}
                      >
                        {rules.alphanumeric ? (
                          <Check className="w-3.5 h-3.5 text-green-600 stroke-[3]" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
                        )}
                        <span>{t.auth.forgotFlow.rules.alphanumeric}</span>
                      </div>

                      {/* Rule 3: Passwords match */}
                      <div
                        className={`flex items-center gap-1.5 ${
                          rules.match ? "text-green-600 font-medium" : "text-gray-400"
                        }`}
                      >
                        {rules.match ? (
                          <Check className="w-3.5 h-3.5 text-green-600 stroke-[3]" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
                        )}
                        <span>{t.auth.forgotFlow.rules.match}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Confirm New Password Input */}
                <div>
                  <label
                    htmlFor="confirm-password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t.auth.forgotFlow.confirmNewPasswordLabel}
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setConfirmTouched(true);
                        if (passwordError) setPasswordError("");
                      }}
                      onBlur={() => setConfirmTouched(true)}
                      disabled={isResettingPassword}
                      placeholder={t.auth.forgotFlow.confirmNewPasswordPlaceholder}
                      className={`w-full bg-white border rounded-lg p-2.5 pr-10 text-sm focus:outline-none focus:ring-2 transition-colors ${
                        confirmTouched && confirmPassword && !rules.match
                          ? "border-red-500 focus:border-red-500 focus:ring-red-100"
                          : confirmTouched && rules.match
                          ? "border-green-500 focus:border-green-500 focus:ring-green-100"
                          : "border-gray-300 focus:border-sky-500 focus:ring-sky-100"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {confirmTouched && confirmPassword && !rules.match && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{t.auth.forgotFlow.errors.passwordMismatch}</span>
                    </p>
                  )}
                </div>

                {/* Password Error Display */}
                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                    <span className="leading-relaxed">{passwordError}</span>
                  </div>
                )}

                {/* Submit Reset Button */}
                <Button
                  type="submit"
                  disabled={!canSubmitPhase2}
                  className="w-full h-11 text-base font-semibold"
                >
                  {isResettingPassword
                    ? t.auth.forgotFlow.resettingPasswordButton
                    : t.auth.forgotFlow.resetPasswordButton}
                </Button>
              </form>
            )}
          </div>
        )}

        <div className="text-center pt-1">
          <Link
            href="/login"
            className="text-sm font-medium text-sky-600 hover:text-sky-700 transition-colors"
          >
            {t.auth.backToLogin}
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
