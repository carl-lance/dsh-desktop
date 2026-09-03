/**
 * dsh-ide — commit history graph (Git panel "历史").
 *
 * Uses @gitgraph/react to draw the commit DAG (lanes, merges, branch tips).
 * Commit rows come from the host `git.log` op (oldest → newest, topo order);
 * each commit is assigned to the branch whose first-parent chain reaches it,
 * then replayed onto gitgraph branches; merges draw when the second parent
 * sits at the other branch's current tip.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Gitgraph, TemplateName } from "@gitgraph/react";
import { call } from "./ideApi";

interface GitCommitRow {
  hash: string;
  parents: string[];
  decorations: string;
  author: string;
  ts: number;
  subject: string;
}

interface Props {
  root: string;
}

const REFRESH_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M13.8 8a5.8 5.8 0 1 1-1.7-4.1" />
    <path d="M13.8 1.8v3.1h-3.1" />
  </svg>
);

export function GitHistory({ root }: Props): ReactElement {
  const [commits, setCommits] = useState<GitCommitRow[] | null>(null);
  const [error, setError] = useState("");
  const [head, setHead] = useState("");

  async function load(): Promise<void> {
    setError("");
    try {
      const r = (await call("git.log", { count: 150 })) as { commits: GitCommitRow[]; head: string };
      setCommits(r.commits);
      setHead(r.head);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCommits(null);
    }
  }

  useEffect(() => {
    if (root) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const lanes = useMemo(() => (commits ? assignLanes(commits) : null), [commits]);

  if (error) {
    return (
      <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)", lineHeight: 1.7 }}>
        {error}
        <button type="button" onClick={() => void load()} style={{ display: "block", marginTop: 8, padding: "4px 10px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          重试
        </button>
      </div>
    );
  }

  if (!commits || !lanes) {
    return <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载提交记录…</div>;
  }

  if (commits.length === 0) {
    return <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>暂无提交记录</div>;
  }

  return (
    <div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
          fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)", flex: "none",
        }}
      >
        <span style={{ fontFamily: 'var(--ds-font-family-mono, Consolas, monospace)' }}>{head ? `HEAD ${head}` : ""}</span>
        <span>{commits.length} 条</span>
        <button
          type="button"
          title="刷新"
          onClick={() => void load()}
          style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "inherit", display: "inline-flex", padding: 2 }}
        >
          {REFRESH_ICON}
        </button>
      </div>
      <div style={{ overflow: "auto" }}>
        <Gitgraph options={{ template: TemplateName.Metro }}>
          {(g) => {
            void replay(g, commits, lanes);
          }}
        </Gitgraph>
      </div>
    </div>
  );
}

/** Lane per commit: branch whose first-parent chain reaches the commit. */
function assignLanes(rows: GitCommitRow[]): Record<string, string> {
  const byHash = new Map(rows.map((c) => [c.hash, c]));
  const lane: Record<string, string> = {};

  const tips: Array<{ name: string; hash: string }> = [];
  for (const c of rows) {
    if (!c.decorations) continue;
    for (const tok of c.decorations.split(", ")) {
      if (!tok || tok.startsWith("tag:")) continue;
      const name = tok.replace(/^HEAD -> /, "").trim();
      if (name && !tips.some((t) => t.name === name)) tips.push({ name, hash: c.hash });
    }
  }
  // Walk first-parent from each tip; first claim wins (keeps the merge base
  // and shared history on the first branch that reaches them).
  for (const tip of tips) {
    let cur = byHash.get(tip.hash) ?? null;
    while (cur && lane[cur.hash] === undefined) {
      lane[cur.hash] = tip.name;
      cur = cur.parents[0] ? (byHash.get(cur.parents[0]) ?? null) : null;
    }
  }
  for (const c of rows) {
    if (lane[c.hash] === undefined) {
      lane[c.hash] = c.parents[0] ? (lane[c.parents[0]] ?? "master") : "master";
    }
  }
  return lane;
}

interface GraphApi {
  branch(name: string, opts?: unknown): any;
}

/** Replay commits (oldest → newest) onto gitgraph branches. */
function replay(g: GraphApi, rows: GitCommitRow[], lanes: Record<string, string>): void {
  const byHash = new Map(rows.map((c) => [c.hash, c]));
  const branchApi: Record<string, any> = {};
  const laneLast: Record<string, string> = {};

  for (const c of rows) {
    const laneName = lanes[c.hash] ?? "master";
    const parentFirst = c.parents[0] ?? "";
    const parentLane = parentFirst ? lanes[parentFirst] : undefined;

    if (!branchApi[laneName]) {
      const from = parentLane && branchApi[parentLane] ? branchApi[parentLane] : undefined;
      branchApi[laneName] = from ? g.branch(laneName, { from }) : g.branch(laneName);
    }
    const target = branchApi[laneName];
    const opts = { hash: c.hash, subject: c.subject, author: c.author };

    const isMerge = c.parents.length > 1;
    const otherParent = c.parents[1] ?? "";
    const otherLane = isMerge ? lanes[otherParent] : undefined;
    const canMerge =
      isMerge && otherLane && otherLane !== laneName && branchApi[otherLane] && laneLast[otherLane] === otherParent;

    if (canMerge) {
      target.merge(branchApi[otherLane], opts);
    } else {
      target.commit(opts);
    }
    laneLast[laneName] = c.hash;
    void byHash;
  }
}
