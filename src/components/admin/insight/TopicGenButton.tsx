"use client";

/**
 * 生成选题占位钮(F25/F26 actionCard,板终态愿景):选题生成后端未立项,
 * 点击仅就地提示「即将支持」,不发任何请求(不造假)。
 */
import { useState } from "react";

export default function TopicGenButton(): React.ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        title="选题生成排期中:当前版本先人工从可写角度切入"
        onClick={() => setShown(true)}
        className="cursor-pointer rounded-sm bg-panel-2 px-2.5 py-1 text-xs text-text-2 hover:text-text-1"
      >
        生成选题
      </button>
      {shown && <span className="text-[11px] text-text-3">即将支持</span>}
    </span>
  );
}
