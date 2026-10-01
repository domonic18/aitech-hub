/** turndown-plugin-gfm 无官方类型,按其 CommonJS 导出补最小声明 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  type Plugin = (service: TurndownService) => void;

  export const gfm: Plugin[];
  export const highlightedCodeBlock: Plugin;
  export const strikethrough: Plugin;
  export const tables: Plugin;
  export const taskListItems: Plugin;
}
