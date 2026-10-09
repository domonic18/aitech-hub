/**
 * 用户头像(M22 批②,需求10):有 avatarPath 用图(sharp 管线产物),否则
 * 默认风格头像——accent 渐变底 + 昵称/用户名首字(DESIGN-SPEC 令牌体系,
 * 同 admin/users 行内头像的升级版)。纯展示,服务端/客户端通用。
 */
const SIZES = {
  sm: "h-7 w-7 text-[12px]",
  md: "h-9 w-9 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

export default function Avatar({
  nickname,
  avatarPath,
  size = "md",
}: {
  nickname: string | null;
  avatarPath: string | null;
  size?: keyof typeof SIZES;
}): React.ReactElement {
  const cls = `${SIZES[size]} flex-none rounded-full object-cover`;
  if (avatarPath) {
    // eslint-disable-next-line @next/next/no-img-element -- 站内动态媒体路径
    return <img src={avatarPath} alt="" className={cls} />;
  }
  const ch = (nickname ?? "?").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`${cls} flex items-center justify-center font-semibold text-white`}
      style={{
        background:
          "linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, #7c3aed) 100%)",
      }}
    >
      {ch}
    </span>
  );
}
