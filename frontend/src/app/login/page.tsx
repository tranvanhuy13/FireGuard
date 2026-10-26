/* eslint-disable */
"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api/auth";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Eye, EyeOff, ArrowLeft, CheckCircle } from "lucide-react";
import { Logo } from "@/components/Logo";

function getSafeRedirect(redirect: string | null): string {
  if (!redirect) return "/dashboard";
  const trimmed = redirect.trim();
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.includes("\\") &&
    !trimmed.toLowerCase().includes("http") &&
    !trimmed.includes(":") &&
    !trimmed.startsWith("/login")
  ) {
    return trimmed;
  }
  return "/dashboard";
}

const getLoginSchema = (t: any) => z.object({
  identifier: z.string().min(1, t.auth.errors.identifierRequired),
  password: z.string().min(8, t.auth.errors.passwordMin),
});

type LoginForm = z.infer<ReturnType<typeof getLoginSchema>>;

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const { login, user, isLoading: authLoading } = useAuth();
  const loginSchema = getLoginSchema(t);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const verifiedParam = searchParams.get("verified");

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (!authLoading && user) {
      const safeRedirect = getSafeRedirect(searchParams.get("redirect"));
      router.replace(safeRedirect);
    }
  }, [authLoading, user, searchParams, router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Check verified parameter
      if (verifiedParam === "true") {
        setSuccessMsg(t.auth.verifySuccess);
      }

      // Check session toast
      const toast = sessionStorage.getItem("loginToastSuccess");
      if (toast) {
        setSuccessMsg(toast);
        sessionStorage.removeItem("loginToastSuccess");
      }

      // Remember me logic: ONLY save username in localStorage (never password)
      const savedUser = localStorage.getItem("remembered_username");
      if (savedUser) {
        setValue("identifier", savedUser);
        setRememberMe(true);
      }
    }
  }, [verifiedParam, setValue, t]);

  const onSubmit = async (data: LoginForm) => {
    try {
      setIsLoading(true);
      setError("");

      const trimmedIdentifier = data.identifier.trim();

      if (rememberMe) {
        localStorage.setItem("remembered_username", trimmedIdentifier);
      } else {
        localStorage.removeItem("remembered_username");
      }

      const res = await api.login({ identifier: trimmedIdentifier, password: data.password });
      await login(res.user);
      const safeRedirect = getSafeRedirect(searchParams.get("redirect"));
      router.replace(safeRedirect);
    } catch (err: any) {
      if (err.status === 403 || err.message === "accountNotVerified") {
        setError(t.auth.errors.accountNotVerified);
        setTimeout(() => {
          router.push(`/verify-otp?target=${encodeURIComponent(data.identifier.trim())}`);
        }, 1500);
      } else if (err.status === 401 || err.message === "invalidCredentials") {
        setError(t.auth.errors.invalidCredentials);
      } else {
        setError(err.message === "An error occurred" ? t.auth.errors.genericError : err.message || t.auth.errors.genericError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative font-sans">
      <Link href="/" className="absolute top-6 left-6 flex items-center gap-2 text-gray-500 hover:text-navy-900 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm font-medium">{t.auth.backToHome}</span>
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
            {t.auth.loginTitle}
          </h2>
        </div>

        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm p-3.5 rounded-xl flex items-center gap-2.5 shadow-sm">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
            <span className="font-medium text-xs sm:text-sm">{successMsg}</span>
          </div>
        )}

        <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-gray-700">
                {t.auth.usernameOrEmail}
              </label>
              <Input
                id="identifier"
                type="text"
                {...register("identifier")}
                className="mt-1 w-full bg-white border-gray-300 text-gray-900 focus:border-sky-500"
                placeholder={t.auth.usernameOrEmailPlaceholder}
              />
              {errors.identifier && (
                <p className="mt-1 text-sm text-red-600">{errors.identifier.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                {t.auth.password}
              </label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  {...register("password")}
                  className="w-full bg-white border-gray-300 text-gray-900 focus:border-sky-500 pr-10"
                  placeholder={t.auth.passwordPlaceholder}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700 cursor-pointer">
                {t.auth.rememberMe}
              </label>
            </div>

            <div className="text-sm">
              <Link href="/forgot-password" className="font-semibold text-sky-600 hover:text-sky-500">
                {t.auth.forgotPassword}
              </Link>
            </div>
          </div>

          {error && <div className="text-red-600 text-sm text-center bg-red-50 p-2.5 rounded-lg border border-red-200 mt-4">{error}</div>}

          <div className="pt-2">
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 text-base font-semibold"
            >
              {isLoading ? t.auth.signingIn : t.auth.signIn}
            </Button>
          </div>
        </form>

        <div className="text-center mt-4">
          <p className="text-sm text-gray-600">
            {t.auth.dontHaveAccount}{" "}
            <Link href="/register" className="font-semibold text-sky-600 hover:text-sky-700">
              {t.auth.signUp}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>}>
      <LoginFormContent />
    </Suspense>
  );
}
