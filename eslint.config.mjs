import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: ["out/**", ".next/**", "api/dist/**", "node_modules/**", "api/node_modules/**"]
  }
];

export default eslintConfig;
