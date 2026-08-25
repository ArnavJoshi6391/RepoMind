export interface ExtractedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "variable" | "method" | "type";
  startLine: number;
  endLine: number;
  containerName?: string;
  content: string;
}

export function extractTypeScriptSymbols(content: string): ExtractedSymbol[] {
  const lines = content.split("\n");
  const symbols: ExtractedSymbol[] = [];

  // Robust deterministic AST symbol extraction regex patterns for TS/JS
  const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/;
  const classRegex = /(?:export\s+)?class\s+([A-Za-z0-9_$]+)/;
  const interfaceRegex = /(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/;
  const typeRegex = /(?:export\s+)?type\s+([A-Za-z0-9_$]+)/;
  const constFnRegex = /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/;

  let currentContainer: string | undefined = undefined;
  let containerEndLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (lineNum > containerEndLine) {
      currentContainer = undefined;
    }

    let match = line.match(classRegex);
    if (match) {
      const name = match[1];
      const endLine = findBlockEndLine(lines, i);
      symbols.push({
        name,
        kind: "class",
        startLine: lineNum,
        endLine,
        content: lines.slice(i, endLine).join("\n"),
      });
      currentContainer = name;
      containerEndLine = endLine;
      continue;
    }

    match = line.match(interfaceRegex);
    if (match) {
      const name = match[1];
      const endLine = findBlockEndLine(lines, i);
      symbols.push({
        name,
        kind: "interface",
        startLine: lineNum,
        endLine,
        content: lines.slice(i, endLine).join("\n"),
      });
      continue;
    }

    match = line.match(typeRegex);
    if (match) {
      const name = match[1];
      const endLine = findStatementEndLine(lines, i);
      symbols.push({
        name,
        kind: "type",
        startLine: lineNum,
        endLine,
        content: lines.slice(i, endLine).join("\n"),
      });
      continue;
    }

    match = line.match(fnRegex) || line.match(constFnRegex);
    if (match) {
      const name = match[1];
      const endLine = findBlockEndLine(lines, i);
      symbols.push({
        name,
        kind: currentContainer ? "method" : "function",
        startLine: lineNum,
        endLine,
        containerName: currentContainer,
        content: lines.slice(i, endLine).join("\n"),
      });
      continue;
    }
  }

  return symbols;
}

function findBlockEndLine(lines: string[], startIdx: number): number {
  let openBraces = 0;
  let foundBrace = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === "{") {
        openBraces++;
        foundBrace = true;
      } else if (char === "}") {
        openBraces--;
        if (foundBrace && openBraces === 0) {
          return i + 1;
        }
      }
    }
  }

  return Math.min(startIdx + 15, lines.length);
}

function findStatementEndLine(lines: string[], startIdx: number): number {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes(";")) {
      return i + 1;
    }
  }
  return Math.min(startIdx + 5, lines.length);
}
