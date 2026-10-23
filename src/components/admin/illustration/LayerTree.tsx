"use client";

/**
 * 配图工坊·图层面板(M40 批 B):组状态(未拆层引导/进行中/失败重试/就绪)+
 * 图层行(显隐眼标 + 点选带入 bbox)+ 底板说明行。拆层为计费动作,按钮
 * 二次确认文案承载(M40 决策「拆层纯手动」)。
 */
import type { StudioGroupView } from "@/lib/ai/illustration-studio";

export default function LayerTree({
  group,
  selectedLayerId,
  decomposing,
  onSelectLayer,
  onToggleVisible,
  onDecompose,
}: {
  group: StudioGroupView | null;
  selectedLayerId: number | null;
  decomposing: boolean;
  onSelectLayer: (id: number | null) => void;
  onToggleVisible: (layerId: number, visible: boolean) => void;
  onDecompose: () => void;
}): React.ReactElement {
  const processing = group?.status === "processing";
  const failed = group?.status === "failed";
  const ready = group?.status === "ready";
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line bg-panel-1 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-text-2">
          图层{ready ? `(${group?.layers.length})` : ""}
        </h2>
        {!ready && (
          <button
            type="button"
            disabled={decomposing || processing}
            onClick={() => {
              if (window.confirm("拆层调用一次图像模型(约 1-2 分钟,按次计费),确认拆层?"))
                onDecompose();
            }}
            className="cursor-pointer rounded-sm bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {processing ? "拆层进行中…" : decomposing ? "提交中…" : group ? "重新拆层" : "拆层"}
          </button>
        )}
      </div>
      {!group && (
        <p className="text-[11px] leading-relaxed text-text-3">
          尚未拆层。拆层后可按图层显隐组合导出,并点选图层取其范围做改字/消除/重绘。
        </p>
      )}
      {processing && (
        <p className="rounded-sm bg-amber/10 px-2 py-1.5 text-[11px] text-amber">
          正在拆层(约 1-2 分钟),完成后自动刷新。
        </p>
      )}
      {failed && (
        <p className="rounded-sm bg-red/10 px-2 py-1.5 text-[11px] text-red">
          拆层失败:{group?.error ?? "未知原因"}。可点「重新拆层」重试。
        </p>
      )}
      {ready && group && (
        <>
          <p className="text-[11px] leading-relaxed text-text-3">
            底板为抠净元素的干净底图,藏层即元素真消失;官方水印烙在底板,导出恒带(合规)。
          </p>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {/* 列头(F14 板 18:783):行右端状态文本列对齐「显隐」 */}
            <li aria-hidden="true" className="flex items-center gap-2 px-2 text-[10px] text-text-3">
              <span className="w-[14px]" />
              <span className="flex-1">名称</span>
              <span className="flex-none">显隐</span>
            </li>
            {group.layers.map((l) => {
              const selected = l.id === selectedLayerId;
              return (
                <li key={l.id}>
                  <div
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] ${
                      selected ? "bg-accent/10" : "hover:bg-panel-2"
                    }`}
                  >
                    <button
                      type="button"
                      title={l.visible ? "隐藏图层" : "显示图层"}
                      onClick={() => onToggleVisible(l.id, !l.visible)}
                      className={`w-[14px] cursor-pointer text-sm leading-none ${
                        l.visible ? "text-green" : "text-text-3 opacity-40"
                      }`}
                    >
                      <svg className="ic" aria-hidden="true">
                        <use href="#i-eye" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectLayer(selected ? null : l.id)}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                      title={l.description ?? l.name}
                    >
                      <span
                        className={`block truncate ${selected ? "text-accent" : "text-text-1"}`}
                      >
                        {l.name}
                      </span>
                      {l.description && (
                        <span className="block truncate text-[10px] text-text-3">
                          {l.description}
                        </span>
                      )}
                    </button>
                    {/* 状态文本(F14):选中行「选中」accent,其余显隐态 */}
                    <span
                      className={`flex-none text-[10px] ${selected ? "text-accent" : "text-text-3"}`}
                    >
                      {selected ? "选中" : l.visible ? "显示" : "隐藏"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
