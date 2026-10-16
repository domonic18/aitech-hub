/**
 * 飞书 H5 免登客户端助手(M29,client-only 零服务端依赖,禁 import 服务端
 * 模块):UA 启发式判定飞书容器;单飞注入 h5sdk 脚本(2026-10-16 迁官方
 * bytegoofy CDN 1.5.26——旧 sf3-scmcdn2 1.5.16 路径已死,即首版真机
 * 「h5sdk 脚本加载失败」根因);免登走新版免鉴权流:h5sdk.ready →
 * tt.requestAccess(appID+空 scope,客户端 ≥6.9.0)→ 授权码;旧客户端不识别
 * requestAccess 会静默丢弃(无 success/fail 回调)→ 8s 无响应回退
 * tt.requestAuthCode。appId 由 GET /api/auth/feishu/status 下发(免签名
 * 四元组,config/jsapi_ticket 鉴权链整体下线)。任一步失败 reject,由调用方
 * 回落密码表单(fail-closed,不阻塞登录页)。
 */
const H5_SDK_SRC = "https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js";
const SDK_LOAD_TIMEOUT_MS = 8_000;
/** requestAccess 无响应回退阈值(旧客户端静默丢弃新 API) */
const ACCESS_FALLBACK_MS = 8_000;
/** 全流程总超时(含回退分支,兜住两代 API 都挂死) */
const TOTAL_TIMEOUT_MS = 20_000;

interface StatusPayload {
  code: number;
  data?: { enabled: boolean; appId: string };
}

interface H5Sdk {
  ready(callback: () => void): void;
  requestAccess(options: {
    /** 官方参数名即大写 D 的 appID */
    appID: string;
    scopeList: string[];
    state: string;
    success: (res: { code: string }) => void;
    fail: (err: unknown) => void;
  }): void;
}

interface TtApi {
  requestAuthCode(options: {
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

/** 飞书容器启发式(官方 UA 含 Lark/Feishu;误判无害——后续取码会失败回落) */
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

/** 诊断串(排障用,入 reject 消息给登录页横幅;无敏感值) */
function h5Diag(sdk: H5Sdk, tt: TtApi): string {
  return (
    `sdk=1.5.26 h5sdk=${window.h5sdk ? 1 : 0} tt=${window.tt ? 1 : 0} ` +
    `access=${typeof sdk.requestAccess} authcode=${typeof tt.requestAuthCode} ` +
    `ready=${typeof sdk.ready}`
  );
}

function jsonErr(err: unknown): string {
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** 免登授权码获取全流程;调用方 catch 后回落密码表单 */
export async function requestFeishuAuthCode(): Promise<string> {
  if (!isFeishuWebview()) throw new Error("非飞书容器");

  // appId 先行取自服务端配置单例(凭证不齐 403,前端即时回落,省 SDK 加载)
  const res = await fetch("/api/auth/feishu/status/", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as StatusPayload | null;
  const appId = res.ok && body?.code === 0 ? body.data?.appId : undefined;
  if (!appId) throw new Error(`免登配置不可用(HTTP ${res.status})`);

  await loadH5Sdk();
  const sdk = window.h5sdk;
  const tt = window.tt;
  if (!sdk || !tt) throw new Error("h5sdk 不可用(非飞书容器?)");
  await new Promise<void>((resolve) => sdk.ready(resolve));

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(totalTimer);
      fn();
    };
    const finish = (code: string): void => done(() => resolve(code));
    const failure = (branch: string, err: unknown): void =>
      done(() => reject(new Error(`免登失败(${branch}):${h5Diag(sdk, tt)} ${jsonErr(err)}`)));

    const totalTimer = window.setTimeout(
      () => done(() => reject(new Error(`飞书授权超时,请改用密码登录(${h5Diag(sdk, tt)})`))),
      TOTAL_TIMEOUT_MS,
    );
    // 旧客户端(<6.9.0)不识别 requestAccess 静默丢弃 → 无响应即回旧接口
    const fallbackTimer = window.setTimeout(() => {
      if (settled) return;
      tt.requestAuthCode({
        appId,
        success: (r) => finish(r.code),
        fail: (err) => failure("requestAuthCode", err),
      });
    }, ACCESS_FALLBACK_MS);

    if (typeof sdk.requestAccess !== "function") return; // 等回退分支
    sdk.requestAccess({
      appID: appId,
      scopeList: [],
      state: "",
      success: (r) => finish(r.code),
      fail: (err) => failure("requestAccess", err),
    });
  });
}
