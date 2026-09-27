import ts from "typescript";

/**
 * Finding every GUI write in the source (assistant–GUI parity spec §10, "the
 * parity guard").
 *
 * A GUI write is a POST endpoint whichever way it was written:
 *
 * - an export of a module whose prologue is `"use server"`;
 * - a function whose own body starts with `"use server"` (an inline server
 *   action in a server component);
 * - a `POST`, `PUT`, `PATCH` or `DELETE` export of a `route.ts` under
 *   `src/app/`.
 *
 * For each one this reports the definitions it hands to `performAction(...)`,
 * with the module each identifier was imported from, so the guard can tell a
 * wrapper over a registered action from a write that owns its own logic.
 *
 * Read with the TypeScript parser rather than a regex, because the shapes are
 * many (`export async function`, `export const x = async () =>`,
 * `export { x }`) and a regex that misses one is a guard with a hole in it.
 * Pure: no filesystem, so the guard's own test can feed it a fixture.
 */

export type EndpointKind = "server-action" | "route";

export interface GuiEndpoint {
  /** `src/app/admin/users/actions.ts#setUserTitle` — the key `EXEMPT` uses. */
  key: string;
  file: string;
  name: string;
  kind: EndpointKind;
  /** `performAction(X, …)` calls in the endpoint's body: X, and where X was imported from. */
  performs: { name: string; from: string | null }[];
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True when `file` (repo-relative, `src/...`) is a route handler module. */
export function isRouteFile(file: string): boolean {
  return /^src\/app\/(.+\/)?route\.tsx?$/.test(file);
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

function hasUseServerPrologue(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function isDefaultExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/** Local name → module specifier, for every import in the file. */
function importsOf(source: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) imports.set(clause.name.text, from);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) imports.set(element.name.text, from);
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, from);
    }
  }
  return imports;
}

function performsIn(node: ts.Node, imports: Map<string, string>): GuiEndpoint["performs"] {
  const found: GuiEndpoint["performs"] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) {
      const callee = child.expression;
      const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      const first = child.arguments[0];
      if (calleeName === "performAction" && first && ts.isIdentifier(first)) {
        found.push({ name: first.text, from: imports.get(first.text) ?? null });
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** The name a function-like node is known by: its own, its variable's, its property's. */
function nameOf(node: FunctionLike, source: ts.SourceFile): string {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.name) {
    return node.name.getText(source);
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText(source);
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `<anonymous:${line + 1}>`;
}

/** Every GUI write `source` (at repo-relative `file`) defines. */
export function endpointsInSource(file: string, text: string): GuiEndpoint[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = importsOf(source);
  const endpoints = new Map<string, GuiEndpoint>();
  const add = (name: string, kind: EndpointKind, body: ts.Node | undefined) => {
    const key = `${file}#${name}`;
    const performs = body ? performsIn(body, imports) : [];
    const existing = endpoints.get(key);
    if (existing) existing.performs.push(...performs);
    else endpoints.set(key, { key, file, name, kind, performs });
  };

  // Local top-level functions and `const x = <function>` by name, for `export { x }`.
  const locals = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) locals.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) locals.set(decl.name.text, decl.initializer ?? decl);
      }
    }
  }

  /** Every exported binding: its public name and the node that implements it. */
  const exported: { name: string; node: ts.Node | undefined }[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      exported.push({ name: isDefaultExport(statement) ? "default" : (statement.name?.text ?? "default"), node: statement });
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exported.push({ name: decl.name.text, node: decl.initializer });
      }
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        exported.push({ name: element.name.text, node: locals.get(local) });
      }
    } else if (ts.isExportAssignment(statement)) {
      exported.push({ name: "default", node: statement.expression });
    }
  }

  if (hasUseServerPrologue(source.statements)) {
    for (const { name, node } of exported) add(name, "server-action", node);
  }

  if (isRouteFile(file)) {
    for (const { name, node } of exported) if (MUTATION_METHODS.has(name)) add(name, "route", node);
  }

  // Inline server actions: any function whose own body opens with the directive.
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node) && node.body && ts.isBlock(node.body) && hasUseServerPrologue(node.body.statements)) {
      add(nameOf(node, source), "server-action", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return [...endpoints.values()];
}
