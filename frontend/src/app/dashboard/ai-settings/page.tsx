/* eslint-disable */
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import RequireRole from '@/components/RequireRole';
import { useLanguage } from '@/context/LanguageContext';
import { AlertTriangle, RotateCcw, Save } from 'lucide-react';

const DEFAULT_SETTINGS = {
  fireThreshold: 75,
  smokeThreshold: 70,
  persistence: 5,
  cooldown: 60
};

export default function AiSettingsPage() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setOriginalSettings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const handleSave = async () => {
    try {
      const res = await fetch('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        setOriginalSettings(updated);
        alert(t.pages?.common?.saveSuccess || 'Saved successfully');
      }
    } catch (err) {
      alert(t.pages?.common?.error || 'Error saving settings');
    }
  };

  const handleRestore = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  const isWarning = settings.fireThreshold < 50 || settings.smokeThreshold < 50 || settings.fireThreshold > 95 || settings.smokeThreshold > 95;

  if (loading) return <div className="p-8 text-center">{t.pages?.common?.loading || 'Loading...'}</div>;

  return (
    <RequireRole roles={['admin']}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">{t.pages?.aiSettings?.title || 'AI Settings'}</h1>
          <div className="flex gap-3">
            <button 
              onClick={handleRestore}
              className="flex items-center gap-2 px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t.pages?.aiSettings?.restoreDefaults || 'Restore Defaults'}
            </button>
            <button 
              onClick={handleSave}
              disabled={!hasChanges}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {t.pages?.aiSettings?.save || 'Save Settings'}
            </button>
          </div>
        </div>

        {hasChanges && (
          <div className="p-4 bg-yellow-50 text-yellow-800 rounded-lg flex items-center gap-2 border border-yellow-200">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            You have unsaved changes.
          </div>
        )}

        {isWarning && (
          <div className="p-4 bg-orange-50 text-orange-800 rounded-lg flex items-start gap-2 border border-orange-200">
            <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <p>{t.pages?.aiSettings?.warningHighLow || 'Warning: Values are too high or low which might cause false positives/negatives.'}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-8">
          
          <div>
            <div className="flex justify-between mb-2">
              <label className="font-medium text-gray-700">{t.pages?.aiSettings?.fireThreshold || 'Fire Detection Threshold'} (%)</label>
              <span className="text-sky-600 font-semibold">{settings.fireThreshold}%</span>
            </div>
            <input 
              type="range" min="10" max="99" 
              value={settings.fireThreshold} 
              onChange={e => setSettings({...settings, fireThreshold: parseInt(e.target.value)})}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="font-medium text-gray-700">{t.pages?.aiSettings?.smokeThreshold || 'Smoke Detection Threshold'} (%)</label>
              <span className="text-sky-600 font-semibold">{settings.smokeThreshold}%</span>
            </div>
            <input 
              type="range" min="10" max="99" 
              value={settings.smokeThreshold} 
              onChange={e => setSettings({...settings, smokeThreshold: parseInt(e.target.value)})}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="font-medium text-gray-700">{t.pages?.aiSettings?.persistenceFrames || 'Persistence Frames'}</label>
              <span className="text-sky-600 font-semibold">{settings.persistence}</span>
            </div>
            <input 
              type="range" min="1" max="30" 
              value={settings.persistence} 
              onChange={e => setSettings({...settings, persistence: parseInt(e.target.value)})}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
            <p className="text-sm text-gray-500 mt-1">Number of consecutive frames an object must be detected to trigger an alert.</p>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="font-medium text-gray-700">{t.pages?.aiSettings?.cooldowns || 'Cooldown (seconds)'}</label>
              <span className="text-sky-600 font-semibold">{settings.cooldown}s</span>
            </div>
            <input 
              type="range" min="10" max="300" step="10"
              value={settings.cooldown} 
              onChange={e => setSettings({...settings, cooldown: parseInt(e.target.value)})}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
            <p className="text-sm text-gray-500 mt-1">Time to wait before sending another alert for the same event type on the same camera.</p>
          </div>

        </div>
      </div>
    </RequireRole>
  );
}
