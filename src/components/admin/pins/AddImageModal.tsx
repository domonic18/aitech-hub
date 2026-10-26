"use client";

/**
 * 添加图片三通道(M41):工坊选版本 / AI 生成 / 本地上传。M47 批D 拆编排壳,
 * 三 tab 各自持态、实现住同级 AddImageWorkshopTab / AddImageAiTab /
 * AddImageUploadTab;此处只留 tab 切换、共享错误条与序列上限门。
 */
import { useState } from "react";

import type { PinImageDto } from "@/lib/pins/dto";
import { PIN_IMAGES_MAX } from "@/lib/pins/constants";
import DialogShell from "@/components/admin/DialogShell";

import type { WorkshopRootOption } from "./PinEditor";
import AddImageAiTab from "./AddImageAiTab";
import AddImageUploadTab from "./AddImageUploadTab";
import AddImageWorkshopTab from "./AddImageWorkshopTab";

const TABS = [
  { key: "workshop", label: "工坊选版本" },
  { key: "ai", label: "AI 生成" },
  { key: "upload", label: "本地上传" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function AddImageModal({
  pinId,
  workshopRoots,
  currentCount,
  onClose,
  onAdded,
  onGenerated,
}: {
  pinId: string;
  workshopRoots: WorkshopRootOption[];
  currentCount: number;
  onClose: () => void;
  onAdded: (res: { added: number; images: PinImageDto[] }) => void;
  onGenerated: (baseline: number) => void;
}): React.ReactElement {
  const [tab, setTab] = useState<TabKey>("workshop");
  const [error, setError] = useState<string | null>(null);

  const remaining = PIN_IMAGES_MAX - currentCount;

  const tabBtn = (key: TabKey, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setTab(key);
        setError(null);
      }}
      className={`cursor-pointer rounded-sm px-3 py-1.5 text-xs font-medium ${
        tab === key ? "bg-accent-dim text-accent" : "text-text-2 hover:text-text-1"
      }`}
    >
      {label}
    </button>
  );

  return (
    <DialogShell title="添加图片" scroll>
      <div className="mt-3 flex items-center gap-1">
        {TABS.map((t) => tabBtn(t.key, t.label))}
        <span className="ml-auto font-mono text-[10.5px] text-text-3">
          序列 {currentCount}/{PIN_IMAGES_MAX}
        </span>
      </div>
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}
      {remaining <= 0 ? (
        <p className="py-6 text-center text-xs text-amber-hi">
          已达公众号上限 {PIN_IMAGES_MAX} 张,请先移除再添加
        </p>
      ) : (
        <>
          {tab === "workshop" && (
            <AddImageWorkshopTab
              pinId={pinId}
              workshopRoots={workshopRoots}
              remaining={remaining}
              setError={setError}
              onAdded={onAdded}
              onClose={onClose}
            />
          )}
          {tab === "ai" && (
            <AddImageAiTab
              pinId={pinId}
              workshopRoots={workshopRoots}
              currentCount={currentCount}
              remaining={remaining}
              setError={setError}
              onGenerated={onGenerated}
              onClose={onClose}
            />
          )}
          {tab === "upload" && (
            <AddImageUploadTab
              pinId={pinId}
              setError={setError}
              onAdded={onAdded}
              onClose={onClose}
            />
          )}
        </>
      )}
    </DialogShell>
  );
}
