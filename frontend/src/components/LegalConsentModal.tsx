"use client";

import React, { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { X } from "lucide-react";

interface LegalConsentModalProps {
  open: boolean;
  initialTab: "terms" | "privacy";
  onAgree: () => void;
  onDecline: () => void;
  onClose: () => void;
}

export function LegalConsentModal({
  open,
  initialTab,
  onAgree,
  onDecline,
  onClose,
}: LegalConsentModalProps) {
  const { t } = useLanguage();
  const legal = t.auth.legalModal;
  const [activeTab, setActiveTab] = useState<"terms" | "privacy">(initialTab);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  if (open !== prevOpen || initialTab !== prevInitialTab) {
    setPrevOpen(open);
    setPrevInitialTab(initialTab);
    if (open) {
      setActiveTab(initialTab);
    }
  }

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      dialogRef.current?.focus();
    }
    return () => {
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;

    if (!dialogRef.current) return;
    const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) {
      e.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement || document.activeElement === dialogRef.current) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden max-h-[85vh] outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
          <h2
            id="legal-modal-title"
            className="text-lg font-bold text-navy-900 dark:text-white"
          >
            {activeTab === "terms" ? legal.termsTitle : legal.privacyTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors p-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label={legal.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex border-b border-gray-200 dark:border-slate-800 px-6 gap-6 bg-gray-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "terms"}
            onClick={() => setActiveTab("terms")}
            className={`py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === "terms"
                ? "text-sky-600 dark:text-sky-400 border-sky-600 dark:border-sky-400"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border-transparent"
            }`}
          >
            {legal.termsTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "privacy"}
            onClick={() => setActiveTab("privacy")}
            className={`py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === "privacy"
                ? "text-sky-600 dark:text-sky-400 border-sky-600 dark:border-sky-400"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border-transparent"
            }`}
          >
            {legal.privacyTab}
          </button>
        </div>

        {/* Content */}
        <div role="tabpanel" className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {activeTab === "terms" ? (
            <div className="space-y-4">
              {legal.termsSections.map((sec, idx) => (
                <div key={idx} className="space-y-1">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                    {sec.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {sec.body}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {legal.privacySections.map((sec, idx) => (
                <div key={idx} className="space-y-1">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                    {sec.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {sec.body}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 p-3.5 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200/70 dark:border-slate-700/60">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {legal.consentNote}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-gray-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onDecline}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            {legal.decline}
          </button>
          <button
            type="button"
            onClick={onAgree}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
          >
            {legal.agree}
          </button>
        </div>
      </div>
    </div>
  );
}
