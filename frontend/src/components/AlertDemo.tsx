'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AlertDemo() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s + 1) % 4);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full max-w-lg aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
      {/* Mock Camera Feed */}
      <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
        <svg viewBox="0 0 400 300" className="w-full h-full opacity-50">
          <rect width="400" height="300" fill="#1f2937" />
          <path d="M 50 250 Q 200 100 350 250" stroke="#374151" strokeWidth="2" fill="none" />
          <circle cx="200" cy="150" r="40" fill="#374151" />
          {/* Flame SVG */}
          <motion.path
            d="M 190 180 Q 200 120 210 180 Q 200 190 190 180 Z"
            fill="#E5322D"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: step >= 0 ? 1 : 0, scale: step >= 0 ? [1, 1.1, 1] : 0.5 }}
            transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
          />
        </svg>
      </div>

      {/* Bounding Box */}
      <AnimatePresence>
        {step >= 1 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute border-2 border-red-500 bg-red-500/20"
            style={{ top: '40%', left: '45%', width: '10%', height: '25%' }}
          >
            <div className="absolute -top-6 left-[-2px] bg-red-500 text-white text-[10px] px-1 font-bold">
              FIRE 92%
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warning Banner */}
      <AnimatePresence>
        {step >= 2 && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-0 left-0 right-0 bg-red-600 text-white font-bold text-center py-2 text-sm shadow-md z-10"
          >
            WARNING: FIRE DETECTED
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Mockups (Telegram/Zalo) */}
      <AnimatePresence>
        {step >= 3 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="absolute bottom-4 right-4 flex flex-col gap-2 z-20"
          >
            {/* Telegram Mock */}
            <div className="bg-white rounded-lg shadow-lg p-2 w-48 flex items-start gap-2 border border-blue-100">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs">
                TG
              </div>
              <div>
                <div className="text-xs font-bold text-gray-800">FireGuard Bot</div>
                <div className="text-[10px] text-gray-600">🔥 FIRE DETECTED - 92%</div>
              </div>
            </div>
            
            {/* Zalo Mock */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="bg-white rounded-lg shadow-lg p-2 w-48 flex items-start gap-2 border border-blue-100"
            >
              <div className="w-6 h-6 bg-blue-600 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs">
                ZL
              </div>
              <div>
                <div className="text-xs font-bold text-gray-800">Zalo Bot</div>
                <div className="text-[10px] text-gray-600">Cảnh báo cháy! (92%)</div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
