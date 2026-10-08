"use client";

/**
 * Vditor 分屏编辑器实现(M5-d):浏览器端库,经 MdEditor 的 dynamic(ssr:false) 分包加载。
 * mode "sv" 左编辑右预览(工具栏可切即时渲染 ir/所见即所得 wysiwyg);截图粘贴/拖拽/
 * 工具栏上传统一走 upload.handler → uploadImageFile(POST /api/media,sha1 去重)。
 * 窄屏(<1024,M13):初始化切 ir 单栏 + 13 项精简工具栏(转屏不重初始化,edit-mode 手动出口)。
 * 运行时懒加载资源已本地化至 public/vditor(lute WASM/i18n/highlight/预览主题,
 * 以及按内容触发懒加载的 mermaid/katex——库内 6 篇 mermaid 围栏、69 篇含数学定界符,
 * 且 math engine 无 none 开关),cdn 选项指向站内,不依赖 unpkg(内网/离线可用)。
 * echarts/graphviz 等其余渲染器全库零使用未纳入,内容用到时再随库补拷。
 */
import "vditor/dist/index.css";
import { useEffect, useRef } from "react";
import Vditor from "vditor";

import { MEDIA_LIMITS } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";

/** 精简工具栏:高频排版 + 上传 + 模式切换(sv/ir/wysiwyg)+ 全屏 */
const TOOLBAR = [
  "headings",
  "bold",
  "italic",
  "strike",
  "|",
  "list",
  "ordered-list",
  "check",
  "outdent",
  "indent",
  "|",
  "quote",
  "code",
  "inline-code",
  "link",
  "table",
  "upload",
  "|",
  "undo",
  "redo",
  "|",
  "edit-mode",
  "fullscreen",
];

/** 窄屏(<1024)精简条(M13):13 项防 float 换行挤压;ir 即时渲染单栏,edit-mode 可切回 */
const TOOLBAR_COMPACT = [
  "headings",
  "bold",
  "italic",
  "list",
  "check",
  "|",
  "quote",
  "code",
  "link",
  "upload",
  "|",
  "edit-mode",
  "fullscreen",
];

export default function VditorEditor({
  value,
  onChange,
  onNote,
}: {
  value: string;
  onChange: (md: string) => void;
  onNote: (note: string | null) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  /** 最近一次已知内容(input 回调/外部注入后同步),是 after 与值同步 effect 的会合点 */
  const latestRef = useRef(value);
  /** vditor 异步初始化完成前不调 setValue(实例方法依赖内部 DOM) */
  const initedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dark = document.documentElement.dataset.theme === "dark";
    /** StrictMode 双执行/快速路由切换时,卸载可能先于异步初始化完成 */
    let disposed = false;
    // 窄屏降级(M13):ir 即时渲染单栏 + 精简工具栏;已知限:转屏不重初始化,edit-mode 钮手动切回
    const compact = window.innerWidth < 1024;
    const vditor = new Vditor(el, {
      cdn: "/vditor",
      mode: compact ? "ir" : "sv",
      lang: "zh_CN",
      theme: dark ? "dark" : "classic",
      height: compact ? 480 : 560,
      // 内容真相源是 React state,禁 localStorage 缓存,防旧稿复活覆盖交接/回填内容
      cache: { enable: false },
      placeholder: "正文(Markdown;支持 GFM 表格/任务列表/代码块,可直接粘贴截图)…",
      toolbar: compact ? TOOLBAR_COMPACT : TOOLBAR,
      preview: {
        delay: 150,
        theme: { current: dark ? "dark" : "light", path: "/vditor/dist/css/content-theme" },
        hljs: { style: dark ? "github-dark" : "github", lineNumber: false },
      },
      input: (v) => {
        latestRef.current = v;
        onChange(v);
      },
      upload: {
        accept: "image/jpeg,image/png,image/webp,image/gif",
        handler: async (files) => {
          for (const file of files) {
            if (file.size > MEDIA_LIMITS.maxUploadBytes) {
              onNote(`图片超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB,未上传:${file.name}`);
              continue;
            }
            const r = await uploadImageFile(file, file.name || "paste.png");
            if (r.ok) {
              vditor.insertValue(`\n![${file.name || "图片"}](${r.path})\n`);
            } else {
              onNote(`图片上传失败(${r.error}):${file.name}`);
            }
          }
          return null; // 插入已手动完成,不走 vditor 默认响应解析
        },
      },
      after: () => {
        if (disposed) {
          // 卸载晚于初始化完成:补一次销毁,防止游离实例残留
          try {
            vditor.destroy();
          } catch {
            // destroy 对半初始化实例可能抛错,忽略
          }
          return;
        }
        initedRef.current = true;
        if (latestRef.current) vditor.setValue(latestRef.current);
      },
    });
    vditorRef.current = vditor;
    return () => {
      disposed = true;
      // destroy 在异步初始化(图标/lute 加载)完成前调用会抛
      // "Cannot read properties of undefined":吞掉即可,初始化若已完成则正常销毁
      try {
        vditor.destroy();
      } catch {
        // 半初始化实例无需清理
      }
      vditorRef.current = null;
      initedRef.current = false;
    };
    // 仅 mount 一次;onChange/onNote 为 setState 包装(引用稳定),主题切换由下方 effect 跟随
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值注入(一键发文交接/回填):与内部输入经 latestRef 去重,不回环
  useEffect(() => {
    if (value === latestRef.current) return;
    latestRef.current = value;
    if (initedRef.current) vditorRef.current?.setValue(value);
  }, [value]);

  // 主题切换跟随(ThemeToggle 写 documentElement.dataset.theme)
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const dark = root.dataset.theme === "dark";
      vditorRef.current?.setTheme(
        dark ? "dark" : "classic",
        dark ? "dark" : "light",
        dark ? "github-dark" : "github",
      );
    };
    const ob = new MutationObserver(apply);
    ob.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => ob.disconnect();
  }, []);

  // ah-editor-fill:.vditor 高度随容器(globals.css);min-h 兜底非拉伸场景(右栏收起时)
  return <div ref={ref} className="ah-editor-fill min-h-[480px] flex-1 lg:min-h-[560px]" />;
}
