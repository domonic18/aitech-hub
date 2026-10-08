import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo/site";

/** robots(arch/07-frontend §3:允许全部;admin/api disallow;不针对 AI 爬虫设限——GEO 战略) */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
