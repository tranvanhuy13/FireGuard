"use client";

import React, { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { API_URL } from "../config";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const { language, setLanguage, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"zalo" | "telegram" | "ai">(
    "zalo",
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const [settings, setSettings] = useState({
    // Zalo
    zalo_enabled: "false",
    zalo_bot_token: "",
    zalo_chat_id: "",
    public_base_url: "",

    // Telegram
    telegram_enabled: "false",
    telegram_bot_token: "",
    telegram_chat_id: "",

    // Yapay Zeka (AI)
    ai_confidence_threshold: "0.25",
    ai_persistence_frames: "2",
    ai_cooldown_seconds: "5",
    alarm_sound_enabled: "true",
  });

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/settings`);
      if (res.ok) {
        const json = await res.json();
        setSettings((prev) => ({ ...prev, ...json.settings }));
      }
    } catch (error) {
      console.error("Failed to load settings", error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (checked ? "true" : "false") : value,
    }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // Save all settings one by one
      for (const [key, value] of Object.entries(settings)) {
        await fetch(`${API_URL}/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
      }
      setMessage({ text: t.settings.saved, type: "success" });
    } catch (error) {
      setMessage({ text: "Error saving settings", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/test-notification`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        setMessage({ text: t.settings.testSent, type: "success" });
      } else {
        setMessage({ text: "Test failed: " + json.message, type: "error" });
      }
    } catch (error) {
      setMessage({ text: "Test connection failed.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#0a0a0a]">
          <h2 className="text-xl font-bold text-white">{t.settings.title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5">
          <button
            onClick={() => setActiveTab("zalo")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === "zalo" ? "bg-white/5 text-white border-b-2 border-sky-500" : "text-gray-400 hover:text-white"}`}
          >
            Zalo
          </button>
          <button
            onClick={() => setActiveTab("telegram")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === "telegram" ? "bg-white/5 text-white border-b-2 border-blue-500" : "text-gray-400 hover:text-white"}`}
          >
            {t.settings.telegramTab}
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === "ai" ? "bg-white/5 text-white border-b-2 border-amber-500" : "text-gray-400 hover:text-white"}`}
          >
            AI Settings
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {message && (
            <div
              className={`p-3 rounded text-sm ${message.type === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}
            >
              {message.text}
            </div>
          )}

          {activeTab === "zalo" && (
            <div className="space-y-4 animate-in slide-in-from-left-4 fade-in duration-200">
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="checkbox"
                  id="zalo_enabled"
                  name="zalo_enabled"
                  checked={settings.zalo_enabled === "true"}
                  onChange={handleChange}
                  className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-sky-500 focus:ring-sky-500"
                />
                <label
                  htmlFor="zalo_enabled"
                  className="text-white text-sm font-medium"
                >
                  Enable Zalo Notifications
                </label>
              </div>

              <div className="bg-sky-500/10 p-3 rounded text-xs text-sky-300 mb-4 whitespace-pre-line">
                {
                  "1. Create a bot at bot.zapps.me and copy its Bot Token.\n2. Open Zalo and send any message to your bot.\n3. Get your Chat ID from the bot's getUpdates (message.chat.id) and paste it below."
                }
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase">
                  Bot Token
                </label>
                <input
                  type="password"
                  name="zalo_bot_token"
                  value={settings.zalo_bot_token}
                  onChange={handleChange}
                  className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-sky-500 outline-none"
                  placeholder="12345689:abc-xyz"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase">
                  Chat ID
                </label>
                <input
                  type="text"
                  name="zalo_chat_id"
                  value={settings.zalo_chat_id}
                  onChange={handleChange}
                  className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-sky-500 outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase">
                  Public Backend URL (optional, for snapshot images)
                </label>
                <input
                  type="text"
                  name="public_base_url"
                  value={settings.public_base_url}
                  onChange={handleChange}
                  className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-sky-500 outline-none"
                  placeholder="https://your-domain.com"
                />
                <p className="text-[10px] text-gray-500">
                  Zalo can only send a photo from a public URL. Leave empty to
                  receive text-only alerts.
                </p>
              </div>
            </div>
          )}

          {activeTab === "telegram" && (
            <div className="space-y-4 animate-in slide-in-from-right-4 fade-in duration-200">
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="checkbox"
                  id="telegram_enabled"
                  name="telegram_enabled"
                  checked={settings.telegram_enabled === "true"}
                  onChange={handleChange}
                  className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-blue-500 focus:ring-blue-500"
                />
                <label
                  htmlFor="telegram_enabled"
                  className="text-white text-sm font-medium"
                >
                  {t.settings.enableTelegram}
                </label>
              </div>

              <div className="bg-blue-500/10 p-3 rounded text-xs text-blue-300 mb-4 whitespace-pre-line">
                {t.settings.telegramHelp}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase">
                  {t.settings.botToken}
                </label>
                <input
                  type="text"
                  name="telegram_bot_token"
                  value={settings.telegram_bot_token}
                  onChange={handleChange}
                  className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase">
                  {t.settings.chatId}
                </label>
                <input
                  type="text"
                  name="telegram_chat_id"
                  value={settings.telegram_chat_id}
                  onChange={handleChange}
                  className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          )}

          {activeTab === "ai" && (
            <div className="space-y-5 animate-in slide-in-from-bottom-4 fade-in duration-200">
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="checkbox"
                  id="alarm_sound_enabled"
                  name="alarm_sound_enabled"
                  checked={settings.alarm_sound_enabled === "true"}
                  onChange={handleChange}
                  className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-amber-500 focus:ring-amber-500 cursor-pointer"
                />
                <label
                  htmlFor="alarm_sound_enabled"
                  className="text-white text-sm font-medium cursor-pointer"
                >
                  Enable Siren Sound Alarm
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-gray-400 font-medium">
                    AI Confidence Threshold
                  </label>
                  <span className="text-xs font-mono font-bold text-amber-400">
                    %
                    {Math.round(
                      parseFloat(settings.ai_confidence_threshold || "0.25") *
                        100,
                    )}
                  </span>
                </div>
                <input
                  type="range"
                  name="ai_confidence_threshold"
                  min="0.10"
                  max="0.90"
                  step="0.05"
                  value={settings.ai_confidence_threshold}
                  onChange={handleChange}
                  className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                  <span>10% (More Sensitive)</span>
                  <span>90% (More Stable)</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 font-medium">
                    Verification Frame Count (Persistence)
                  </label>
                  <input
                    type="number"
                    name="ai_persistence_frames"
                    min="1"
                    max="10"
                    value={settings.ai_persistence_frames}
                    onChange={handleChange}
                    className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
                  />
                  <p className="text-[10px] text-gray-500">
                    Number of consecutive frames the object must be detected
                    before triggering an alarm.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-gray-400 font-medium">
                    Alarm Cooldown (Seconds)
                  </label>
                  <input
                    type="number"
                    name="ai_cooldown_seconds"
                    min="1"
                    max="300"
                    value={settings.ai_cooldown_seconds}
                    onChange={handleChange}
                    className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
                  />
                  <p className="text-[10px] text-gray-500">
                    Minimum time in seconds between two consecutive event
                    notifications for the same camera.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 flex justify-end gap-3 bg-black/20">
          <button
            onClick={handleTest}
            disabled={loading}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm transition-colors disabled:opacity-50"
          >
            {t.settings.test}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 bg-white text-black hover:bg-gray-200 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {t.settings.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
