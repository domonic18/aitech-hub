import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** 旧 URL 全部带尾斜杠,canonical 一致(04 文档 §3 红线 1,始终开启) */
  trailingSlash: true,
  /** Docker 单镜像部署(07 文档 §3) */
  output: "standalone",
};

export default nextConfig;
