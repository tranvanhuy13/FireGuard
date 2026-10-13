/* eslint-disable */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api/auth";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    const authenticate = async () => {
      try {
        await api.me();
        if (isMounted) {
          router.push("/dashboard");
        }
      } catch (error) {
        if (isMounted) {
          router.push("/login");
        }
      }
    };

    authenticate();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center space-y-4"
      >
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-lg font-medium text-gray-700">Authenticating...</p>
      </motion.div>
    </div>
  );
}
