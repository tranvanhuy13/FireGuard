/* eslint-disable */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api/auth";
import { isMockAuth } from "@/lib/api/client";
import { MIN_PASSWORD_LENGTH } from "@/config";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

const getRegisterSchema = (t: any) => z.object({
  username: z.string()
    .min(3, t.auth.errors.usernameMin)
    .regex(/^[a-zA-Z0-9]+$/, t.auth.errors.usernameNoSpecialChars),
  email: z.string()
    .email(t.auth.errors.emailInvalid)
    .refine((val) => val.trim().toLowerCase().endsWith('@gmail.com'), {
      message: t.auth.errors.emailGmailOnly,
    }),
  password: z.string()
    .min(MIN_PASSWORD_LENGTH, t.auth.errors.passwordMin)
    .regex(/^[a-zA-Z0-9]+$/, t.auth.errors.passwordNoSpecialChars),
  confirmPassword: z.string(),
  terms: z.boolean().refine((val) => val === true, {
    message: t.auth.errors.termsRequired,
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: t.auth.errors.passwordMatch,
  path: ["confirmPassword"],
});

type RegisterForm = z.infer<ReturnType<typeof getRegisterSchema>>;

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const registerSchema = getRegisterSchema(t);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const passwordValue = watch("password") || "";

  // 0: weak, 1: fair, 2: good, 3: strong
  const getPasswordStrength = (pass: string) => {
    let score = 0;
    if (!pass) return -1;
    if (pass.length >= MIN_PASSWORD_LENGTH) score += 1;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 1;
    if (/\d/.test(pass) && pass.length >= 10) score += 1;
    return Math.min(3, score);
  };
  
  const strengthScore = getPasswordStrength(passwordValue);
  const strengthLabels = [t.auth.strengthWeak, t.auth.strengthFair, t.auth.strengthGood, t.auth.strengthStrong];
  const strengthColors = ["bg-red-500", "bg-yellow-500", "bg-sky-500", "bg-green-500"];

  const onSubmit = async (data: RegisterForm) => {
    try {
      setIsLoading(true);
      setError("");
      await api.register({
        username: data.username.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      });
      if (typeof window !== "undefined") {
        sessionStorage.setItem("verifyEmail", data.email.trim().toLowerCase());
      }
      router.push(`/verify-otp?target=${encodeURIComponent(data.email.trim().toLowerCase())}`);
    } catch (err: any) {
      const msg = err.message || err.detail;
      if (msg === "emailExists" || msg?.includes("Email already registered") || msg?.includes("Username already registered")) {
        setError(t.auth.errors.emailExists);
      } else if (msg?.includes("Username and password must not contain special characters")) {
        setError(t.auth.errors.usernameNoSpecialChars);
      } else if (msg?.includes("Please use a valid Gmail address")) {
        setError(t.auth.errors.emailGmailOnly);
      } else {
        setError(msg === "An error occurred" ? t.auth.errors.genericError : msg || t.auth.errors.genericError);
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
        className="max-w-md w-full space-y-6 bg-white p-8 rounded-xl shadow-lg border border-gray-100"
      >
        <div className="flex flex-col items-center">
          <Logo className="mb-4" />
          <h2 className="mt-2 text-center text-2xl font-bold text-navy-900">
            {t.auth.registerTitle}
          </h2>
        </div>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
              {t.auth.username}
            </label>
            <Input
              id="username"
              type="text"
              {...register("username")}
              className="mt-1 w-full bg-white border-gray-300 text-gray-900 focus:border-sky-500"
              placeholder={t.auth.usernamePlaceholder}
            />
            {errors.username && <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              {t.auth.email} (Gmail)
            </label>
            <Input
              id="email"
              type="email"
              {...register("email")}
              className="mt-1 w-full bg-white border-gray-300 text-gray-900 focus:border-sky-500"
              placeholder="example@gmail.com"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
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
            {errors.password ? (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            ) : strengthScore >= 0 ? (
              <div className="mt-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500">{t.auth.passwordStrength}</span>
                  <span className={`text-xs font-medium ${strengthScore === 0 ? 'text-red-600' : strengthScore === 1 ? 'text-yellow-600' : strengthScore === 2 ? 'text-sky-600' : 'text-green-600'}`}>
                    {strengthLabels[strengthScore]}
                  </span>
                </div>
                <div className="flex gap-1 h-1.5">
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className={`flex-1 rounded-full ${idx <= strengthScore ? strengthColors[strengthScore] : 'bg-gray-200'} transition-colors duration-300`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
              {t.auth.confirmPassword}
            </label>
            <div className="relative mt-1">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                {...register("confirmPassword")}
                className="w-full bg-white border-gray-300 text-gray-900 focus:border-sky-500 pr-10"
                placeholder={t.auth.confirmPasswordPlaceholder}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" {...register("terms")} className="mt-1 text-sky-600 focus:ring-sky-500 w-4 h-4 border-gray-300 rounded" />
              <span className="text-sm text-gray-600">
                {t.auth.termsAgree}{" "}
                <Link href="#" className="text-sky-600 hover:underline">{t.auth.termsLink}</Link> {t.auth.and}{" "}
                <Link href="#" className="text-sky-600 hover:underline">{t.auth.privacyPolicy}</Link>
              </span>
            </label>
            {errors.terms && <p className="mt-1 text-xs text-red-600">{errors.terms.message}</p>}
          </div>

          {error && <div className="text-red-600 text-sm text-center bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</div>}

          <div className="pt-2">
            <Button type="submit" disabled={isLoading} className="w-full h-11 text-base font-semibold">
              {isLoading ? t.auth.signingUp : t.auth.signUp}
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
            {t.auth.alreadyHaveAccount}{" "}
            <Link href="/login" className="font-semibold text-sky-600 hover:text-sky-700">
              {t.auth.signIn}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
