"use client";

/**
 * 封面图(M12 文章卡片视图):next/image unoptimized 直出 /wp-content/**(Nginx
 * 服务,不走优化器,arch/07 §3,详情页 hero 同款);加载失败降级占位块——列表族
 * SSR 渲染,失败兜底只在客户端发生(原型 .row-cover img onerror 同语义)。
 */
import Image from "next/image";
import { useState } from "react";

export default function CardCover({ src }: { src: string }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <CoverPlaceholder />;
  return (
    <div className="relative aspect-[16/9] overflow-hidden bg-panel-2">
      <Image
        src={src}
        alt=""
        fill
        unoptimized
        loading="lazy"
        onError={() => setFailed(true)}
        className="object-cover"
        sizes="(max-width: 640px) 100vw, 368px"
      />
    </div>
  );
}

/** 无封面/封面失败的占位块:与封面同比例,保持网格行高一致 */
export function CoverPlaceholder(): React.ReactElement {
  return (
    <div className="flex aspect-[16/9] items-center justify-center bg-panel-2 text-text-3">
      <svg className="ic ic-lg" aria-hidden="true">
        <use href="#i-book" />
      </svg>
    </div>
  );
}
