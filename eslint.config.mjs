import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      "public/vditor/**", // vditor 第三方运行时资源(lute WASM/highlight,随包拷贝,不入 lint)
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "workspace/**",
      "services/**", // Python sidecar(services/douyin-gateway;.venv 含 playwright 驱动海量 JS 产物,非 lint 对象)
      ".test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  {
    // M35 宿主唯一化红线(机器守,不靠 review 记性):AssistantCard 全站仅
    // 宿主 AssistantFab 一处实例化;页面接入走 agent-host 两协议(唤起 +
    // 能力注册)。页面自持卡会随路由卸载杀 run(M31 验收实证)。
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/site/assistant/AssistantFab.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/components/site/assistant/AssistantCard",
              message:
                "AssistantCard 仅允许宿主 AssistantFab 实例化(M35 宿主唯一化);页面接入走 src/lib/agent/agent-host.ts 两协议:openAgentAssistant 唤起 + useAgentEditSurface 能力注册。",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
