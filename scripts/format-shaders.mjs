import { readdir, readFile, writeFile } from "node:fs/promises";

// WGSL has no formatter in our existing toolchain. This deliberately small formatter
// changes whitespace only and checks its token stream before writing any shader.
const tokenPattern =
  /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|0[xX][\da-fA-F]+(?:\.[\da-fA-F]*)?(?:[pP][+-]?\d+)?[iufh]?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[iufh]?|[a-zA-Z_]\w*|->|<<=?|>>=?|[=!<>+*/%&|^-]=|&&|\|\||\+\+|--|[^\s]/gy;
/** Keeps only entries matching the callback predicate. */
function tokens(source) {
  return [...source.matchAll(tokenPattern)]
    .map((match) => /** Returns match[0]. */ match[0])
    .filter(
      (token) => /** Returns !/^\s+$/.test(token). */ !/^\s+$/.test(token),
    );
}
/** Returns output. */
function format(source) {
  const input = tokens(source),
    lines = [],
    blocks = [];
  let line = "",
    indent = 0,
    parentheses = 0,
    pendingStruct = false;
  /** Applies line.trim, lines.push, " ".repeat to flush. */
  const flush = () => {
    if (line.trim()) lines.push("  ".repeat(indent) + line.trim());
    line = "";
  };
  /** Applies line.at, [")", "]", ",", ";", ".", ":"].includes, ["@", ".", "(", "["].includes to append. */
  const append = (token) => {
    const previous = line.at(-1);
    const tight =
      !line ||
      [")", "]", ",", ";", ".", ":"].includes(token) ||
      ["@", ".", "(", "["].includes(previous) ||
      (token === "(" &&
        /[\w>]$/.test(line) &&
        !/\b(if|for|while|switch)$/.test(line)) ||
      token === "[";
    line += (tight ? "" : " ") + token;
  };
  for (let index = 0; index < input.length; index++) {
    const token = input[index];
    if (token.startsWith("//") || token.startsWith("/*")) {
      flush();
      for (const commentLine of token.split("\n"))
        lines.push("  ".repeat(indent) + commentLine.trim());
      continue;
    }
    if (token === "struct") pendingStruct = true;
    if (token === "(") parentheses++;
    if (token === ")") parentheses--;
    if (token === "{") {
      append(token);
      flush();
      blocks.push(pendingStruct ? "struct" : "block");
      pendingStruct = false;
      indent++;
      continue;
    }
    if (token === "}") {
      flush();
      indent--;
      blocks.pop();
      append(token);
      if (![";", ",", "else"].includes(input[index + 1])) {
        flush();
        if (!indent) lines.push("");
      }
      continue;
    }
    append(token);
    if (token === ";" && !parentheses) flush();
    if (token === "," && blocks.at(-1) === "struct" && !parentheses) flush();
  }
  flush();
  // Compact builtin type parameters while leaving comparison operators alone.
  const output =
    lines
      .join("\n")
      .replace(
        /\b(array|atomic|ptr|var|vec[234]|mat[234]x[234]|texture_\w+)\s*<([\w\s,<>]+)>/g,
        (type) =>
          /** Delegates this operation to type.replace. */ type.replace(
            /\s*([<>])\s*/g,
            "$1",
          ),
      )
      .replace(/\s+(\+\+|--)/g, "$1")
      .trimEnd() + "\n";
  if (JSON.stringify(tokens(output)) !== JSON.stringify(input))
    throw new Error("Formatter changed WGSL tokens");
  return output;
}
let differences = 0;
for (const file of (await readdir("src/shaders"))
  .filter((file) =>
    /** Delegates this operation to file.endsWith. */ file.endsWith(".wgsl"),
  )
  .sort()) {
  const path = `src/shaders/${file}`,
    source = await readFile(path, "utf8"),
    output = format(source);
  if (source === output) continue;
  differences++;
  console.log(path);
  if (!process.argv.includes("--check")) await writeFile(path, output);
}
if (process.argv.includes("--check") && differences) process.exitCode = 1;
