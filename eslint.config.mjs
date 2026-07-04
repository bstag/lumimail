import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = [
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "coverage/**", "test-results/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Test code asserts against dynamically-typed JSON responses and builds
    // flexible mocks; `any` is pragmatic and confined to tests.
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["worker.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
];

export default eslintConfig;
