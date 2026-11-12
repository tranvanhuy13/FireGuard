"use client";

import { useLanguage } from "../context/LanguageContext";

export default function CameraEmptyState({ onAdd, dark = false }: { onAdd?: () => void; dark?: boolean }) {
  const { t } = useLanguage();
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center ${dark ? "border-sky-700 text-sky-100" : "border-slate-200 text-slate-600"}`}>
      <p className="font-semibold">{t.pages.cameras.noOwnedCameras}</p>
      <p className="max-w-lg text-sm">{t.pages.cameras.legacyCameraHelp}</p>
      {onAdd && <button type="button" onClick={onAdd} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">{t.pages.cameras.addCamera}</button>}
    </div>
  );
}
