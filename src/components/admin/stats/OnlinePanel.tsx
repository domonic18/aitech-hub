/**
 * 在线用户卡(M28 批②):当前在线人数 + 逐人列表(承接旧站 WP statistics
 * 能力)。读侧 getOnlinePresence 直读 Redis ZSET(5 分钟滑窗),无 flush 延迟;
 * 每人一行:登录用户显示用户名/邮箱,未登录显示 IP(2026-10-14 用户定调),
 * 并列最后活跃页面与相对时间(页面为 RSC,随 admin 页每次请求刷新)。
 */
import type { OnlinePresence } from "@/lib/stats/online";

function relTime(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  return `${Math.floor(sec / 60)} 分钟前`;
}

export default function OnlinePanel({
  presence,
}: {
  presence: OnlinePresence;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">在线用户</h3>
        <span className="ml-auto font-mono text-xs text-text-3">
          当前在线 <b className="text-base text-accent">{presence.total.toLocaleString("en-US")}</b>{" "}
          人
        </span>
      </div>
      <div className="p-2">
        {presence.visitors.length === 0 ? (
          <p className="py-8 text-center font-mono text-xs text-text-3">近 5 分钟暂无活跃访客</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="px-3 py-2 font-normal">访客</th>
                <th className="px-3 py-2 font-normal">停留页面</th>
                <th className="w-24 px-3 py-2 text-right font-normal">最后活跃</th>
              </tr>
            </thead>
            <tbody>
              {presence.visitors.slice(0, 20).map((v) => (
                <tr
                  key={`${v.kind}:${v.label}:${v.path}`}
                  className="border-b border-line/60 last:border-b-0"
                >
                  <td className="max-w-0 px-3 py-2">
                    <div className="truncate" title={v.kind === "user" ? v.label : `IP ${v.label}`}>
                      {v.kind === "user" ? (
                        <span className="text-text-1">{v.label}</span>
                      ) : (
                        <span className="font-mono text-[12px] text-text-2">
                          {v.label || "匿名"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-0 px-3 py-2">
                    <div className="truncate font-mono text-[12px] text-text-1" title={v.path}>
                      {v.path}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] text-text-3">
                    {relTime(v.lastActiveMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-dashed border-line px-5 py-3 text-[11px] leading-relaxed text-text-3">
        口径:beacon 心跳的 5 分钟滑动窗口(最后活跃 5 分钟内视为在线;去爬虫/管理员);登录用户
        显示用户名/邮箱,未登录显示 IP(仅内存键 5 分钟滑窗,不入库);每人归并到最后活跃页面; 实时读
        Redis,无 flush 延迟。
      </p>
    </div>
  );
}
