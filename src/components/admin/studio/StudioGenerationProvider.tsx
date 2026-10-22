"use client";

/**
 * 创作中心生成态 Provider(M44 状态驱动交互)——「生成中/刚完成」是纯前端
 * 在途态(topic 与 agent 线程无持久化关联,机制见 generation-state.ts 头注):
 * 点击生成时 start(kind, baseline) 记录落库基线;在途期间 5s 轮询 studio-state
 * + 监听 agent:run-inactive 即时比对;检测到完成 → router.refresh()(服务端
 * 整页重取,产出/状态全量新值)+ completed 横幅态(贴图带新 id 集)。
 * sessionStorage 同标签页刷新恢复;8min 超时清态(真实成败以助手对话与
 * 落库结果为准,清态后舞台回落 DB 真值,不发假横幅)。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { AGENT_RUN_INACTIVE_EVENT } from "@/lib/agent/agent-host";
import {
  clearGeneration,
  detectCompletion,
  GENERATION_TIMEOUT_MS,
  loadGeneration,
  POLL_STEP_MS,
  saveGeneration,
  type GenerationBaseline,
  type GenerationKind,
  type StudioStateSnapshot,
} from "@/lib/topics/generation-state";

interface CompletedInfo {
  kind: GenerationKind;
  /** 本轮新增贴图 id(pin 完成「新」徽标;post 为空数组) */
  newIds: string[];
}

interface GenerationContextValue {
  /** 在途生成类型;null = 空闲 */
  generating: GenerationKind | null;
  completed: CompletedInfo | null;
  start: (kind: GenerationKind, baseline: GenerationBaseline) => void;
  dismissCompleted: () => void;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function useStudioGeneration(): GenerationContextValue {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useStudioGeneration 须在 StudioGenerationProvider 内使用");
  return ctx;
}

export default function StudioGenerationProvider({
  topicId,
  children,
}: {
  topicId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState<GenerationKind | null>(null);
  const [completed, setCompleted] = useState<CompletedInfo | null>(null);
  // 基线/起始时间放 ref:比对与清理要最新值,但不该触发整树重渲染
  const baselineRef = useRef<GenerationBaseline | null>(null);

  const finish = useCallback(
    (kind: GenerationKind, newIds: string[]) => {
      baselineRef.current = null;
      clearGeneration(topicId);
      setGenerating(null);
      setCompleted({ kind, newIds });
      router.refresh();
    },
    [router, topicId],
  );

  /** 拉一次落库快照并比对;404/网络抖动留待下一跳(超时兜底) */
  const check = useCallback(
    async (kind: GenerationKind, baseline: GenerationBaseline) => {
      try {
        const res = await fetch(`/api/topics/${topicId}/studio-state/`, { cache: "no-store" });
        if (!res.ok || !baselineRef.current) return;
        const resp = (await res.json()) as { code: number; data?: StudioStateSnapshot };
        if (resp.code !== 0 || !resp.data || !baselineRef.current) return;
        if (detectCompletion(kind, baseline, resp.data)) {
          const newIds =
            kind === "pin" ? resp.data.pinIds.filter((id) => !baseline.pinIds.includes(id)) : [];
          finish(kind, newIds);
        }
      } catch {
        /* 下一跳重试 */
      }
    },
    [finish, topicId],
  );

  const start = useCallback(
    (kind: GenerationKind, baseline: GenerationBaseline) => {
      const startedAt = Date.now();
      baselineRef.current = baseline;
      setCompleted(null);
      setGenerating(kind);
      saveGeneration(topicId, { kind, baseline, startedAt });
    },
    [topicId],
  );

  const dismissCompleted = useCallback(() => setCompleted(null), []);

  // 在途态驱动:轮询 + run 收尾即时比对 + 超时清态(generating 恒为 effect 源)
  useEffect(() => {
    if (!generating) return;
    const kind = generating;
    const baseline = baselineRef.current;
    if (!baseline) return;
    const tick = (): void => void check(kind, baseline);
    tick();
    const timer = window.setInterval(tick, POLL_STEP_MS);
    const onRunInactive = (): void => tick();
    window.addEventListener(AGENT_RUN_INACTIVE_EVENT, onRunInactive);
    const timeout = window.setTimeout(() => {
      baselineRef.current = null;
      clearGeneration(topicId);
      setGenerating(null); // 不发假横幅;成败看助手对话与舞台 DB 真值
    }, GENERATION_TIMEOUT_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      window.removeEventListener(AGENT_RUN_INACTIVE_EVENT, onRunInactive);
    };
  }, [generating, check, topicId]);

  // mount 恢复:同标签页刷新后回到在途态(跨标签页不同步,已知取舍)
  useEffect(() => {
    const saved = loadGeneration(topicId);
    if (!saved) return;
    baselineRef.current = saved.baseline;
    setGenerating(saved.kind);
  }, [topicId]);

  const value = useMemo(
    () => ({ generating, completed, start, dismissCompleted }),
    [generating, completed, start, dismissCompleted],
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}
