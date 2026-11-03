import { format } from "prettier/standalone";
export const parsers: Record<string, string> = {
  js: "babel",
  mjs: "babel",
  cjs: "babel",
  jsx: "babel",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
};
export async function beautify(code: string, parser: string) {
  const plugins =
    parser === "yaml"
      ? [await import("prettier/plugins/yaml")]
      : parser === "typescript"
        ? [
            await import("prettier/plugins/typescript"),
            await import("prettier/plugins/estree"),
          ]
        : ["html", "markdown"].includes(parser)
          ? [
              parser === "html"
                ? await import("prettier/plugins/html")
                : await import("prettier/plugins/markdown"),
            ]
          : ["css", "less", "scss"].includes(parser)
            ? [await import("prettier/plugins/postcss")]
            : [
                await import("prettier/plugins/babel"),
                await import("prettier/plugins/estree"),
              ];
  if (parser === "json") JSON.parse(code);
  return format(code, { parser, plugins, embeddedLanguageFormatting: "off" });
}
