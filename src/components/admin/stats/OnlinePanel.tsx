/**
 * 在线用户卡(M28 批②):当前在线人数 + 停留页面分布(承接旧站 WP statistics
 * 能力)。读侧 getOnlinePresence 直读 Redis ZSET(5 分钟滑窗),无 flush 延迟;
 * 每人归并到最后活跃页(浏览中换页只算最新一页,与 WP 同语义)。
 */
import type { OnlinePresence } from "@/lib/stats/online";

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
        {presence.pages.length === 0 ? (
          <p className="py-8 text-center font-mono text-xs text-text-3">近 5 分钟暂无活跃访客</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="px-3 py-2 font-normal">停留页面</th>
                <th className="w-20 px-3 py-2 text-right font-normal">人数</th>
              </tr>
            </thead>
            <tbody>
              {presence.pages.slice(0, 10).map((p) => (
                <tr key={p.path} className="border-b border-line/60 last:border-b-0">
                  <td className="max-w-0 px-3 py-2">
                    <div className="truncate font-mono text-[12px] text-text-1" title={p.path}>
                      {p.path}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-text-1">{p.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-dashed border-line px-5 py-3 text-[11px] leading-relaxed text-text-3">
        口径:beacon 心跳的 5 分钟滑动窗口(最后活跃 5 分钟内视为在线;去爬虫/管理员);
        每人归并到最后活跃页面;实时读 Redis,无 flush 延迟。
      </p>
    </div>
  );
}
