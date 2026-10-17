/**
 * Agent 宿主协议单测(M35):路由策略纯函数全分支 + 唤起派发契约。
 * hook(useAgentEditSurface)涉 React 渲染与 window 生命周期,由 e2e 39
 * 真机覆盖(注册→chip 呈现/切页注销),此处不重复。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { AGENT_OPEN_EVENT, agentFabButtonVisible, openAgentAssistant } from "./agent-host";

describe("agentFabButtonVisible(路由策略:FAB 按钮显隐,卡永驻)", () => {
  it("编辑页 /admin/posts/<id> 藏按钮(顶栏 EditorAssistant 入口在场)", () => {
    expect(agentFabButtonVisible("/admin/posts/317")).toBe(false);
    expect(agentFabButtonVisible("/admin/posts/317/")).toBe(false); // prod 尾斜杠容忍
  });

  it("编辑页变体不误伤:新建页/列表页/非数字段照常显钮", () => {
    expect(agentFabButtonVisible("/admin/posts/new")).toBe(true);
    expect(agentFabButtonVisible("/admin/posts")).toBe(true);
    expect(agentFabButtonVisible("/admin/posts/notanumber")).toBe(true);
  });

  it("登录页 /admin/login 藏按钮", () => {
    expect(agentFabButtonVisible("/admin/login")).toBe(false);
    expect(agentFabButtonVisible("/admin/login/")).toBe(false);
  });

  it("其余路由全显(前台/后台/搜索/项目)", () => {
    expect(agentFabButtonVisible("/")).toBe(true);
    expect(agentFabButtonVisible("/admin")).toBe(true);
    expect(agentFabButtonVisible("/admin/topics")).toBe(true);
    expect(agentFabButtonVisible("/search?q=x")).toBe(true);
    expect(agentFabButtonVisible("/projects")).toBe(true);
    expect(agentFabButtonVisible("/post/317-some-slug")).toBe(true);
  });

  it("尾斜杠归一化(与 buildAgentPageContext 同式)", () => {
    expect(agentFabButtonVisible("/admin/topics/")).toBe(true);
    expect(agentFabButtonVisible("/")).toBe(true);
    expect(agentFabButtonVisible("///")).toBe(true);
  });
});

describe("openAgentAssistant(唤起协议派发契约)", () => {
  // vitest node 环境无 window:挂最小 EventTarget 桩(CustomEvent/EventTarget
  // Node 20 原生在位);协议实现只依赖 addEventListener/dispatchEvent 两能力
  beforeAll(() => {
    (globalThis as { window?: EventTarget }).window = new EventTarget();
  });

  it("带 ask:派发 agent:open 且 detail 形状为 { ask }", () => {
    const spy = vi.fn();
    window.addEventListener(AGENT_OPEN_EVENT, spy);
    openAgentAssistant({ question: "合成初稿", send: true });
    window.removeEventListener(AGENT_OPEN_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).toEqual({ ask: { question: "合成初稿", send: true } });
  });

  it("无 ask:派发空 detail(开卡不注入)", () => {
    const spy = vi.fn();
    window.addEventListener(AGENT_OPEN_EVENT, spy);
    openAgentAssistant();
    window.removeEventListener(AGENT_OPEN_EVENT, spy);
    const detail = (spy.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail).toEqual({});
  });
});
