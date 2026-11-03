export type Entry = {
  name: string;
  path: string;
  size: number;
  modified?: number;
  revision?: string;
};
export type Props = {
  entry: Entry;
  siblings: Entry[];
  readOnly: boolean;
  open: (e: Entry) => void;
  close: () => void;
  saved: () => void | Promise<void>;
};
export const ext = (name: string) =>
  name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
export const natives: Record<string, string> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jfif: "jpeg",
  pjpeg: "jpeg",
  png: "png",
  apng: "apng",
  gif: "gif",
  webp: "webp",
  avif: "avif",
  svg: "svg+xml",
  bmp: "bmp",
  ico: "x-icon",
  cur: "x-icon",
  jxl: "jxl",
};
export const converts = new Set(
  "heic heif tif tiff psd tga pcx dds jp2 j2k ppm pgm pbm pnm qoi".split(" "),
);
const text = new Set(
  "txt text log md markdown mdx html htm xhtml xml xsl svg css scss less js mjs cjs jsx ts tsx json jsonc json5 yaml yml toml ini conf cfg env properties csv tsv sql py rb php go rs java kt kts groovy gradle c h cc cpp cxx hpp cs swift scala sh bash zsh fish ps1 bat lua pl r dart vue svelte astro graphql gql dockerfile mk cmake tex diff patch editorconfig gitignore gitattributes lock rst adoc tf tfvars nginx service proto cbor-diag vbs vb asm clj ex exs erl hr hs fs fsx pas sass styl sol nix reg desktop".split(
    " ",
  ),
);
export function kind(name: string) {
  const x = ext(name);
  if (Object.hasOwn(natives, x) || converts.has(x)) return "image";
  if (x === "docx" || x === "xlsx" || x === "pptx") return x;
  if (x === "pdf") return "pdf";
  if (x === "djvu" || x === "djv") return "djvu";
  if (
    text.has(x) ||
    /^(Dockerfile|Makefile|CMakeLists.txt|Jenkinsfile|Gemfile|Rakefile|README|LICENSE|CHANGELOG|\.env(?:\..+)?|\.bashrc|\.zshrc|\.npmrc)$/i.test(
      name,
    )
  )
    return "text";
  return "";
}
export const asset = "/api/v1/module-assets/viewers/";
