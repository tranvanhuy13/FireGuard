/* eslint-disable */
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { OTP_TTL_SECONDS, OTP_RESEND_COOLDOWN_SECONDS } from "@/config";
import { ArrowLeft, Mail, AlertCircle, CheckCircle } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);

  // Redirect to /dashboard if user is already logged in
  useEffect(() => {
    if (!isAuthLoading && user && user.id !== "0" && user.username !== "guest") {
      router.replace("/dashboard");
    }
  }, [user, isAuthLoading, router]);

  // Rate limit cooldown timer
  useEffect(() => {
    if (rateLimitCooldown <= 0) return;
    const timer = setInterval(() => {
      setRateLimitCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitCooldown]);

  const validateEmail = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return t.auth.forgotFlow.errors.emailRequired;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return t.auth.forgotFlow.errors.emailInvalid;
    }
    return "";
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    if (emailTouched) {
      setEmailError(validateEmail(val));
    }
    if (serverError) setServerError("");
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    setEmailError(validateEmail(email));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || rateLimitCooldown > 0) return;

    const validationErr = validateEmail(email);
    if (validationErr) {
      setEmailTouched(true);
      setEmailError(validationErr);
      return;
    }

    try {
      setIsLoading(true);
      setServerError("");

      await authApi.forgotPassword(email.trim());

      const now = Date.now();
      const expiresAt = now + OTP_TTL_SECONDS * 1000;
      sessionStorage.setItem("resetEmail", email.trim().toLowerCase());
      sessionStorage.setItem("resetExpiresAt", expiresAt.toString());
      sessionStorage.setItem("resetLastSentAt", now.toString());
      sessionStorage.removeItem("resetLocked");

      setIsSuccess(true);

      // Transition to step 2 after brief delay
      setTimeout(() => {
        router.push("/reset-password");
      }, 800);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const waitTime = err.data?.retryAfter || OTP_RESEND_COOLDOWN_SECONDS;
          setRateLimitCooldown(waitTime);
          setServerError(
            t.auth.forgotFlow.errors.rateLimited.replace("{seconds}", waitTime.toString())
          );
        } else if (err.status === 502) {
          setServerError(t.auth.forgotFlow.errors.server502);
        } else if (err.status === 0 || err.message === "REQUEST_TIMEOUT" || err.message === "NETWORK_ERROR") {
          setServerError(t.auth.forgotFlow.errors.network);
        } else if (err.status >= 500) {
          setServerError(t.auth.forgotFlow.errors.server);
        } else {
          setServerError(t.auth.forgotFlow.errors.network);
        }
      } else {
        setServerError(t.auth.forgotFlow.errors.network);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled =
    isLoading ||
    rateLimitCooldown > 0 ||
    !email.trim() ||
    (emailTouched && !!emailError);

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
        className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg border border-gray-100"
      >
        <div className="flex flex-col items-center">
          <Logo className="mb-4" />
          <h2 className="mt-2 text-center text-2xl font-bold text-navy-900">
            {t.auth.forgotFlow.step1Title}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t.auth.forgotFlow.step1Desc}
          </p>
        </div>

        {isSuccess ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-green-50 text-green-800 p-4 rounded-xl text-center text-sm font-medium border border-green-200 flex flex-col items-center gap-2"
          >
            <CheckCircle className="w-8 h-8 text-green-600 animate-pulse" />
            <p>{t.auth.forgotFlow.neutralNotice}</p>
          </motion.div>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t.auth.email}
              </label>
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={handleEmailChange}
                  onBlur={handleEmailBlur}
                  disabled={isLoading}
                  className={`w-full bg-white text-gray-900 pr-10 ${
                    emailTouched && emailError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:border-sky-500"
                  }`}
                  placeholder={t.auth.emailPlaceholder}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                  <Mail className="w-4 h-4" />
                </div>
              </div>
              {emailTouched && emailError && (
                <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{emailError}</span>
                </p>
              )}
            </div>

            {/* Neutral Security Notice Box */}
            <div className="bg-sky-50 border border-sky-100 rounded-lg p-3 text-xs text-sky-900/80 leading-relaxed">
              {t.auth.forgotFlow.neutralNotice}
            </div>

            {serverError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                <span>{serverError}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={isButtonDisabled}
              className="w-full h-11 text-base font-semibold"
            >
              {isLoading
                ? t.auth.forgotFlow.sendingOtp
                : rateLimitCooldown > 0
                ? t.auth.forgotFlow.resendCooldown.replace("{seconds}", rateLimitCooldown.toString())
                : t.auth.forgotFlow.sendOtp}
            </Button>

            <div className="text-center pt-2">
              <Link
                href="/login"
                className="text-sm font-medium text-sky-600 hover:text-sky-700 transition-colors"
              >
                {t.auth.backToLogin}
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
