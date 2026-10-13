/* eslint-disable */
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { isMockMode } from "@/lib/api/client";
import { useLanguage } from "@/context/LanguageContext";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

function VerifyOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  
  const method = searchParams.get("method"); // 'email' or 'phone'
  const target = searchParams.get("target"); 

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [timeLeft, setTimeLeft] = useState(120);
  const [isExpired, setIsExpired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    let expiresAtStr = sessionStorage.getItem("otpExpiresAt");
    
    if (!expiresAtStr || parseInt(expiresAtStr) < Date.now()) {
      const newExpiresAt = Date.now() + 120 * 1000;
      sessionStorage.setItem("otpExpiresAt", newExpiresAt.toString());
      expiresAtStr = newExpiresAt.toString();
    }
    
    const expiresAt = parseInt(expiresAtStr);

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeLeft(diff);
      if (diff <= 0) {
        setIsExpired(true);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleResend = () => {
    const newExpiresAt = Date.now() + 120 * 1000;
    sessionStorage.setItem("otpExpiresAt", newExpiresAt.toString());
    setTimeLeft(120);
    setIsExpired(false);
    setOtp(["", "", "", "", "", ""]);
    setError("");
    inputRefs.current[0]?.focus();
  };

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedData) {
      const newOtp = [...otp];
      for (let i = 0; i < pastedData.length; i++) {
        newOtp[i] = pastedData[i];
      }
      setOtp(newOtp);
      const nextFocus = Math.min(pastedData.length, 5);
      inputRefs.current[nextFocus]?.focus();
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const otpString = otp.join("");
    if (otpString.length !== 6) {
      setError("OTP must be 6 digits");
      return;
    }
    
    setIsLoading(true);
    setError("");
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (otpString === "123456") {
        setIsSuccess(true);
        setTimeout(() => {
          router.push("/login?verified=true");
        }, 2000);
      } else {
        throw new Error(t.auth.errors.invalidOtp);
      }
    } catch (err: any) {
      setError(err.message === "An error occurred" ? t.auth.errors.genericError : err.message || t.auth.errors.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto submit when 6 digits are entered
  useEffect(() => {
    if (otp.join("").length === 6 && !isExpired && !isSuccess && !isLoading) {
      handleVerify();
    }
  }, [otp, isExpired, isSuccess, isLoading]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const getDesc = () => {
    if (method === "email") return t.auth.verifyDescEmail;
    if (method === "phone") return t.auth.verifyDescPhone;
    return t.auth.verifyDescGeneric;
  };

  const maskTarget = (str: string | null) => {
    if (!str) return "";
    if (str.includes("@")) {
      const [name, domain] = str.split("@");
      return `${name.charAt(0)}***@${domain}`;
    }
    return `*******${str.slice(-3)}`;
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-12 rounded-xl shadow-lg border border-gray-100 flex flex-col items-center text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600"
          >
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
          <h2 className="text-2xl font-bold text-navy-900 mb-2">{t.auth.verifySuccess}</h2>
          <p className="text-gray-500">{t.auth.redirectLogin}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative font-sans">
      <Link href="/register" className="absolute top-6 left-6 flex items-center gap-2 text-gray-500 hover:text-navy-900 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm font-medium">{t.auth.changeMethod}</span>
      </Link>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg border border-gray-100 text-center"
      >
        <div className="flex flex-col items-center">
          <Logo className="mb-4" />
          <h2 className="mt-2 text-3xl font-bold text-navy-900">
            {t.auth.verifyTitle}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {getDesc()} {target && <span className="font-semibold text-navy-900">{maskTarget(target)}</span>}
          </p>
          {isMockMode && (
            <p className="mt-1 text-xs text-sky-600 font-medium">
              {t.auth.mockOtpHint}
            </p>
          )}
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleVerify}>
          <div className="flex justify-center gap-2 sm:gap-4">
            {otp.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                disabled={isExpired || isLoading}
                className={`w-10 h-12 sm:w-12 sm:h-14 text-center text-2xl font-semibold border rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white ${isExpired ? "bg-gray-100 text-gray-400 border-gray-200" : "text-navy-900 border-gray-300"} transition-colors`}
              />
            ))}
          </div>

          {error && (
            <motion.div 
              initial={{ x: -10 }} 
              animate={{ x: [0, -10, 10, -10, 10, 0] }}
              transition={{ duration: 0.4 }}
              className="text-red-600 text-sm bg-red-50 p-2 rounded"
            >
              {error}
            </motion.div>
          )}

          {!isExpired ? (
            <div className="flex flex-col items-center gap-2">
              <div className="relative w-12 h-12">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-200" />
                  <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={125.6} strokeDashoffset={125.6 - (125.6 * timeLeft) / 120} className="text-sky-500 transition-all duration-1000 linear" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-navy-900">
                  {minutes}:{seconds.toString().padStart(2, '0')}
                </div>
              </div>
              <div className="text-sm text-gray-500">
                {t.auth.codeExpiresIn} <span className="font-medium text-navy-900">{minutes}:{seconds.toString().padStart(2, '0')}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-600 font-medium">
              {t.auth.codeExpired}
            </div>
          )}

          <div>
            {!isExpired ? (
              <Button type="submit" disabled={isLoading || otp.join("").length !== 6} className="w-full h-11 text-base font-semibold">
                {isLoading ? t.auth.verifying : t.auth.verify}
              </Button>
            ) : (
              <Button type="button" onClick={handleResend} variant="outline" className="w-full h-11 text-base font-semibold">
                {t.auth.resendOtp}
              </Button>
            )}
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-gray-50"></div>}>
      <VerifyOtpContent />
    </React.Suspense>
  );
}
