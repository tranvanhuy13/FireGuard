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
import { isMockAuth } from "@/lib/api/client";
import { MIN_PASSWORD_LENGTH } from "@/config";
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
  password: z.string().min(MIN_PASSWORD_LENGTH, t.auth.errors.passwordMin),
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

  const handleSocialClick = () => {
    if (!isMockAuth) {
      setError(t.auth.errors.socialNotImplemented);
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

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">{t.auth.orContinueWith}</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button variant="outline" type="button" onClick={handleSocialClick} className="w-full flex items-center justify-center gap-2 h-11 border-gray-200 text-gray-700 font-medium">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </Button>
            <Button variant="outline" type="button" onClick={handleSocialClick} className="w-full flex items-center justify-center gap-2 h-11 border-gray-200 text-gray-700 font-medium">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2"/>
              </svg>
              Facebook
            </Button>
          </div>
        </div>

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
