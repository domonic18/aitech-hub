"use client";
/**
 * 输入区(K2.5,平移 ai-invest Composer,token 换装):ComposerPrimitive 自增高
 * (rows=1,max-h-32);运行中显「停止」(unstable_allowCancellation 侧中止
 * abortSignal),空闲显「发送」。
 */
import { ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";

export default function AgentComposer(): React.ReactElement {
  return (
    <ComposerPrimitive.Root className="border-t border-line p-3">
      <div className="flex items-end gap-2 rounded-lg border border-line bg-panel-2 p-2 transition-colors focus-within:border-accent/50">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="继续深挖,如「对比上面两篇文章的思路差异」"
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none"
        />
        <div className="flex shrink-0 items-center gap-1 pb-0.5 pr-0.5">
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel className="cursor-pointer rounded-md border border-red/40 px-2.5 py-1 text-xs text-red-hi hover:bg-red/10">
              停止
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send className="cursor-pointer rounded-md bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
              发送
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
        </div>
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] text-text-3">
        agent.digest · 站内三域只读检索 · 会话 30 天自动清退
      </div>
    </ComposerPrimitive.Root>
  );
}
