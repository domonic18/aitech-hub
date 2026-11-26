"use client";

/**
 * admin 弹窗外壳(批D 收敛 → 2026-11-26 换 Radix Dialog 底座):
 * 遮罩固定;面板宽度四档;长表单开 scroll(限高滚动),短内容不设 max-h。
 * 底部按钮排配 DialogActions。
 *
 * Radix 能力(此前手写版没有的):
 * - 真焦点陷阱(Tab 键出不去弹窗)
 * - Esc / 遮罩点击关闭(需传 onClose;不传则与旧行为一致)
 * - 完整 ARIA(role=dialog / aria-modal)
 *
 * 接口不变:调用方条件渲染即开关;onClose 是可选增强。
 */
import { type ReactNode } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
  /** 遮罩 z 档;默认 z-50,压不住更高层(如 Vditor 全屏 z-90)的调用方自行提档 */
  zClass = "z-50",
  /** Esc / 遮罩点击回调(不传则这两条路径不关闭,由调用方控制) */
  onClose,
}: {
  width?: keyof typeof WIDTH_CLASS;
  /** 长表单限高滚动(默认关:短内容面板不设 max-h,避免无谓滚动) */
  scroll?: boolean;
  /** 面板标题;无标题弹窗(如 PAT 创建结果)不传 */
  title?: ReactNode;
  children: ReactNode;
  zClass?: string;
  onClose?: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DialogContent
        className={`w-full ${WIDTH_CLASS[width]}`}
        overlayClassName={zClass}
        scroll={scroll}
      >
        {title !== undefined && (
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** 弹窗底部按钮排(取消/主操作右对齐) */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
}
