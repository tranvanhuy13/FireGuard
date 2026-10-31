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
import { PasswordRequirements, checkPasswordRules, isPasswordValid } from "@/components/PasswordRequirements";
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
    .refine(value => Array.from(value).length >= 8, t.auth.errors.passwordMin)
    .refine(value => new TextEncoder().encode(value).length <= 72, t.auth.errors.passwordTooLong)
    .refine(value => !value.includes("\0"), t.auth.errors.passwordInvalid),
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
  const confirmPasswordValue = watch("confirmPassword") || "";
  const passwordRules = checkPasswordRules(passwordValue);
  const passwordValid = isPasswordValid(passwordRules);
  const passwordsMatch = confirmPasswordValue.length > 0 && passwordValue === confirmPasswordValue;

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
      } else if (msg?.includes("Username must not contain special characters")) {
        setError(t.auth.errors.usernameNoSpecialChars);
      } else if (msg === "PASSWORD_TOO_LONG") {
        setError(t.auth.errors.passwordTooLong);
      } else if (msg === "PASSWORD_INVALID") {
        setError(t.auth.errors.passwordInvalid);
      } else if (msg?.includes("Please use a valid Gmail address")) {
        setError(t.auth.errors.emailGmailOnly);
      } else {
        setError(msg === "An error occurred" ? t.auth.errors.genericError : msg || t.auth.errors.genericError);
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
            <PasswordRequirements password={passwordValue} />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
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
            <Button
              type="submit"
              disabled={isLoading || !passwordValid || !passwordsMatch}
              className="w-full h-11 text-base font-semibold"
            >
              {isLoading ? t.auth.signingUp : t.auth.signUp}
            </Button>
          </div>
        </form>

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
