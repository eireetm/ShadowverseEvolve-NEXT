// The card scripts as source code, for the card feature table's analysis of what each card does and counts (tools only: the
// bot reads the generated table, never the scripts' code). Each set's generated index (packages/core/src/script/<set>/index.ts)
// maps a definition to its file; a file's top-level declarations and imports let an identifier be followed into the shared
// script helpers (script/targets.ts, helpers.ts, a set's shared*.ts). Code outside packages/core/src/script (the engine) is not
// followed: its functions are named, not read.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { ROOT } from "./series";

export const SCRIPT_ROOT = join(ROOT, "packages", "core", "src", "script");

/** An ESTree node as rolldown's parser gives it (TypeScript syntax included). */
export interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface Module {
  file: string;
  source: string;
  ast: Node;
  /** Local name -> where it comes from (a script file and the name exported there), or an outside module (`file` null). */
  imports: Map<string, { file: string | null; name: string; module: string }>;
  /** Top-level declarations by name: the initializer of a const, or the function declaration itself. */
  decls: Map<string, Node>;
  /** `export default ...`'s expression. */
  defaultExport: Node | null;
}

const modules = new Map<string, Module>();

function resolveSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(join(dirname(from), spec));
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  return null;
}

/** A script file, parsed once. */
export function moduleOf(file: string): Module {
  const cached = modules.get(file);
  if (cached) return cached;
  const source = readFileSync(file, "utf8");
  const ast = parseAst(source, { lang: "ts" }) as unknown as Node;
  const imports = new Map<string, { file: string | null; name: string; module: string }>();
  const decls = new Map<string, Node>();
  let defaultExport: Node | null = null;
  for (const stmt of ast.body as Node[]) {
    if (stmt.type === "ImportDeclaration") {
      const spec = (stmt.source as Node).value as string;
      const target = resolveSpecifier(file, spec);
      const inScripts = target !== null && normalize(target).startsWith(normalize(SCRIPT_ROOT));
      for (const s of (stmt.specifiers as Node[]) ?? []) {
        const local = (s.local as Node).name as string;
        const imported = s.type === "ImportSpecifier" ? (((s.imported as Node).name ?? (s.imported as Node).value) as string) : "default";
        imports.set(local, { file: inScripts ? target : null, name: imported, module: spec });
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      defaultExport = stmt.declaration as Node;
      continue;
    }
    const decl = stmt.type === "ExportNamedDeclaration" ? (stmt.declaration as Node | null) : stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
      // export { a, b } from "./x": re-exports, followed like imports.
      const target = resolveSpecifier(file, (stmt.source as Node).value as string);
      for (const s of (stmt.specifiers as Node[]) ?? []) {
        const exported = ((s.exported as Node).name ?? (s.exported as Node).value) as string;
        const local = ((s.local as Node).name ?? (s.local as Node).value) as string;
        imports.set(exported, { file: target, name: local, module: (stmt.source as Node).value as string });
      }
      continue;
    }
    if (!decl) continue;
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations as Node[]) {
        const id = d.id as Node;
        if (id.type === "Identifier" && d.init) decls.set(id.name as string, d.init as Node);
      }
    } else if (decl.type === "FunctionDeclaration" && decl.id) {
      decls.set((decl.id as Node).name as string, decl);
    }
  }
  const module: Module = { file, source, ast, imports, decls, defaultExport };
  modules.set(file, module);
  return module;
}

/** What a name means in a module: a declaration (in it or a script file it imports), or something outside the scripts. */
export type Resolved = { kind: "decl"; module: Module; name: string; node: Node } | { kind: "external"; module: string; name: string } | { kind: "unknown"; name: string };

export function resolveName(module: Module, name: string, depth = 0): Resolved {
  const local = module.decls.get(name);
  if (local) return { kind: "decl", module, name, node: local };
  const imp = module.imports.get(name);
  if (!imp) return { kind: "unknown", name };
  if (imp.file === null) return { kind: "external", module: imp.module, name: imp.name };
  if (depth > 10) return { kind: "unknown", name };
  return resolveName(moduleOf(imp.file), imp.name, depth + 1);
}

/** Every scripted definition's file, from the sets' generated indexes. */
export function scriptFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const set of readdirSync(SCRIPT_ROOT, { withFileTypes: true })) {
    if (!set.isDirectory()) continue;
    const index = join(SCRIPT_ROOT, set.name, "index.ts");
    if (!existsSync(index)) continue;
    const module = moduleOf(index);
    for (const stmt of module.ast.body as Node[]) {
      const decl = stmt.type === "ExportNamedDeclaration" ? (stmt.declaration as Node | null) : null;
      if (!decl || decl.type !== "VariableDeclaration") continue;
      for (const d of decl.declarations as Node[]) {
        const init = d.init as Node | null;
        if (!init || init.type !== "ObjectExpression") continue;
        for (const prop of init.properties as Node[]) {
          if (prop.type !== "Property") continue;
          const key = ((prop.key as Node).value ?? (prop.key as Node).name) as string;
          const value = prop.value as Node;
          if (value.type !== "Identifier") continue;
          const imp = module.imports.get(value.name as string);
          if (imp?.file) out.set(key, imp.file);
        }
      }
    }
  }
  return out;
}

/** Calls `visit` on every node under `node` (depth first, parents before children); `visit` returning false skips its children. */
export function walk(node: unknown, visit: (n: Node, parent: Node | null) => void | boolean, parent: Node | null = null): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  if (visit(n, parent) === false) return;
  for (const [key, value] of Object.entries(n)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (value && typeof value === "object") walk(value, visit, n);
  }
}

/** A node's source text. */
export const textOf = (module: Module, node: Node) => module.source.slice(node.start, node.end);
