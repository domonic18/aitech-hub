/**
 * 站点 SVG sprite(DESIGN-SPEC §4):符号注册表已收编 icons/icon-defs(M56
 * review P2-13,site/admin 单源防漂移);本件只保留站点消费序与挂载。
 */
import { ICON_DEFS } from "@/components/icons/icon-defs";
import type { ReactElement } from "react";

const VIEWBOX = "64 64 896 896";

/** 本域消费序(渲染顺序保持重构前不变;id 必须已登记 icon-defs) */
const IDS = [
  "i-fire",
  "i-book",
  "i-tool",
  "i-github",
  "i-code",
  "i-star",
  "i-read",
  "i-robot",
  "i-eye",
  "i-search",
  "i-thunderbolt",
  "i-export",
  "i-caret-right-fill",
  "i-like",
  "i-comment",
  "i-bars",
  "i-appstore",
  "i-plus",
  "i-delete",
  "i-close",
  "i-clock",
  "i-caret-down",
  "i-user",
  "i-logout",
  "i-avatar",
];

export default function SiteSprite(): ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" style={{ display: "none" }} aria-hidden="true">
      {IDS.map((id) => ICON_DEFS.get(id)!)
        .filter((s) => s !== undefined)
        .map((s) => (
          <symbol
            key={s.id}
            id={s.id}
            viewBox={VIEWBOX}
            dangerouslySetInnerHTML={{ __html: s.body }}
          />
        ))}
    </svg>
  );
}
