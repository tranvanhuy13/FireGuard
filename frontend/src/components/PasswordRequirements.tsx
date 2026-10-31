/* eslint-disable */
"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { MIN_PASSWORD_LENGTH } from "@/config";

export { MIN_PASSWORD_LENGTH };

export interface PasswordRules {
  length: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
}

export function checkPasswordRules(password: string): PasswordRules {
  const pwd = password || "";
  return {
    length: Array.from(pwd).length >= MIN_PASSWORD_LENGTH && new TextEncoder().encode(pwd).length <= 72 && !pwd.includes("\0"),
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    number: /[0-9]/.test(pwd),
  };
}

export function getPasswordStrengthScore(rules: PasswordRules): number {
  return (
    (rules.length ? 1 : 0) +
    (rules.upper ? 1 : 0) +
    (rules.lower ? 1 : 0) +
    (rules.number ? 1 : 0)
  );
}

export function isPasswordValid(rulesOrPassword: PasswordRules | string): boolean {
  const rules =
    typeof rulesOrPassword === "string"
      ? checkPasswordRules(rulesOrPassword)
      : rulesOrPassword;
  return rules.length && rules.upper && rules.lower && rules.number;
}

export interface PasswordRequirementsProps {
  password?: string;
  className?: string;
}

export function PasswordRequirements({
  password = "",
  className = "",
}: PasswordRequirementsProps) {
  const { t } = useLanguage();
  const rules = checkPasswordRules(password);
  const strengthScore = getPasswordStrengthScore(rules);

  const rulesLabels = (t.auth as any).passwordRules || t.auth.forgotFlow?.rules || {
    title: "Yêu cầu mật khẩu:",
    minLength: `Ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
    uppercase: "Có ít nhất 1 chữ hoa (A-Z)",
    lowercase: "Có ít nhất 1 chữ thường (a-z)",
    number: "Có ít nhất 1 chữ số (0-9)",
    weak: "Yếu",
    fair: "Trung bình",
    strong: "Mạnh",
  };

  const strengthLabels = {
    weak: rulesLabels.weak || t.auth.forgotFlow?.strength?.weak || "Yếu",
    fair: rulesLabels.fair || t.auth.forgotFlow?.strength?.fair || "Trung bình",
    strong: rulesLabels.strong || t.auth.forgotFlow?.strength?.strong || "Mạnh",
  };

  return (
    <AnimatePresence>
      {password.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className={`mt-2.5 p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-2 overflow-hidden ${className}`}
        >
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium text-gray-600">
              {rulesLabels.title}
            </span>
            <span
              className={`font-semibold ${
                strengthScore < 2
                  ? "text-red-600"
                  : strengthScore < 4
                  ? "text-amber-600"
                  : "text-green-600"
              }`}
            >
              {strengthScore < 2
                ? strengthLabels.weak
                : strengthScore < 4
                ? strengthLabels.fair
                : strengthLabels.strong}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                strengthScore < 2
                  ? "bg-red-500"
                  : strengthScore < 4
                  ? "bg-amber-500"
                  : "bg-green-500"
              }`}
              style={{ width: `${(strengthScore / 4) * 100}%` }}
            />
          </div>

          {/* 4 Rules dynamically ticked */}
          <div className="text-[11px] grid grid-cols-2 gap-1.5 pt-1">
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
              <span>{new TextEncoder().encode(password).length > 72 ? t.auth.errors.passwordTooLong : password.includes("\0") ? t.auth.errors.passwordInvalid : rulesLabels.minLength}</span>
            </div>
            <div
              className={`flex items-center gap-1.5 ${
                rules.upper ? "text-green-600 font-medium" : "text-gray-400"
              }`}
            >
              {rules.upper ? (
                <Check className="w-3.5 h-3.5 text-green-600 stroke-[3]" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
              )}
              <span>{rulesLabels.uppercase}</span>
            </div>
            <div
              className={`flex items-center gap-1.5 ${
                rules.lower ? "text-green-600 font-medium" : "text-gray-400"
              }`}
            >
              {rules.lower ? (
                <Check className="w-3.5 h-3.5 text-green-600 stroke-[3]" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
              )}
              <span>{rulesLabels.lowercase}</span>
            </div>
            <div
              className={`flex items-center gap-1.5 ${
                rules.number ? "text-green-600 font-medium" : "text-gray-400"
              }`}
            >
              {rules.number ? (
                <Check className="w-3.5 h-3.5 text-green-600 stroke-[3]" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
              )}
              <span>{rulesLabels.number}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default PasswordRequirements;
