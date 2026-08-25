import Parser from "web-tree-sitter";

export const PARSER_VERSION = "tree-sitter-v1.0.0";
export const CHUNKER_VERSION = "symbol-boundary-v1.0.0";

let isInitialized = false;

export async function initTreeSitter(): Promise<void> {
  if (!isInitialized) {
    await Parser.init();
    isInitialized = true;
  }
}

export function detectLanguage(filePath: string): "typescript" | "javascript" | "python" | "fallback" {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    default:
      return "fallback";
  }
}
