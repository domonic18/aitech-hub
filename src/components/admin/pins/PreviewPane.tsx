"use client";

/**
 * 预览裁剪(M41):当前选中图大图 + 裁剪档分段(公众号封面裁剪建议
 * cover_info.crop_percent 三选一,随贴图 PATCH 保存,全贴图级不按张);
 * 已同步/已发布只读。
 */
import type { PinImageDto } from "@/lib/pins/dto";
import { PIN_CROP_SPECS, type PinCropSpec } from "@/lib/pins/constants";

const CROP_LABEL: Record<PinCropSpec, string> = {
  "1_1": "1:1",
  "16_9": "16:9",
  "2.35_9": "2.35:9",
};

export default function PreviewPane({
  image,
  cropSpec,
  editable,
  busy,
  onCropChange,
}: {
  image: PinImageDto | null;
  cropSpec: PinCropSpec;
  editable: boolean;
  busy: boolean;
  onCropChange: (spec: PinCropSpec) => void;
}): React.ReactElement {
  return (
    <div className="rounded-sm border border-line bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-1">预览</span>
        <span className="text-[11px] text-text-3">首张即封面 · 裁剪档为公众号展示建议</span>
        <div className="ml-auto flex overflow-hidden rounded-sm border border-line">
          {PIN_CROP_SPECS.map((spec) => (
            <button
              key={spec}
              type="button"
              disabled={!editable || busy}
              onClick={() => onCropChange(spec)}
              className={`cursor-pointer px-2.5 py-1 text-[11px] disabled:cursor-not-allowed ${
                cropSpec === spec
                  ? "bg-accent-dim font-medium text-accent"
                  : "bg-panel text-text-2 hover:text-text-1"
              } ${!editable || busy ? "opacity-60" : ""}`}
            >
              {CROP_LABEL[spec]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-sm border border-line bg-panel-2">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 站内媒体路径预览
          <img
            src={image.mediaPath}
            alt=""
            className="max-h-[560px] w-auto max-w-full object-contain"
          />
        ) : (
          <p className="py-20 text-xs text-text-3">序列为空——从左侧「添加图片」开始</p>
        )}
      </div>
      {image && (
        <p className="mt-2 font-mono text-[10.5px] text-text-3">
          {image.versionId
            ? `工坊版本 #${image.versionId}(引用不拷贝,精修后可在工坊重挂新版)`
            : "本地上传快照"}
          {image.width != null && image.height != null ? ` · ${image.width}×${image.height}` : ""}
        </p>
      )}
    </div>
  );
}
