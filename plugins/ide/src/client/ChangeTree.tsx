/**
 * dsh-ide — collapsible change-file tree (commit / push dialogs).
 *
 * Takes flat change rows (status char + repo-relative path) and renders them
 * as a nested folder/file tree. File leaves can carry a checkbox when used
 * for commit staging; the status letter is coloured like the file tree.
 */

import { useMemo, useState, type ReactElement } from "react";

export interface ChangeLeaf {
  key: string;
  /** Status letter shown before the file ("" hides it, e.g. plain pickers). */
  code: string;
  path: string; // '/' separated, repo-relative
}

interface Props {
  leaves: ChangeLeaf[];
  checkable?: boolean;
  checked?: Record<string, boolean>;
  onToggle?: (key: string) => void;
}

interface DirNode {
  dirs: Map<string, DirNode>;
  files: ChangeLeaf[];
}

function statusColor(code: string): string {
  switch (code) {
    case "A":
      return "#2ea043";
    case "M":
      return "#1a66d8";
    case "D":
      return "#d1242f";
    default:
      return "#b3261e";
  }
}

const CHEVRON = (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
);
const DIR_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.8 3.4h4.1l1.2 1.4h7.1v7.6a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6V3.4Z" />
  </svg>
);

function buildTree(leaves: ChangeLeaf[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  for (const leaf of leaves) {
    const parts = leaf.path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(parts[i], next);
      }
      node = next;
    }
    node.files.push({ ...leaf, path: parts[parts.length - 1] ?? leaf.path });
  }
  return root;
}

function allDirKeys(node: DirNode, prefix: string, acc: string[]): string[] {
  for (const [name, child] of node.dirs) {
    acc.push(prefix + name);
    allDirKeys(child, prefix + name + "/", acc);
  }
  return acc;
}

export function ChangeTree({ leaves, checkable, checked, onToggle }: Props): ReactElement {
  const tree = useMemo(() => buildTree(leaves), [leaves]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allDirKeys(tree, "", [])));

  function toggleDir(key: string): void {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderDir(dir: DirNode, name: string, prefix: string, depth: number): ReactElement {
    const key = prefix + name;
    const open = expanded.has(key);
    const kids: ReactElement[] = [];
    for (const [n, child] of dir.dirs) kids.push(renderDir(child, n, key + "/", depth + 1));
    for (const f of dir.files) kids.push(renderFile(f, depth + 1));
    return (
      <div key={key}>
        <div
          onClick={() => toggleDir(key)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingLeft: 8 + depth * 14,
            paddingRight: 6,
            height: 22,
            cursor: "pointer",
            color: "var(--dsw-alias-label-primary, #0f1115)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "inline-flex", width: 10, justifyContent: "center", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
            {open ? <span style={{ display: "inline-flex", transform: "rotate(90deg)" }}>{CHEVRON}</span> : CHEVRON}
          </span>
          <span style={{ display: "inline-flex", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{DIR_ICON}</span>
          <span style={{ fontSize: 12.5 }}>{name}</span>
        </div>
        {open ? <div>{kids}</div> : null}
      </div>
    );
  }

  function renderFile(f: ChangeLeaf, depth: number): ReactElement {
    const item = f.code ? (
      <span style={{ flex: "none", width: 14, textAlign: "center", fontWeight: 700, fontSize: 11, color: statusColor(f.code) }}>{f.code}</span>
    ) : (
      <span style={{ flex: "none", width: 14 }} />
    );
    const label = <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{f.path}</span>;
    return (
      <div
        key={f.key}
        title={f.path}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingLeft: 8 + depth * 14,
          paddingRight: 6,
          height: 24,
          whiteSpace: "nowrap",
          color: "var(--dsw-alias-label-primary, #0f1115)",
        }}
      >
        {checkable ? (
          <input
            type="checkbox"
            style={{ margin: 0 }}
            checked={checked ? checked[f.key] !== false : true}
            onChange={() => onToggle && onToggle(f.key)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ display: "inline-flex", width: 12 }} />
        )}
        {item}
        {label}
      </div>
    );
  }

  return (
    <div style={{ userSelect: "none" }}>
      {renderDirChildren(tree, 0)}
    </div>
  );

  function renderDirChildren(dir: DirNode, depth: number): ReactElement {
    const kids: ReactElement[] = [];
    for (const [n, child] of dir.dirs) kids.push(renderDir(child, n, "", depth));
    for (const f of dir.files) kids.push(renderFile(f, depth));
    return <>{kids}</>;
  }
}
