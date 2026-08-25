import type { ExtractedSymbol } from "./typescript.js";

export function extractPythonSymbols(content: string): ExtractedSymbol[] {
  const lines = content.split("\n");
  const symbols: ExtractedSymbol[] = [];

  const fnRegex = /^\s*def\s+([A-Za-z0-9_$]+)\s*\(/;
  const classRegex = /^\s*class\s+([A-Za-z0-9_$]+)/;

  let currentClass: string | undefined = undefined;
  let currentClassIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue;
    }

    const indent = line.search(/\S/);

    if (currentClassIndent !== -1 && indent <= currentClassIndent) {
      currentClass = undefined;
      currentClassIndent = -1;
    }

    let match = line.match(classRegex);
    if (match) {
      const name = match[1];
      const endLine = findPythonBlockEndLine(lines, i, indent);
      symbols.push({
        name,
        kind: "class",
        startLine: lineNum,
        endLine,
        content: lines.slice(i, endLine).join("\n"),
      });
      currentClass = name;
      currentClassIndent = indent;
      continue;
    }

    match = line.match(fnRegex);
    if (match) {
      const name = match[1];
      const endLine = findPythonBlockEndLine(lines, i, indent);
      symbols.push({
        name,
        kind: currentClass ? "method" : "function",
        startLine: lineNum,
        endLine,
        containerName: currentClass,
        content: lines.slice(i, endLine).join("\n"),
      });
      continue;
    }
  }

  return symbols;
}

function findPythonBlockEndLine(lines: string[], startIdx: number, startIndent: number): number {
  let lastNonEmpty = startIdx + 1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue;
    }
    const indent = line.search(/\S/);
    if (indent <= startIndent) {
      return lastNonEmpty;
    }
    lastNonEmpty = i + 1;
  }
  return lines.length;
}
