/**
 * admin 弹窗外壳(批D 收敛:七处「全屏遮罩 + 圆角面板」同构,防样式漂移):
 * 遮罩固定;面板宽度四档;长表单开 scroll(限高滚动),短内容不设 max-h。
 * 底部按钮排配 DialogActions。
 */
import type { ReactNode } from "react";

const WIDTH_CLASS = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
} as const;

export default function DialogShell({
  width = "lg",
  scroll = false,
  title,
  children,
}: {
  width?: keyof typeof WIDTH_CLASS;
  /** 长表单限高滚动(默认关:短内容面板不设 max-h,避免无谓滚动) */
  scroll?: boolean;
  /** 面板标题 h3;无标题弹窗(如 PAT 创建结果)不传 */
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`w-full ${WIDTH_CLASS[width]} rounded-md border border-line bg-panel p-5 shadow-xl ${
          scroll ? "max-h-[90vh] overflow-y-auto" : ""
        }`}
      >
        {title !== undefined && <h3 className="text-sm font-semibold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

/** 弹窗底部按钮排(取消/主操作右对齐) */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
}
