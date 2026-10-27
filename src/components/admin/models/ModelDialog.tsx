"use client";

/**
 * 模型新增/编辑弹窗(M8 批⑥;原型 modal 同款字段组):
 * API Key write-only——创建可空(无鉴权内网网关),编辑留空 = 保留旧钥。
 * 表单状态与提交已拆 useModelForm(技术债批⑤),本件留触发钮与字段编排。
 */
import { AI_MODEL_PURPOSES, AI_PROVIDER_PRESETS, aiRoleLabel } from "@/lib/ai/constants";
import type { AiModelRow } from "@/lib/ai/models-admin";
import { field } from "@/components/admin/form-fields";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

import { useModelForm } from "./useModelForm";

const OTHER = "__other__";

export default function ModelDialog({
  label,
  model,
  buttonClass,
}: {
  label: string;
  model?: AiModelRow;
  buttonClass?: string;
}) {
  const f = useModelForm({ model });

  return (
    <>
      <button
        type="button"
        onClick={f.openDialog}
        className={
          buttonClass ??
          "cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        }
      >
        {label}
      </button>
      {f.open && (
        <DialogShell width="2xl" scroll title={f.editing ? "编辑模型" : "新增模型"}>
          <label className="mt-3 block text-xs text-text-3">
            名称 *
            <input
              ref={f.nameRef}
              value={f.name}
              onChange={(e) => f.setName(e.target.value)}
              maxLength={100}
              placeholder="如:解读主力 / Agent 搜索"
              className={`mt-1 ${field}`}
            />
          </label>

          <div className="mt-3 text-xs text-text-3">
            用途(可多选,至少一项)
            <div className="mt-1 flex flex-wrap gap-1.5">
              {AI_MODEL_PURPOSES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => f.togglePurpose(p)}
                  aria-pressed={f.purposes.includes(p)}
                  className={`cursor-pointer rounded-sm border px-2 py-1 text-[11px] ${
                    f.purposes.includes(p)
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-text-2 hover:bg-panel-2"
                  }`}
                >
                  {aiRoleLabel(p)}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={f.supportsVision}
              onChange={(e) => f.setSupportsVision(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            支持视觉输入(图片/视频帧理解)
          </label>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-text-3">
              供应商 *
              <select
                value={f.providerChoice}
                onChange={(e) => f.setProviderChoice(e.target.value)}
                className={`mt-1 ${field}`}
              >
                {AI_PROVIDER_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value={OTHER}>其他</option>
              </select>
            </label>
            {f.providerChoice === OTHER && (
              <label className="text-xs text-text-3">
                供应商名称 *
                <input
                  value={f.providerText}
                  onChange={(e) => f.setProviderText(e.target.value)}
                  maxLength={20}
                  placeholder="如 OpenRouter"
                  className={`mt-1 ${field}`}
                />
              </label>
            )}
            <label className="text-xs text-text-3">
              协议 *
              <select
                value={f.protocol}
                onChange={(e) => f.setProtocol(e.target.value)}
                className={`mt-1 ${field}`}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="systemone">SystemOne 决策(OpenRouter)</option>
                <option value="other">其他(自管端点)</option>
              </select>
            </label>
            <label className="text-xs text-text-3">
              模型 ID *
              <input
                value={f.modelId}
                onChange={(e) => f.setModelId(e.target.value)}
                maxLength={100}
                placeholder="如 deepseek-chat"
                className={`mt-1 font-mono ${field}`}
              />
            </label>
            <label className="sm:col-span-2 text-xs text-text-3">
              Base URL
              <input
                value={f.baseUrl}
                onChange={(e) => f.setBaseUrl(e.target.value)}
                maxLength={500}
                placeholder="https://api.deepseek.com(可粘完整端点,自动剥尾缀)"
                className={`mt-1 font-mono ${field}`}
              />
            </label>
            <label className="sm:col-span-2 text-xs text-text-3">
              API Key{" "}
              {f.editing && (
                <span className="text-amber">(留空 = 保留 {model?.apiKeyMask ?? "现有密钥"})</span>
              )}
              <input
                type="password"
                value={f.apiKey}
                onChange={(e) => f.setApiKey(e.target.value)}
                maxLength={400}
                placeholder="••••••••"
                autoComplete="new-password"
                className={`mt-1 font-mono ${field}`}
              />
              <span className="mt-1 block text-[11px] text-amber">
                保存后 AES-256-GCM 加密落库,界面仅回显掩码。
              </span>
            </label>
            <label className="text-xs text-text-3">
              最大并发(1-64)
              <input
                type="number"
                min={1}
                max={64}
                value={f.concurrency}
                onChange={(e) => f.setConcurrency(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="text-xs text-text-3">
              超时(秒,5-600)
              <input
                type="number"
                min={5}
                max={600}
                value={f.timeoutSec}
                onChange={(e) => f.setTimeoutSec(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="text-xs text-text-3">
              输入牌价(¥/1M tokens)
              <input
                type="number"
                min={0}
                step="0.01"
                value={f.priceIn}
                onChange={(e) => f.setPriceIn(e.target.value)}
                placeholder="如 2.00(选填,用量页折算费用)"
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="text-xs text-text-3">
              输出牌价(¥/1M tokens)
              <input
                type="number"
                min={0}
                step="0.01"
                value={f.priceOut}
                onChange={(e) => f.setPriceOut(e.target.value)}
                placeholder="如 8.00(选填)"
                className={`mt-1 ${field}`}
              />
            </label>
            {f.purposes.includes("cover") && (
              <label className="text-xs text-text-3">
                生图牌价(¥/张)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={f.pricePerImage}
                  onChange={(e) => f.setPricePerImage(e.target.value)}
                  placeholder="如 0.30(封面生图模型必读)"
                  className={`mt-1 ${field}`}
                />
              </label>
            )}
            <label className="sm:col-span-2 text-xs text-text-3">
              扩展参数(JSON,选填)
              <textarea
                value={f.extraText}
                onChange={(e) => f.setExtraText(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={
                  '如 {"watermark_enabled": false}(智谱生图去水印,需平台侧签署去水印免责)'
                }
                className={`mt-1 font-mono ${field}`}
              />
              <span className="mt-1 block text-[11px] text-amber">
                浅合并进该模型的请求体;model/prompt/n/size/response_format 为保留键不可覆盖;保留键置
                null = 从请求体剔除(严格校验供应商用,如 AiHubMix 生图:&#123;&quot;size&quot;: null,
                &quot;response_format&quot;: null&#125;)。
              </span>
              {f.extraInvalid && (
                <span className="mt-1 block text-[11px] text-red">不是合法的 JSON 对象</span>
              )}
            </label>
          </div>

          {f.error && <p className="mt-2 font-mono text-xs text-red">{f.error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={f.close}
              className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={f.busy || !f.canSubmit}
              onClick={() => void f.submit()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {f.busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
