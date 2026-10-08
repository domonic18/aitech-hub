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
];

export default eslintConfig;
