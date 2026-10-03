/**
 * PAT 令牌管理页(M5-c):列表(名称/创建/最近使用/状态/操作)+ 创建岛 +
 * 吊销岛。整页服务端渲染直调 listPats;明文令牌只存在于创建岛的一次性
 * 弹窗,列表永远只有哈希投影。API 侧仅会话通道(PAT 不得自我增殖)。
 */
import PatCreateDialog from "@/components/admin/PatCreateDialog";
import PatRevokeButton from "@/components/admin/PatRevokeButton";
import { listPats } from "@/lib/auth/pat";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  return d === null ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

export default async function AdminPatsPage(): Promise<React.ReactElement> {
  const list = await listPats();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">PAT 令牌</h2>
          <p className="mt-0.5 text-xs text-text-3">
            供 Claude Code / MCP 经 <code className="font-mono">Authorization: Bearer</code> 调发布
            API;等同管理员凭证,泄露请立即吊销。
          </p>
        </div>
        <PatCreateDialog />
      </div>

      <div className="rounded-md border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="px-4 py-2.5 font-normal">备注</th>
                <th className="w-44 px-4 py-2.5 font-normal">创建时间</th>
                <th className="w-44 px-4 py-2.5 font-normal">最近使用</th>
                <th className="w-24 px-4 py-2.5 font-normal">状态</th>
                <th className="w-24 px-4 py-2.5 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center font-mono text-xs text-text-3">
                    暂无令牌,点击右上角「新建令牌」
                  </td>
                </tr>
              )}
              {list.map((p) => (
                <tr key={p.id} className="border-b border-line/60 last:border-b-0 hover:bg-panel-2">
                  <td className="px-4 py-2.5">
                    <span className="text-text-1">{p.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-text-3">#{p.id}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-text-2">{fmt(p.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-text-2">{fmt(p.lastUsedAt)}</td>
                  <td className="px-4 py-2.5">
                    {p.revokedAt ? (
                      <span className="rounded-sm bg-panel-2 px-1.5 py-px text-[10px] text-text-3">
                        已吊销
                      </span>
                    ) : (
                      <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">
                        生效中
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.revokedAt ? (
                      <span className="text-xs text-text-3">—</span>
                    ) : (
                      <PatRevokeButton id={p.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:库中仅存 sha256 哈希,明文仅在创建弹窗展示一次;吊销幂等,已吊销不可恢复,需重新签发。
        令牌校验要求持有人为 admin 且账号 active,禁用账号即失效全部令牌。
      </p>
    </div>
  );
}
