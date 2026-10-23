/**
 * F27 博主台账页顶状态卡 ×4(F27 板面之外的运维能力位,Cookie 导入/代理配置
 * 唯一入口在此,不可随贴板裁撤):Cookie 池(客户端)+ 出口代理(客户端)+
 * 采集网关 + ASR 转写(RSC)。Cookie 只出脱敏 ttwid 前缀;网关不可达降级展示。
 */
import CookiePoolCard from "@/components/admin/CookiePoolCard";
import EgressProxyCard from "@/components/admin/EgressProxyCard";
import { getAsrConfigAdmin } from "@/lib/ai/asr-admin";
import { getEgressProxyConfigAdmin } from "@/lib/telegram/egress-proxy";
import { getAsrOverview } from "@/lib/telegram/spider-queries";
import { fetchGatewayHealth, getCookiePoolView } from "@/lib/telegram/social-platform-admin";
import { VIDEO_PLATFORM_BILIBILI } from "@/lib/telegram/constants";

function asrHours(sec: number): string {
  return `${(sec / 3600).toFixed(1)}h`;
}

export default async function BloggerStatusCards(): Promise<React.ReactElement> {
  const [pool, gateway, asr, asrConfig, egressProxy] = await Promise.all([
    getCookiePoolView(),
    fetchGatewayHealth(),
    getAsrOverview(),
    getAsrConfigAdmin(),
    getEgressProxyConfigAdmin(),
  ]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <CookiePoolCard pools={pool.pools} />
      <EgressProxyCard config={egressProxy} />
      <div className="rounded-md border border-line bg-panel px-4 py-4">
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-cloudserver" />
          </svg>
          采集网关(douyin-gateway · 抖音/B站)
        </div>
        {gateway.reachable ? (
          <>
            <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-green">
              {gateway.status ?? "ok"}
            </div>
            {/* per-platform jar 池(M24);platforms 缺失时回落顶层(douyin 旧网关兼容) */}
            <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-text-3">
              {(Object.entries(gateway.platforms ?? {}).length > 0
                ? Object.entries(gateway.platforms ?? {})
                : [
                    [
                      "douyin",
                      {
                        jarsTotal: gateway.jarsTotal ?? 0,
                        jarsAvailable: gateway.jarsAvailable ?? 0,
                        wbiAgeSeconds: null,
                      },
                    ] as const,
                  ]
              ).map(([name, p]) => (
                <div key={name}>
                  {name}:可用 <b className="text-text-2">{p.jarsAvailable}</b> / 共{" "}
                  <b className="text-text-2">{p.jarsTotal}</b>
                  {name === VIDEO_PLATFORM_BILIBILI && p.wbiAgeSeconds != null && (
                    <span title="wbi 签名密钥缓存年龄">
                      {" "}
                      · wbi {Math.floor(p.wbiAgeSeconds / 3600)}h
                    </span>
                  )}
                </div>
              ))}
              <div className="text-[10px]">(网关内存风控冷却态)</div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-red">
              unreachable
            </div>
            <div className="mt-1.5 text-[11px] text-text-3">
              网关不可达(检查容器/DOUYIN_GATEWAY_URL);采集失败不记博主连续失败
            </div>
          </>
        )}
      </div>
      <div className="rounded-md border border-line bg-panel px-4 py-4">
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-sound" />
          </svg>
          ASR 转写
        </div>
        {asrConfig.enabled ? (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-text-3">
            <div>
              服务状态{" "}
              <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">
                {asrConfig.provider}/{asrConfig.modelId}
              </span>
            </div>
            <div>
              今日转写{" "}
              <b className="font-mono text-[13px] text-text-1">
                {asr.todayDone} / {asrHours(asr.todayDurationSec)}
              </b>
            </div>
            <div>
              排队中 <b className="font-mono text-[13px] text-text-1">{asr.queueWaiting}</b>
            </div>
            <div>
              今日降级{" "}
              <b
                className={`font-mono text-[13px] ${asr.todayDegraded > 0 ? "text-amber" : "text-text-1"}`}
                title="ASR 终败条数(无音轨/转写失败),按缺转写降级入库"
              >
                {asr.todayDegraded}
              </b>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-amber">
              未启用
            </div>
            <div className="mt-1.5 text-[11px] text-text-3">
              在「AI 配置 → ASR」启用并测试通过后,视频自动转写+解读
            </div>
          </>
        )}
      </div>
    </div>
  );
}
