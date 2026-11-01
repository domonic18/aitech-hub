/**
 * admin SVG sprite(DESIGN-SPEC §4):符号注册表已收编 icons/icon-defs(M56
 * review P2-13,site/admin 单源防漂移);本件只保留 admin 消费序与挂载。
 */
import { ICON_DEFS } from "@/components/icons/icon-defs";
import type { ReactElement } from "react";

const VIEWBOX = "64 64 896 896";

/** 本域消费序(渲染顺序保持重构前不变;id 必须已登记 icon-defs) */
const IDS = [
  "i-github",
  "i-export",
  "i-linechart",
  "i-calendar",
  "i-dashboard",
  "i-filetext",
  "i-picture",
  "i-folder",
  "i-send",
  "i-scan",
  "i-cloudserver",
  "i-aim",
  "i-robot",
  "i-piechart",
  "i-comment",
  "i-user",
  "i-key",
  "i-moon",
  "i-sun",
  "i-avatar",
  "i-logout",
  "i-caret-down",
  "i-menu",
  "i-book",
  "i-plus",
  "i-search",
  "i-zoom-in",
  "i-zoom-out",
  "i-expand",
  "i-warning",
  "i-edit",
  "i-eye",
  "i-check",
  "i-cloudupload",
  "i-video",
  "i-paperclip",
  "i-close",
  "i-delete",
  "i-global",
  "i-sound",
  "i-experiment",
  "i-save",
  "i-checkcircle",
  "i-closecircle",
  "i-infocircle",
  "i-appstore",
  "i-setting",
];

export default function AdminSprite(): ReactElement {
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
