/* eslint-disable */
"use client";
import { mediaUrl } from "@/lib/api/client";

import React, { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { API_URL } from "../config";
import { motion, AnimatePresence } from "framer-motion";

export interface Alert {
  id?: number;
  timestamp: string;
  type: string;
  confidence: number;
  snapshot?: string;
  status?: string;
  camera_name?: string;
}

interface AlertPanelProps {
  alerts: Alert[];
  error: boolean;
}

const AlertPanel = ({ alerts, error }: AlertPanelProps) => {
  const { t } = useLanguage();
  const { user, streamToken } = useAuth();
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});

  const canManageAlerts = user?.role === "admin" || user?.role === "user";

  useEffect(() => {
    const fetchSoundSetting = async () => {
      try {
        const res = await fetch(`${API_URL}/settings`);
        if (res.ok) {
          const json = await res.json();
          if (json.settings && json.settings.alarm_sound_enabled !== undefined) {
            setIsSoundEnabled(json.settings.alarm_sound_enabled === "true");
          }
        }
      } catch (error) {
        console.warn("Could not fetch sound setting", error);
      }
    };
    fetchSoundSetting();
  }, []);

  const lastPlayedAlertIdRef = React.useRef<string | number | null | undefined>(null);

  useEffect(() => {
    if (alerts.length > 0 && isSoundEnabled) {
      const latest = alerts[0];
      if (latest.confidence > 0.4 && latest.id !== lastPlayedAlertIdRef.current && (latest.status === 'new' || !latest.status)) {
        lastPlayedAlertIdRef.current = latest.id;
        const audio = new Audio("https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg");
        audio.volume = 0.6;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => console.warn("Audio play blocked", e));
        }
      }
    }
  }, [alerts, isSoundEnabled]);

  const handleToggleSound = async () => {
    const nextVal = !isSoundEnabled;
    setIsSoundEnabled(nextVal);
    try {
      await fetch(`${API_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "alarm_sound_enabled", value: nextVal ? "true" : "false" })
      });
    } catch (e) {
      console.error("Failed to save sound settings", e);
    }
  };

  const getAlertStatus = (alert: Alert) => {
    const key = alert.id ? alert.id.toString() : alert.timestamp;
    return localStatuses[key] || alert.status || "new";
  };

  const updateStatus = (alert: Alert, status: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const key = alert.id ? alert.id.toString() : alert.timestamp;
    setLocalStatuses(prev => ({ ...prev, [key]: status }));
  };

  if (error) {
    return (
      <div className="flex flex-col h-full bg-white border border-sky-100 rounded-2xl overflow-hidden p-4 items-center justify-center text-center shadow-sm">
        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse mb-2" />
        <h3 className="text-sm font-bold text-navy-900">{t.common.loading}</h3>
        <p className="text-xs text-gray-500 mt-1">{t.common.waitingBackend}</p>
      </div>
    );
  }

  const filteredAlerts = alerts.filter(a => {
    if (filterType !== "all" && a.type !== filterType) return false;
    const currentStatus = getAlertStatus(a);
    if (filterStatus !== "all" && currentStatus !== filterStatus) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {selectedAlert && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setSelectedAlert(null)}
        >
          <div className="relative max-w-xl w-full bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-2xl" onClick={e => e.stopPropagation()}>
            <button 
              className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors z-10"
              onClick={() => setSelectedAlert(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            
            <div className="bg-gray-100 flex items-center justify-center relative w-full h-64">
              {selectedAlert.snapshot ? (
                <img src={mediaUrl(selectedAlert.snapshot, streamToken)} alt="Event Snapshot" className="w-full h-full object-cover" />
              ) : (
                <div className="text-gray-400">No Image Available</div>
              )}
              
              <div className="absolute top-4 left-4">
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${selectedAlert.type === 'fire' ? 'bg-red-500 text-white' : 'bg-yellow-500 text-white'}`}>
                  {selectedAlert.type === 'fire' ? t.alerts.fireDetected : t.alerts.smokeDetected} ({(selectedAlert.confidence * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
            
            <div className="p-6 bg-white">
              <h3 className="text-xl font-bold text-navy-900 mb-4">Alert Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Time</span>
                  <span className="font-medium text-gray-900">{new Date(selectedAlert.timestamp).toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Camera</span>
                  <span className="font-medium text-gray-900">{selectedAlert.camera_name || "Unknown Camera"}</span>
                </div>
                <div>
                  <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Status</span>
                  <span className="font-medium text-gray-900 capitalize">{getAlertStatus(selectedAlert)}</span>
                </div>
                <div>
                  <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Handler</span>
                  <span className="font-medium text-gray-900">{getAlertStatus(selectedAlert) !== 'new' ? user?.fullName : 'Unassigned'}</span>
                </div>
                <div className="col-span-2">
                  <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Notes</span>
                  <p className="text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-100 min-h-[60px]">
                    {getAlertStatus(selectedAlert) === 'confirmed' ? "Incident verified. Immediate action required." : getAlertStatus(selectedAlert) === 'false_alarm' ? "Verified as false alarm. No action needed." : "Pending review."}
                  </p>
                </div>
              </div>
              
              {canManageAlerts && getAlertStatus(selectedAlert) === 'new' && (
                <div className="mt-6 flex gap-3 pt-4 border-t border-gray-100">
                  <button 
                    onClick={() => updateStatus(selectedAlert, 'confirmed')}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium transition-colors"
                  >
                    Confirm Alert
                  </button>
                  <button 
                    onClick={() => updateStatus(selectedAlert, 'false_alarm')}
                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg font-medium transition-colors"
                  >
                    Mark False Alarm
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="p-4 border-b border-sky-100 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-navy-900 tracking-wide">
              {t.alerts.title}
            </h3>
            <span className="text-xs font-mono text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">
              {filteredAlerts.length} {t.alerts.event}
            </span>
          </div>
          <button
            onClick={handleToggleSound}
            className={`p-2 rounded-lg transition-colors ${
              isSoundEnabled 
                ? "bg-sky-100 text-sky-700 hover:bg-sky-200" 
                : "text-gray-500 hover:text-navy-900 hover:bg-gray-100"
            }`}
            title={isSoundEnabled ? t.common.mute : t.common.unmute}
          >
            {isSoundEnabled ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>
        </div>
        
        <div className="flex gap-2">
          <select 
            value={filterType} 
            onChange={e => setFilterType(e.target.value)}
            className="text-xs bg-gray-50 border border-gray-200 text-gray-700 rounded-md px-2 py-1 flex-1 outline-none focus:border-sky-500"
          >
            <option value="all">{t.alerts.allTypes}</option>
            <option value="fire">{t.alerts.fireDetected}</option>
            <option value="smoke">{t.alerts.smokeDetected}</option>
          </select>
          <select 
            value={filterStatus} 
            onChange={e => setFilterStatus(e.target.value)}
            className="text-xs bg-gray-50 border border-gray-200 text-gray-700 rounded-md px-2 py-1 flex-1 outline-none focus:border-sky-500"
          >
            <option value="all">{t.alerts.allStatuses}</option>
            <option value="new">{t.alerts.statusNew}</option>
            <option value="confirmed">{t.alerts.statusConfirmed}</option>
            <option value="false_alarm">{t.alerts.statusFalseAlarm}</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar min-h-0 bg-gray-50">
        {filteredAlerts.length === 0 ? (
          <div className="text-center text-gray-500 py-10 text-sm">
            {t.common.noDetections}
            <br />
            {t.common.systemNormal}
          </div>
        ) : (
          <AnimatePresence>
            {filteredAlerts.map((alert, idx) => {
              const currentStatus = getAlertStatus(alert);
              return (
              <motion.div
                key={alert.id || idx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className={`group flex items-start gap-4 p-3 rounded-xl border bg-white shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  alert.type === "fire"
                    ? "border-red-200"
                    : "border-yellow-300"
                }`}
                onClick={() => setSelectedAlert(alert)}
              >
                {alert.snapshot ? (
                  <img src={mediaUrl(alert.snapshot, streamToken)} alt="thumb" className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0" />
                ) : (
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${alert.type === "fire" ? "bg-red-50 text-red-500" : "bg-yellow-50 text-yellow-600"}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                  </div>
                )}
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="text-sm font-semibold text-navy-900 capitalize truncate pr-2">
                      {alert.type === "fire" ? t.alerts.fireDetected : alert.type === "smoke" ? t.alerts.smokeDetected : `${alert.type} ${t.alerts.event}`}
                    </h4>
                    <span className="text-[10px] text-gray-500 font-mono shrink-0">
                      {alert.timestamp.split('T')[1]?.split('.')[0] || alert.timestamp}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-600 truncate">{alert.camera_name || "Camera"}</span>
                    <span className="text-[10px] font-medium text-gray-500">&bull;</span>
                    <span className="text-[10px] text-gray-600">
                      {t.alerts.confidence}: {(alert.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase ${
                        currentStatus === "new" ? "bg-blue-100 text-blue-700" :
                        currentStatus === "confirmed" ? "bg-red-100 text-red-700" :
                        "bg-gray-200 text-gray-700"
                      }`}>
                        {currentStatus === "new" ? t.alerts.statusNew :
                         currentStatus === "confirmed" ? t.alerts.statusConfirmed :
                         t.alerts.statusFalseAlarm}
                      </span>
                    </div>
                  </div>
                  
                  {canManageAlerts && currentStatus === 'new' && (
                    <div className="mt-2 flex gap-2">
                      <button 
                        onClick={(e) => updateStatus(alert, 'confirmed', e)}
                        className="text-[10px] px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded font-medium transition-colors"
                      >
                        Confirm
                      </button>
                      <button 
                        onClick={(e) => updateStatus(alert, 'false_alarm', e)}
                        className="text-[10px] px-2 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded font-medium transition-colors"
                      >
                        False Alarm
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )})}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default AlertPanel;
