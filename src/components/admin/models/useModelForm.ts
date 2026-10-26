"use client";

/**
 * 模型弹窗表单状态与提交(技术债批⑤ 自 ModelDialog 拆出,usePostEditorSave
 * 同款拆法):全部字段 state、牌价/扩展参数归一、提交 PUT/POST 与报错回显。
 * 弹窗组件只留触发钮与字段编排。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { AI_PROVIDER_PRESETS } from "@/lib/ai/constants";
import type { AiModelRow } from "@/lib/ai/models-admin";
import type { ApiEnvelope } from "@/lib/http/response";

const OTHER = "__other__";

export function useModelForm({ model }: { model?: AiModelRow }) {
  const router = useRouter();
  const editing = model !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(model?.name ?? "");
  const [purposes, setPurposes] = useState<string[]>(model?.purposes ?? []);
  const [supportsVision, setSupportsVision] = useState(model?.supportsVision ?? false);
  const presetProvider = model?.provider;
  const [providerChoice, setProviderChoice] = useState(
    presetProvider && (AI_PROVIDER_PRESETS as readonly string[]).includes(presetProvider)
      ? presetProvider
      : (presetProvider ?? AI_PROVIDER_PRESETS[0]),
  );
  const [providerText, setProviderText] = useState(
    presetProvider && !(AI_PROVIDER_PRESETS as readonly string[]).includes(presetProvider)
      ? presetProvider
      : "",
  );
  const [protocol, setProtocol] = useState(model?.protocol ?? "openai");
  const [modelId, setModelId] = useState(model?.modelId ?? "");
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [concurrency, setConcurrency] = useState(String(model?.concurrency ?? 4));
  const [timeoutSec, setTimeoutSec] = useState(String(model?.timeoutSec ?? 60));
  // 牌价(用量页费用折算口径;空串=未定价):LLM ¥/1M tokens,生图 ¥/张
  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const [priceIn, setPriceIn] = useState(model?.priceIn != null ? String(model.priceIn) : "");
  const [priceOut, setPriceOut] = useState(model?.priceOut != null ? String(model.priceOut) : "");
  const [pricePerImage, setPricePerImage] = useState(
    model?.pricePerImage != null ? String(model.pricePerImage) : "",
  );
  // 扩展参数:textarea 存 JSON 文本,提交时 parse(非法禁提交);空串=null
  const [extraText, setExtraText] = useState(() => {
    const v = model?.extraParams;
    return v && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v, null, 2) : "";
  });
  const extraInvalid =
    extraText.trim() !== "" &&
    (() => {
      try {
        const v: unknown = JSON.parse(extraText);
        return typeof v !== "object" || v === null || Array.isArray(v);
      } catch {
        return true;
      }
    })();
  const nameRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setApiKey("");
  };

  const openDialog = (): void => {
    setOpen(true);
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const togglePurpose = (p: string): void => {
    setPurposes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  };

  const provider = providerChoice === OTHER ? providerText.trim() : providerChoice;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    let extraParams: Record<string, unknown> | null = null;
    if (extraText.trim() !== "") {
      try {
        const v: unknown = JSON.parse(extraText);
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          setError("扩展参数必须是 JSON 对象");
          setBusy(false);
          return;
        }
        extraParams = v as Record<string, unknown>;
      } catch {
        setError("扩展参数不是合法 JSON");
        setBusy(false);
        return;
      }
    }
    try {
      const res = await fetch(editing ? `/api/models/${model.id}` : "/api/models", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          protocol,
          baseUrl: baseUrl.trim() || null,
          modelId: modelId.trim(),
          apiKey: apiKey.trim() || null,
          purposes,
          supportsVision,
          concurrency: Number(concurrency),
          timeoutSec: Number(timeoutSec),
          extraParams,
          priceIn: numOrNull(priceIn),
          priceOut: numOrNull(priceOut),
          pricePerImage: numOrNull(pricePerImage),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    name.trim() !== "" &&
    modelId.trim() !== "" &&
    purposes.length > 0 &&
    provider !== "" &&
    !extraInvalid;

  return {
    editing,
    open,
    busy,
    error,
    nameRef,
    name,
    setName,
    purposes,
    togglePurpose,
    supportsVision,
    setSupportsVision,
    providerChoice,
    setProviderChoice,
    providerText,
    setProviderText,
    protocol,
    setProtocol,
    modelId,
    setModelId,
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    concurrency,
    setConcurrency,
    timeoutSec,
    setTimeoutSec,
    priceIn,
    setPriceIn,
    priceOut,
    setPriceOut,
    pricePerImage,
    setPricePerImage,
    extraText,
    setExtraText,
    extraInvalid,
    openDialog,
    close,
    submit,
    canSubmit,
  };
}
