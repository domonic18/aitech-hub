/** markdown-it-footnote v4 无自带类型(社区 @types 面向 v3 已过期)——最小声明 */
declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
