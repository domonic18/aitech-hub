"use client";

/**
 * 搜索命中视频卡竖版封面(原型 .hit.video .v-cover:桌面 56×99,窄屏 48×85):
 * 平台图床外链直出(不走 next/image 优化域),加载失败降级占位——搜索命中卡
 * 为 RSC,失败兜底只在客户端发生,故独立成件(TelegramArticle.VideoCover 同款语义)。
 */
import { useState } from "react";

export default function HitVideoCover({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}): React.ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative block h-[85px] w-[48px] flex-none overflow-hidden rounded-sm border border-line bg-panel-2 min-[960px]:h-[99px] min-[960px]:w-[56px]">
      {src !== null && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-bg font-mono text-[10px] text-text-3">
          ▶
        </span>
      )}
      {/* 播放遮罩(原型 .play) */}
      <span className="absolute inset-0 flex items-center justify-center bg-[rgba(12,14,18,.35)] text-white">
        <svg className="ic" aria-hidden="true">
          <use href="#i-caret-right-fill" />
        </svg>
      </span>
    </span>
  );
}
