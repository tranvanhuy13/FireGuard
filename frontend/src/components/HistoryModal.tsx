/* eslint-disable */
"use client";

import React, { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { API_URL } from "../config";
import { authFetch } from "../lib/api/authFetch";

interface Event {
  id: number;
  timestamp: string;
  type: string;
  confidence: number;
  snapshot_path: string;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HistoryModal = ({ isOpen, onClose }: HistoryModalProps) => {
  const { t } = useLanguage();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [filterType, setFilterType] = useState<string>("all");

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/history?limit=100`);
      if (res.ok) {
        const json = await res.json();
        setEvents(json.events);
      }
    } catch (error) {
      console.error("Failed to fetch history", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredEvents = events.filter(
    (e) => filterType === "all" || e.type === filterType,
  );
  const totalPages = Math.ceil(filteredEvents.length / itemsPerPage);
  const paginatedEvents = filteredEvents.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-sky-100 rounded-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-navy-900 tracking-tight">
              {t.history.title}
            </h2>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              className="text-sm bg-gray-50 border border-gray-200 text-gray-700 rounded-md px-3 py-1.5 outline-none focus:border-sky-500"
            >
              <option value="all">All Types</option>
              <option value="fire">Fire</option>
              <option value="smoke">Smoke</option>
            </select>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-navy-900 transition-colors"
          >
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

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 flex gap-6 bg-gray-50/50">
          {/* Detailed List */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-white rounded-xl border border-gray-100 shadow-sm">
              {loading ? (
                <div className="flex justify-center items-center h-full text-gray-500">
                  {t.common.loading}
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="flex justify-center items-center h-full text-gray-500">
                  {t.history.noEvents}
                </div>
              ) : (
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="text-xs uppercase bg-gray-50 text-gray-500 font-semibold sticky top-0 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3">{t.history.time}</th>
                      <th className="px-4 py-3">{t.history.type}</th>
                      <th className="px-4 py-3">{t.history.confidence}</th>
                      <th className="px-4 py-3 text-right">
                        {t.history.action}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedEvents.map((event) => (
                      <tr
                        key={event.id}
                        className={`transition-colors cursor-pointer group ${selectedSnapshot === event.snapshot_path ? "bg-sky-50" : "hover:bg-gray-50"}`}
                        onClick={() => setSelectedSnapshot(event.snapshot_path)}
                      >
                        <td className="px-4 py-3 font-mono text-gray-700">
                          {event.timestamp}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                              event.type === "fire"
                                ? "bg-red-100 text-red-700"
                                : "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {event.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-700">
                          %{(event.confidence * 100).toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {event.snapshot_path && (
                            <button className="text-sky-600 hover:text-sky-700 text-xs px-2 py-1 rounded font-medium">
                              {t.history.viewSnapshot}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-2">
                <span className="text-xs text-gray-500">
                  Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                  {Math.min(currentPage * itemsPerPage, filteredEvents.length)}{" "}
                  of {filteredEvents.length}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="px-2 py-1 border border-gray-200 rounded text-xs disabled:opacity-50 hover:bg-gray-50 bg-white"
                  >
                    Prev
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="px-2 py-1 border border-gray-200 rounded text-xs disabled:opacity-50 hover:bg-gray-50 bg-white"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Panel */}
          <div className="w-1/3 shrink-0 bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col items-center justify-center text-center">
            {selectedSnapshot ? (
              <div className="space-y-4 w-full">
                <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm bg-gray-50">
                  <img
                    src={`${selectedSnapshot.startsWith("http") ? selectedSnapshot : API_URL + selectedSnapshot}`}
                    alt="Preview"
                    className="w-full h-auto object-cover"
                  />
                </div>
                <div className="text-left bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">
                    {t.history.selectedRecord}
                  </p>
                  <p className="text-navy-900 text-xs break-all font-mono">
                    {selectedSnapshot.split("/").pop()}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-gray-400 space-y-3">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto border border-gray-100">
                  <svg
                    className="w-8 h-8 text-gray-300"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="2"
                      ry="2"
                    ></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                </div>
                <p className="text-sm font-medium">{t.history.clickToView}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
