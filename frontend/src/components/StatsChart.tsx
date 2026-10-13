/* eslint-disable */
"use client";

import React, { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { API_URL } from "../config";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend
} from "recharts";

interface Stat {
  date: string;
  count?: number;
  fireCount?: number;
  smokeCount?: number;
}


const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm text-sm">
        <p className="text-slate-500 mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span style={{ color: entry.color }}>
              {entry.name}: {entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const StatsChart = () => {
  const { t } = useLanguage();
  const [data, setData] = useState<Stat[]>([]);
  const [timeframe, setTimeframe] = useState<"week" | "month">("week");

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/stats?timeframe=${timeframe}`);
        if (res.ok) {
          const json = await res.json();
          // Map mock data structure to have fire and smoke counts if they don't exist
          const mappedData = json.stats.map((s: Stat) => ({
            ...s,
            fireCount: s.fireCount !== undefined ? s.fireCount : Math.floor((s.count || 0) * 0.4),
            smokeCount: s.smokeCount !== undefined ? s.smokeCount : Math.floor((s.count || 0) * 0.6)
          }));
          setData(mappedData);
        }
      } catch (error) {
        console.error("Failed to fetch stats", error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [timeframe]);

  return (
    <div className="w-full h-full p-4 bg-white flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-navy-900 text-sm font-bold">
          {t.stats.weeklyActivity}
        </h3>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${timeframe === "week" ? "bg-white text-navy-900 shadow-sm" : "text-gray-500 hover:text-navy-900"}`}
            onClick={() => setTimeframe("week")}
          >
            {t.stats.days7}
          </button>
          <button 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${timeframe === "month" ? "bg-white text-navy-900 shadow-sm" : "text-gray-500 hover:text-navy-900"}`}
            onClick={() => setTimeframe("month")}
          >
            {t.stats.days30}
          </button>
        </div>
      </div>
      
      {data.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <div className="w-16 h-16 bg-sky-50 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-300">
              <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
            </svg>
          </div>
          <span className="text-sm font-medium">{t.stats.noData}</span>
        </div>
      ) : (
        <div className="flex-1 min-h-0 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorFire" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorSmoke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis 
                dataKey="date" 
                tick={{ fill: "#64748b", fontSize: 10 }} 
                axisLine={false} 
                tickLine={false} 
                tickFormatter={(value) => value.split("-").slice(1).join("/")} 
              />
              <YAxis 
                tick={{ fill: "#64748b", fontSize: 10 }} 
                axisLine={false} 
                tickLine={false} 
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "12px" }} />
              <Area type="monotone" dataKey="fireCount" name={t.alerts.fireDetected || "Fire"} stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorFire)" />
              <Area type="monotone" dataKey="smokeCount" name={t.alerts.smokeDetected || "Smoke"} stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorSmoke)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StatsChart;
