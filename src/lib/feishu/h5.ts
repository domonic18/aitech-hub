/**
 * 飞书 H5 jsapi 客户端助手(M29,client-only 零服务端依赖,禁 import 服务端
 * 模块):UA 启发式判定飞书容器;单飞注入 h5sdk 脚本(已在容器预注入则复用);
 * config 鉴权(签名由 GET /api/auth/feishu/jssign 服务端签出,url=调用页完整
 * 地址去 hash,与 config 入参同源)→ ready → tt.getAuthCode 取免登授权码。
 * 任一步失败 reject,由调用方回落密码表单(fail-closed,不阻塞登录页)。
 */
const H5_SDK_SRC =
  "https://sf3-scmcdn2-cn.feishucdn.com/obj/feishu-static/lark/h5-js-sdk-1.5.16/h5-js-sdk-1.5.16.js";
const SDK_LOAD_TIMEOUT_MS = 8_000;

interface JsSignPayload {
  code: number;
  data?: { appId: string; timestamp: string; nonceStr: string; signature: string };
}

interface H5Sdk {
  config(options: {
    appId: string;
    timestamp: string;
    nonceStr: string;
    signature: string;
    jsApiList: string[];
    onSuccess: () => void;
    onFail: (err: unknown) => void;
  }): void;
  ready(callback: () => void): void;
}

interface TtApi {
  getAuthCode(options: {
    appId: string;
    success: (res: { code: string }) => void;
    fail: (err: unknown) => void;
  }): void;
}

declare global {
  interface Window {
    h5sdk?: H5Sdk;
    tt?: TtApi;
  }
}

/** 飞书容器启发式(官方 UA 含 Lark/Feishu;误判无害——后续 config 会失败回落) */
export function isFeishuWebview(): boolean {
  return typeof navigator !== "undefined" && /Lark|Feishu/i.test(navigator.userAgent);
}

let sdkLoading: Promise<void> | null = null;

function loadH5Sdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("非浏览器环境"));
  if (window.h5sdk) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    let settled = false;
    const script = document.createElement("script");
    script.src = H5_SDK_SRC;
    script.async = true;
    script.onload = () => {
      settled = true;
      resolve();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      sdkLoading = null;
      reject(new Error("h5sdk 脚本加载失败"));
    };
    document.head.appendChild(script);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      sdkLoading = null;
      reject(new Error("h5sdk 脚本加载超时"));
    }, SDK_LOAD_TIMEOUT_MS);
  });
  return sdkLoading;
}

/** 免登授权码获取全流程;调用方 catch 后回落密码表单 */
export async function requestFeishuAuthCode(): Promise<string> {
  if (!isFeishuWebview()) throw new Error("非飞书容器");
  await loadH5Sdk();
  const sdk = window.h5sdk;
  const tt = window.tt;
  if (!sdk || !tt) throw new Error("h5sdk 不可用(非飞书容器?)");

  // 签名 url 必须与 config 时页面地址逐字符一致(iOS/安卓均以去 hash 为准)
  const pageUrl = window.location.href.split("#")[0] ?? "";
  const res = await fetch(`/api/auth/feishu/jssign/?url=${encodeURIComponent(pageUrl)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`jssign 失败(HTTP ${res.status})`);
  const sign = ((await res.json()) as JsSignPayload).data;
  if (!sign) throw new Error("jssign 未返回签名");

  await new Promise<void>((resolve, reject) => {
    sdk.config({
      appId: sign.appId,
      timestamp: sign.timestamp,
      nonceStr: sign.nonceStr,
      signature: sign.signature,
      jsApiList: ["getAuthCode"],
      onSuccess: () => resolve(),
      onFail: (err) => reject(new Error(`h5sdk config 鉴权失败:${JSON.stringify(err)}`)),
    });
  });
  await new Promise<void>((resolve) => sdk.ready(resolve));

  return new Promise<string>((resolve, reject) => {
    tt.getAuthCode({
      appId: sign.appId,
      success: (r) => resolve(r.code),
      fail: (err) => reject(new Error(`getAuthCode 失败:${JSON.stringify(err)}`)),
    });
  });
}
