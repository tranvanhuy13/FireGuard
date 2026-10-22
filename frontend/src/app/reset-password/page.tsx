/* eslint-disable */
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/api/auth";
import { isMockAuth, ApiError } from "@/lib/api/client";
import { PasswordRequirements, checkPasswordRules, isPasswordValid } from "@/components/PasswordRequirements";
import { 
  ArrowLeft, 
  Lock, 
  Eye, 
  EyeOff, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Clock,
  KeyRound,
  ShieldCheck
} from "lucide-react";
import { Logo } from "@/components/Logo";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();

  // Phase state: 1 = Verify OTP, 2 = Set New Password
  const [phase, setPhase] = useState<1 | 2>(1);
  // Keep the verified OTP only in React state; never persist it or put it in the URL.
  const [verifiedOtp, setVerifiedOtp] = useState<string | null>(null);

  // Email and session
  const [email, setEmail] = useState("");

  // Phase 1 (OTP) states
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [otpTimeLeft, setOtpTimeLeft] = useState(120);
  const [isOtpExpired, setIsOtpExpired] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendCount, setResendCount] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(5);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [showOtpSuccessBadge, setShowOtpSuccessBadge] = useState(false);

  // Phase 2 (New Password) states
  const [tokenTimeLeft, setTokenTimeLeft] = useState(600); // 10 minutes default
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

    const storedAttempts = sessionStorage.getItem("resetAttempts");
    if (storedAttempts) {
      setAttemptsLeft(parseInt(storedAttempts, 10));
    }

    const lockedUntil = parseInt(sessionStorage.getItem("resetLockedUntil") || "0", 10);
    if (lockedUntil > Date.now()) {
      const remainingMin = Math.ceil((lockedUntil - Date.now()) / (60 * 1000));
      setLockedMinutes(remainingMin);
    }
  }, [router]);

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

  // 5. Verified OTP countdown timer
  useEffect(() => {
    if (phase !== 2 || !verifiedOtp) return;

    const timer = setInterval(() => {
      setTokenTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Token expired: redirect back to /forgot-password
          alert(t.auth.forgotFlow.tokenExpiredError);
          router.replace("/forgot-password");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, verifiedOtp, router, t]);

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
    if (isOtpExpired || lockedMinutes) return;
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned && value !== "") return;

    const newOtp = [...otp];
    newOtp[index] = cleaned.slice(-1);
    setOtp(newOtp);
    if (otpError) setOtpError("");

    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto submit when all 6 digits entered
    if (cleaned && index === 5 && newOtp.every((d) => d.length === 1)) {
      triggerVerifyOtp(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    if (isOtpExpired || lockedMinutes) return;
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
      triggerVerifyOtp(pasted);
    }
  };

  const triggerVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify || otp.join("");
    if (code.length !== 6 || isVerifyingOtp || isOtpExpired || lockedMinutes) return;

    try {
      setIsVerifyingOtp(true);
      setOtpError("");

      const res = await authApi.verifyResetOtp({
        email,
        otp: code,
      });

      // Show temporary green checkmark
      setShowOtpSuccessBadge(true);
      setVerifiedOtp(code);
      setTokenTimeLeft(res.expiresIn);

      // Transition to Phase 2 after 700ms
      setTimeout(() => {
        setShowOtpSuccessBadge(false);
        setPhase(2);
      }, 700);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const min = Math.ceil((err.data?.remainingSec || 300) / 60);
          setLockedMinutes(min);
          setOtpError(
            t.auth.forgotFlow.errors.tooManyAttempts.replace("{minutes}", min.toString())
          );
        } else if (err.data?.remainingAttempts !== undefined) {
          const rem = err.data.remainingAttempts;
          setAttemptsLeft(rem);
          setOtpError(
            t.auth.forgotFlow.errors.otpInvalid.replace("{attempts}", rem.toString())
          );
        } else if (err.message === "INVALID_OTP") {
          const remainingAttempts = Math.max(0, (attemptsLeft ?? 5) - 1);
          setAttemptsLeft(remainingAttempts);
          sessionStorage.setItem("resetAttempts", remainingAttempts.toString());
          setOtpError(
            t.auth.forgotFlow.errors.otpInvalid.replace("{attempts}", remainingAttempts.toString())
          );
        } else if (err.message === "OTP_EXPIRED") {
          setIsOtpExpired(true);
          setOtpError(t.auth.forgotFlow.errors.otpExpired);
        } else if (err.status === 0 || err.message === "REQUEST_TIMEOUT") {
          setOtpError(t.auth.forgotFlow.errors.network);
        } else if (err.status >= 500) {
          setOtpError(t.auth.forgotFlow.errors.server);
        } else {
          setOtpError(err.message || t.auth.forgotFlow.errors.otpInvalid.replace("{attempts}", "4"));
        }
      } else {
        setOtpError(t.auth.forgotFlow.errors.network);
      }

      // On incorrect OTP: clear only 6 OTP inputs and shake
      setOtp(["", "", "", "", "", ""]);
      setShakeKey((prev) => prev + 1);
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 50);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resendCount >= 3 || isResending || !email) return;

    try {
      setIsResending(true);
      setOtpError("");
      await authApi.forgotPassword(email);

      const newExpiresAt = Date.now() + 120 * 1000;
      sessionStorage.setItem("resetExpiresAt", newExpiresAt.toString());
      sessionStorage.setItem("resetAttempts", "5");
      sessionStorage.removeItem("resetLockedUntil");

      setOtpTimeLeft(120);
      setIsOtpExpired(false);
      setAttemptsLeft(5);
      setLockedMinutes(null);
      setOtp(["", "", "", "", "", ""]);
      setResendCooldown(30);
      setResendCount((prev) => prev + 1);

      inputRefs.current[0]?.focus();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 429) {
        const retryAfter = err.data?.retryAfter || 30;
        setResendCooldown(retryAfter);
        setOtpError(
          t.auth.forgotFlow.errors.rateLimited.replace("{seconds}", retryAfter.toString())
        );
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
    sessionStorage.removeItem("resetAttempts");
    sessionStorage.removeItem("resetLockedUntil");
    router.push("/forgot-password");
  };

  // ==================== PHASE 2: NEW PASSWORD LOGIC ====================

  const passwordRules = checkPasswordRules(newPassword);
  const passwordValid = isPasswordValid(passwordRules);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;

  const canSubmitPhase2 =
    passwordValid &&
    passwordsMatch &&
    !isResettingPassword &&
    !!verifiedOtp;

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitPhase2 || !verifiedOtp) return;

    try {
      setIsResettingPassword(true);
      setPasswordError("");

      await authApi.resetPassword({
        email,
        otp: verifiedOtp,
        newPassword,
      });

      // Clear all temporary sessionStorage items
      sessionStorage.removeItem("resetEmail");
      sessionStorage.removeItem("resetExpiresAt");
      sessionStorage.removeItem("resetAttempts");
      sessionStorage.removeItem("resetLockedUntil");

      // Save toast message for /login page
      sessionStorage.setItem("loginToastSuccess", t.auth.forgotFlow.resetSuccessToast);

      setIsFinalSuccess(true);

      setTimeout(() => {
        router.push("/login?resetSuccess=true");
      }, 1200);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 400 && err.message === "OTP_EXPIRED") {
          alert(t.auth.forgotFlow.tokenExpiredError);
          router.replace("/forgot-password");
          return;
        }
        if (err.message === "INVALID_OTP") {
          setPasswordError(
            t.auth.forgotFlow.errors.otpInvalid.replace("{attempts}", (attemptsLeft ?? 5).toString())
          );
          return;
        }
        if (err.status >= 500) {
          setPasswordError(t.auth.forgotFlow.errors.server);
        } else {
          setPasswordError(err.message || t.auth.forgotFlow.errors.network);
        }
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

  const formattedTokenTimer = `${String(Math.floor(tokenTimeLeft / 60)).padStart(2, "0")}:${String(
    tokenTimeLeft % 60
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
        {/* GIAI ĐOẠN 1: XÁC THỰC MÃ OTP */}
        {/* ======================================================== */}
        {phase === 1 && (
          <div className="space-y-5">
            {showOtpSuccessBadge ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-green-50 text-green-800 p-6 rounded-xl text-center space-y-2 border border-green-200"
              >
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <CheckCircle className="w-7 h-7" />
                </div>
                <h3 className="font-semibold text-base text-green-900">
                  {t.auth.forgotFlow.otpVerifiedSuccess}
                </h3>
              </motion.div>
            ) : (
              <>
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
                    {isMockAuth && (
                      <span className="text-[11px] font-mono text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        {t.auth.forgotFlow.mockOtpHint}
                      </span>
                    )}
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
                        disabled={isOtpExpired || !!lockedMinutes || isVerifyingOtp}
                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        onPaste={handleOtpPaste}
                        className={`w-11 h-12 text-center text-xl font-bold font-mono rounded-lg border transition-all focus:outline-none ${
                          isOtpExpired || !!lockedMinutes
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
                        <span className="text-gray-400">
                          {t.auth.forgotFlow.resendCooldown.replace(
                            "{seconds}",
                            resendCooldown.toString()
                          )}
                        </span>
                      ) : resendCount >= 3 ? (
                        <span className="text-gray-400 italic">
                          {t.auth.forgotFlow.resendLimitReached}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendOtp}
                          disabled={isResending}
                          className="text-sky-600 hover:text-sky-700 font-semibold inline-flex items-center gap-1 transition-colors"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${isResending ? "animate-spin" : ""}`}
                          />
                          <span>{t.auth.forgotFlow.resendOtp}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Error Display */}
                {otpError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                    <span className="leading-relaxed">{otpError}</span>
                  </div>
                )}

                {/* Verify OTP Button */}
                <Button
                  type="button"
                  onClick={() => triggerVerifyOtp()}
                  disabled={
                    otp.some((d) => !d) ||
                    isVerifyingOtp ||
                    isOtpExpired ||
                    !!lockedMinutes
                  }
                  className="w-full h-11 text-base font-semibold"
                >
                  {isVerifyingOtp
                    ? t.auth.forgotFlow.verifyingOtpButton
                    : lockedMinutes
                    ? t.auth.forgotFlow.errors.tooManyAttempts.replace(
                        "{minutes}",
                        lockedMinutes.toString()
                      )
                    : t.auth.forgotFlow.verifyOtpButton}
                </Button>
              </>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* GIAI ĐOẠN 2: ĐẶT MẬT KHẨU MỚI */}
        {/* ======================================================== */}
        {phase === 2 && verifiedOtp && (
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
                {/* Reset session expiration countdown */}
                <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-2.5 flex items-center justify-between text-xs text-amber-800 font-medium">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    <span>{t.auth.forgotFlow.tokenExpiresIn}</span>
                  </span>
                  <span className="font-mono font-bold text-amber-900">
                    {formattedTokenTimer}
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

                  {/* Password strength meter and checklist (only visible while typing) */}
                  <PasswordRequirements password={newPassword} />
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
                        confirmTouched && confirmPassword && !passwordsMatch
                          ? "border-red-500 focus:border-red-500 focus:ring-red-100"
                          : confirmTouched && passwordsMatch
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

                  {confirmTouched && confirmPassword && !passwordsMatch && (
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
