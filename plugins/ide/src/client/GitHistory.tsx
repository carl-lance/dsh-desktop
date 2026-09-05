/**
 * dsh-ide — commit history graph (Git panel "历史").
 *
 * Self-drawn virtualized rows, newest first. An SVG layer draws lane
 * lines/dots/merge curves once; only visible commit rows are mounted (up to
 * 1000 commits). Row interaction:
 *  - left click / 预览: detail modal (message, author, changed-file tree)
 *  - right click: 与当前对比 (file list + per-file diff vs HEAD), 回滚该提交
 *    (git revert, only for commits reachable from the current branch)
 * A "全部 / 当前" switch scopes the log.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { call, emitIdeBus } from "./ideApi";
import { ChangeTree, type ChangeLeaf } from "./ChangeTree";
import { Spinner } from "./Spinner";
import { maskStyle } from "./overlay";

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
  /** Bump to force a reload (e.g. after commits/checkouts). */
  refreshTick?: number;
}

interface CommitDetail {
  message: string;
  files: Array<{ xy: string; path: string }>;
}

const ROW_H = 22;
const LANE_W = 14;
const COUNT = 1000;
const LANE_COLORS = [
  "#0072B2", "#E69F00", "#009E73", "#D55E00",
  "#56B4E9", "#CC79A7", "#F0E442", "#000000",
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2",
  "#59A14F", "#EDC948", "#B07AA1", "#9C755F",
];

/** Unique color per lane column: a qualitative palette first, then
 *  golden-angle HSL, so different branches never share a color. */
function laneColor(col: number): string {
  if (col < LANE_COLORS.length) return LANE_COLORS[col];
  const hue = Math.round((col * 137.508) % 360);
  return `hsl(${hue} 58% 46%)`;
}

const REFRESH_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M13.8 8a5.8 5.8 0 1 1-1.7-4.1" />
    <path d="M13.8 1.8v3.1h-3.1" />
  </svg>
);

function fmtDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function codeLetter(xy: string): string {
  if (xy.startsWith("??")) return "?";
  const c = xy.charAt(0) === " " ? xy.charAt(1) : xy.charAt(0);
  return c || "?";
}

function diffStatusColor(s: string): string {
  switch (s) {
    case "A":
      return "#2ea043";
    case "M":
      return "#1a66d8";
    case "D":
      return "#d1242f";
    default:
      return "var(--dsw-alias-label-tertiary, #81858c)";
  }
}

/** hash → names of branches (and remote refs) whose tips can reach the commit.
 *  Decorations only name tips, so intermediate commits get their containing
 *  branches by walking parents down from each tip. */
function buildBranchMap(commits: GitCommitRow[]): Map<string, string[]> {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const out = new Map<string, string[]>();
  const tips: Array<{ name: string; hash: string }> = [];
  for (const c of commits) {
    if (!c.decorations) continue;
    for (const tok of c.decorations.split(", ")) {
      if (!tok || tok === "HEAD" || tok.startsWith("tag:")) continue;
      const name = tok.startsWith("HEAD -> ") ? `${tok.slice(8)}（当前）` : tok;
      if (name && !tips.some((t) => t.name === name)) tips.push({ name, hash: c.hash });
    }
  }
  const add = (h: string, name: string): void => {
    const list = out.get(h) ?? [];
    if (!list.includes(name)) list.push(name);
    out.set(h, list);
  };
  for (const tip of tips) {
    const seen = new Set<string>();
    const q = [tip.hash];
    while (q.length) {
      const h = q.shift() as string;
      if (seen.has(h)) continue;
      seen.add(h);
      add(h, tip.name);
      const c = byHash.get(h);
      if (!c) continue;
      for (const p of c.parents) if (byHash.has(p)) q.push(p);
    }
  }
  return out;
}

interface RowInfo {
  c: GitCommitRow;
  col: number;
  y: number;
  head: boolean;
}

interface RowModel {
  rows: RowInfo[];
  laneCanvas: number;
}

/**
 * Column assignment, newest first, classic git-graph style: the current
 * branch's first-parent spine stays in the leftmost column (col 0); forked
 * branches get new columns to the RIGHT as they appear; a lane only moves
 * left when it merges back / converges into the main line.
 */
function buildModel(commits: GitCommitRow[]): RowModel {
  const disp = commits.slice().reverse();
  // cols[i] = hash this column expects next while walking down (newer→older);
  // null = lane ended.
  const cols: Array<string | null> = [];
  const rows: RowInfo[] = [];
  let laneTotal = 0;
  disp.forEach((c, i) => {
    const hits: number[] = [];
    cols.forEach((h, idx) => {
      if (h === c.hash) hits.push(idx);
    });
    let lane: number;
    if (hits.length === 0) {
      // Top row = current branch → leftmost; any other unreferenced head → right.
      lane = i === 0 ? 0 : cols.length;
    } else {
      lane = hits[0];
      // Extra columns that reached the same commit end here (merge/converge).
      for (let k = hits.length - 1; k >= 1; k--) cols[hits[k]] = null;
    }
    if (lane >= cols.length) cols.length = lane + 1;
    rows.push({
      c,
      col: lane,
      y: i * ROW_H + ROW_H / 2,
      head: !!c.decorations && c.decorations.split(", ").some((t) => t === "HEAD" || t.startsWith("HEAD ->")),
    });
    const ps = c.parents;
    if (ps.length === 0) {
      cols[lane] = null;
    } else {
      cols[lane] = ps[0];
      for (let k = 1; k < ps.length; k++) {
        const p = ps[k];
        if (cols.indexOf(p) === -1) cols.push(p);
      }
    }
    laneTotal = Math.max(laneTotal, lane + 1);
  });
  return { rows, laneCanvas: 10 + laneTotal * LANE_W + 8 };
}

export function GitHistory({ root, refreshTick }: Props): ReactElement {
  const [commits, setCommits] = useState<GitCommitRow[] | null>(null);
  const [error, setError] = useState("");
  const [head, setHead] = useState("");
  const [scope, setScope] = useState<"all" | "head">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuQ, setMenuQ] = useState("");
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  const [branchNames, setBranchNames] = useState<string[]>([]);
  const [branchInput, setBranchInput] = useState("");
  const [branchSel, setBranchSel] = useState("");
  const [filterHint, setFilterHint] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const [viewW, setViewW] = useState(300);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [info, setInfo] = useState<GitCommitRow | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; c: GitCommitRow } | null>(null);
  const [revertFor, setRevertFor] = useState<GitCommitRow | null>(null);
  const [revertBusy, setRevertBusy] = useState("");
  const [revertMsg, setRevertMsg] = useState("");

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffHash, setDiffHash] = useState("");
  const [diffFiles, setDiffFiles] = useState<Array<{ path: string; status: string }> | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffSel, setDiffSel] = useState("");
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffDetailLoading, setDiffDetailLoading] = useState(false);
  const [diffErr, setDiffErr] = useState("");
  const armTimer = useRef<number | null>(null);

  async function load(): Promise<void> {
    setError("");
    const b = branchSel.trim();
    try {
      const r = (await call("git.log", { count: COUNT, scope: b ? "branch" : scope, branch: b || undefined })) as {
        commits: GitCommitRow[];
        head: string;
      };
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
  }, [root, refreshTick, scope, branchSel]);

  // Silent poll: catches commits made outside the IDE (terminal etc.) without
  // flicker — only swaps state when the head/count/first commit changed.
  useEffect(() => {
    if (!root) return;
    const b = branchSel.trim();
    const id = window.setInterval(async () => {
      try {
        const r = (await call("git.log", { count: COUNT, scope: b ? "branch" : scope, branch: b || undefined })) as {
          commits: GitCommitRow[];
          head: string;
        };
        setHead((h) => (h === r.head ? h : r.head));
        setCommits((prev) => {
          if (!prev) return r.commits;
          if (prev.length === r.commits.length && prev[0]?.hash === r.commits[0]?.hash) return prev;
          return r.commits;
        });
      } catch {
        /* transient git errors are ignored by the poll */
      }
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, scope, branchSel]);

  // Branch name suggestions for the filter input.
  useEffect(() => {
    if (!root) return;
    call("git.branches", { repo: root })
      .then((r) => {
        const rows = ((r as { branches?: Array<{ name: string }> }).branches ?? []) as Array<{ name: string }>;
        setBranchNames(rows.map((x) => x.name));
      })
      .catch(() => undefined);
  }, [root]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      setViewH(el.clientHeight || 400);
      setViewW(el.clientWidth || 300);
    }
  }, [commits]);

  // Close context menu / overlays / filter popup on Escape or outside click.
  useEffect(() => {
    if (!ctx && !revertFor && !info && !diffOpen && !filterOpen) return;
    const close = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (ctx && (!t || !(t as Element).closest?.("[data-ide-commit-ctx]"))) setCtx(null);
      if (filterOpen && (!t || (!(t as Element).closest?.("[data-ide-hist-filter-menu]") && !(t as Element).closest?.("[data-ide-hist-filter-trigger]")))) {
        setFilterOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setCtx(null);
        setRevertFor(null);
        setInfo(null);
        setDiffOpen(false);
        setFilterOpen(false);
      }
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ctx, revertFor, info, diffOpen, filterOpen]);

  // Workbench blocks contextmenu in capture phase for the whole shell, so a
  // button-level handler never fires — route commit rows here instead (this
  // window-capture listener runs after Workbench's, which already suppressed
  // the shell menu).
  useEffect(() => {
    if (!commits) return;
    const byHash = new Map(commits.map((c) => [c.hash, c]));
    const onContext = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      const el = t ? t.closest("[data-ide-commit-hash]") : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const c = byHash.get((el as HTMLElement).getAttribute("data-ide-commit-hash") ?? "");
      if (c) setCtx({ x: e.clientX, y: e.clientY, c });
    };
    window.addEventListener("contextmenu", onContext, true);
    return () => window.removeEventListener("contextmenu", onContext, true);
  }, [commits]);

  useEffect(
    () => () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    },
    []
  );

  const model = useMemo<RowModel | null>(() => (commits ? buildModel(commits) : null), [commits]);

  const branchNamesByHash = useMemo(() => (commits ? buildBranchMap(commits) : new Map<string, string[]>()), [commits]);

  /** Hashes reachable from HEAD (commits on the current branch). */
  const onHead = useMemo(() => {
    const set = new Set<string>();
    if (!commits) return set;
    const byHash = new Map(commits.map((c) => [c.hash, c]));
    const start = commits.find((c) => c.decorations && c.decorations.split(", ").some((t) => t === "HEAD" || t.startsWith("HEAD ->")))?.hash;
    if (!start) return set;
    const q = [start];
    const seen = new Set<string>();
    while (q.length) {
      const h = q.shift() as string;
      if (seen.has(h)) continue;
      seen.add(h);
      const c = byHash.get(h);
      if (!c) continue;
      set.add(h);
      for (const p of c.parents) if (byHash.has(p)) q.push(p);
    }
    return set;
  }, [commits]);

  const canRevert = (c: GitCommitRow): boolean => scope === "head" || onHead.has(c.hash);

  // ---- detail modal data ----
  useEffect(() => {
    if (!info) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    call("git.commitFiles", { repo: root, hash: info.hash })
      .then((r) => {
        if (alive) {
          setDetail(r as CommitDetail);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setDetail(null);
          setDetailLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [info, root]);

  const openInfo = (c: GitCommitRow): void => {
    setInfo(c);
    setRevertFor(null);
  };

  // ---- revert (from ctx menu confirm) ----
  const doRevert = async (): Promise<void> => {
    if (!revertFor) return;
    setRevertBusy("回滚");
    setRevertMsg("");
    try {
      await call("git.commitRevert", { repo: root, hash: revertFor.hash }, 120000);
      emitIdeBus("git.changed");
      setRevertFor(null);
      setCtx(null);
    } catch (err) {
      setRevertMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRevertBusy("");
    }
  };

  // ---- diff vs current HEAD (standalone overlay, per target hash) ----
  const loadDiffList = async (hash: string): Promise<void> => {
    setDiffLoading(true);
    setDiffErr("");
    setDiffFiles(null);
    try {
      const r = (await call("git.diffList", { repo: root, hash })) as { files: Array<{ path: string; status: string }> };
      setDiffFiles(r.files);
    } catch (err) {
      setDiffErr(err instanceof Error ? err.message : String(err));
      setDiffFiles([]);
    } finally {
      setDiffLoading(false);
    }
  };

  const openDiffFor = (c: GitCommitRow): void => {
    setCtx(null);
    setInfo(null);
    setDiffHash(c.hash);
    setDiffSel("");
    setDiffText(null);
    setDiffErr("");
    setDiffOpen(true);
    void loadDiffList(c.hash);
  };

  const pickDiffFile = async (path: string): Promise<void> => {
    if (!diffHash || path === diffSel) return;
    setDiffSel(path);
    setDiffText(null);
    setDiffErr("");
    setDiffDetailLoading(true);
    try {
      const r = (await call("git.diffDetail", { repo: root, hash: diffHash, path })) as { diff: string };
      setDiffText(r.diff);
    } catch (err) {
      setDiffErr(err instanceof Error ? err.message : String(err));
      setDiffText(null);
    } finally {
      setDiffDetailLoading(false);
    }
  };

  const branchShort = (n: string): string => (n.includes("/") ? n.slice(n.indexOf("/") + 1) : n);

  const applyBranch = (): void => {
    const v = branchInput.trim();
    if (!v) {
      setBranchSel("");
      setFilterHint("");
      return;
    }
    const low = v.toLowerCase();
    const hit =
      branchNames.find((n) => n.toLowerCase() === low) ?? branchNames.find((n) => branchShort(n).toLowerCase() === low);
    if (hit) {
      setBranchSel(hit);
      setBranchInput(hit);
      setFilterHint("");
    } else {
      setFilterHint(`未找到分支 “${v}”`);
      window.setTimeout(() => setFilterHint(""), 1600);
    }
  };

  const clearBranchFilter = (): void => {
    setBranchSel("");
    setBranchInput("");
    setFilterHint("");
  };

  const pickScope = (k: "all" | "head"): void => {
    clearBranchFilter();
    setScope(k);
    setFilterOpen(false);
  };

  const pickBranch = (n: string): void => {
    setBranchSel(n);
    setBranchInput(n);
    setFilterHint("");
    setFilterOpen(false);
  };

  const mq = menuQ.trim().toLowerCase();
  const menuBranches = mq
    ? branchNames.filter((n) => n.toLowerCase().includes(mq) || branchShort(n).toLowerCase().includes(mq))
    : branchNames;

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

  if (!commits || !model) {
    return <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载提交记录…</div>;
  }

  if (commits.length === 0) {
    return <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>暂无提交记录</div>;
  }

  const infoLeaves: ChangeLeaf[] = detail
    ? detail.files.map((f, i) => ({
        key: `${info?.hash ?? ""}_${i}`,
        code: codeLetter(f.xy),
        path: f.path.replace(/\\/g, "/").replace(/^"|"$/g, ""),
      }))
    : [];

  // SVG geometry over display rows (newest on top). Every commit draws edges
  // down to its parents: same-lane = vertical line (main spine stays col 0);
  // cross-lane = curve (fork to the right, left fold only when merging back).
  const svgParts: Array<{ kind: "line" | "path" | "dot" | "ring"; x1?: number; y1?: number; x2?: number; y2?: number; d?: string; color?: string; r?: number }> = [];
  {
    const rows = model.rows;
    const idxOf = new Map(rows.map((r, idx) => [r.c.hash, idx]));
    const cx = (col: number): number => 10 + col * LANE_W;
    rows.forEach((row) => {
      const x = cx(row.col);
      for (const p of row.c.parents) {
        const j = idxOf.get(p);
        if (j === undefined) continue;
        const prow = rows[j];
        if (prow.col === row.col) {
          svgParts.push({ kind: "line", x1: x, y1: row.y, x2: x, y2: prow.y, color: laneColor(row.col) });
        } else {
          const x2 = cx(prow.col);
          const ym = (row.y + prow.y) / 2;
          // The bend belongs to the side branch (the right-hand column): fork
          // arcs carry the new branch's color, merge arcs carry the merged
          // branch's color instead of the mainline's.
          const side = Math.max(row.col, prow.col);
          svgParts.push({ kind: "path", d: `M ${x} ${row.y} C ${x} ${ym}, ${x2} ${ym}, ${x2} ${prow.y}`, color: laneColor(side) });
        }
      }
      const color = laneColor(row.col);
      svgParts.push({ kind: "dot", x1: x, y1: row.y, color, r: 3 });
      if (row.head) svgParts.push({ kind: "ring", x1: x, y1: row.y, color, r: 6 });
    });
  }

  const contentH = model.rows.length * ROW_H;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const end = Math.min(model.rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 5);
  const visible = model.rows.slice(start, end);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 0",
          fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)", flex: "none",
        }}
      >
        <button
          ref={filterBtnRef}
          type="button"
          data-ide-hist-filter-trigger="1"
          title="切换历史范围：全部 / 当前分支 / 指定分支"
          onClick={() => {
            setFilterOpen((v) => !v);
            setMenuQ("");
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            fontSize: 12,
            border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
            background: filterOpen ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "var(--dsw-alias-bg-layer-1, #fafafa)",
            color: "var(--dsw-alias-label-primary, #0f1115)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="5" r="2.2" />
            <circle cx="18" cy="7" r="2.2" />
            <circle cx="6" cy="19" r="2.2" />
            <path d="M6 7.2v9.6" />
            <path d="M18 9.2a9 9 0 0 1-9 9" />
          </svg>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>
            {branchSel ? `分支 ${branchSel}` : scope === "head" ? "当前" : "全部"}
          </span>
          <span style={{ color: "var(--dsw-alias-label-tertiary, #81858c)", fontSize: 10 }}>▾</span>
        </button>
        <button
          type="button"
          title="刷新"
          onClick={() => void load()}
          style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "inherit", display: "inline-flex", padding: 2 }}
        >
          {REFRESH_ICON}
        </button>
        {filterHint && <span style={{ fontSize: 11, color: "var(--dsw-alias-danger, #c43c2d)", flex: "none" }}>{filterHint}</span>}
      </div>

      {/* hint meta line under the branch selector */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px 4px",
          fontSize: 10.5,
          lineHeight: 1,
          color: "var(--dsw-alias-label-tertiary, #81858c)",
          flex: "none",
          userSelect: "none",
        }}
      >
        {head && <span style={{ fontFamily: "var(--ds-font-family-mono, Consolas, monospace)" }}>HEAD {head}</span>}
        {head && <span>·</span>}
        <span>
          {commits.length} 条{commits.length === COUNT ? "（已达上限）" : ""}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
          if (el.clientHeight !== viewH) setViewH(el.clientHeight);
          if (el.clientWidth !== viewW) setViewW(el.clientWidth);
        }}
        style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}
      >
        <div style={{ position: "relative", height: contentH, width: Math.max(model.laneCanvas, viewW), minWidth: "100%" }}>
          <svg
            width={Math.max(model.laneCanvas, viewW)}
            height={contentH}
            style={{ position: "absolute", left: 0, top: 0, display: "block", pointerEvents: "none" }}
          >
            {svgParts.map((p, i) => {
              const color = p.color ?? "#888";
              if (p.kind === "line") {
                return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={color} strokeWidth="1.2" opacity="0.9" />;
              }
              if (p.kind === "path") {
                return <path key={i} d={p.d} fill="none" stroke={color} strokeWidth="1.2" opacity="0.9" />;
              }
              if (p.kind === "dot") {
                return <circle key={i} cx={p.x1} cy={p.y1} r={p.r ?? 3} fill={color} stroke="#fff" strokeWidth="1" />;
              }
              return <circle key={i} cx={p.x1} cy={p.y1} r={p.r ?? 6} fill="none" stroke={color} strokeWidth="1.6" opacity="0.8" />;
            })}
          </svg>

          {visible.map((row) => (
            <button
              key={row.c.hash}
              type="button"
              data-ide-commit-hash={row.c.hash}
              onClick={() => openInfo(row.c)}
              title={(() => {
                const names = branchNamesByHash.get(row.c.hash) ?? [];
                const cap = names.length > 4 ? `${names.slice(0, 4).join(" · ")} 等 ${names.length} 个` : names.join(" · ");
                return [
                  row.c.subject,
                  cap,
                  `${row.c.author} · ${fmtDate(row.c.ts)}`,
                  "左键预览 · 右键 与当前对比/回滚",
                ]
                  .filter((s) => s !== "")
                  .join("\n");
              })()}
              style={{
                position: "absolute",
                left: model.laneCanvas,
                right: 0,
                top: row.y - ROW_H / 2,
                height: ROW_H,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 8px 0 4px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                overflow: "hidden",
              }}
            >
              <span style={{ fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #81858c)", flex: "none" }}>
                {row.c.hash.slice(0, 7)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 11.5,
                  color: row.head ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-secondary, #61666b)",
                  fontWeight: row.head ? 600 : 400,
                }}
              >
                {row.c.subject}
              </span>
              {row.head && <span style={{ flex: "none", fontSize: 10, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>HEAD</span>}
            </button>
          ))}
        </div>
      </div>

      {/* history scope filter popup */}
      {filterOpen &&
        filterBtnRef.current &&
        (() => {
          const rect = filterBtnRef.current!.getBoundingClientRect();
          return (
            <div
              data-ide-hist-filter-menu="1"
              style={{
                position: "fixed",
                left: Math.min(rect.left, window.innerWidth - 256),
                top: Math.min(rect.bottom + 6, window.innerHeight - 320),
                zIndex: 300,
                width: 244,
                maxHeight: 300,
                padding: 4,
                borderRadius: 10,
                border: "1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,.08))",
                background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
                boxShadow: "0 10px 28px rgba(0,0,0,.16)",
                display: "flex",
                flexDirection: "column",
                color: "var(--dsw-alias-label-primary, #0f1115)",
              }}
            >
              {(
                [
                  { k: "all", label: "全部（所有分支）" },
                  { k: "head", label: "当前分支" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => pickScope(opt.k)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    textAlign: "left",
                    padding: "5px 10px",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    background: !branchSel && scope === opt.k ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
                    color: "var(--dsw-alias-label-primary, #0f1115)",
                  }}
                >
                  {opt.label}
                  {!branchSel && scope === opt.k ? <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span> : null}
                </button>
              ))}
              <div style={{ height: 1, background: "var(--dsw-alias-border-l1, rgba(0,0,0,.06))", margin: "2px 6px 4px", flex: "none" }} />
              <input
                value={menuQ}
                onChange={(e) => setMenuQ(e.target.value)}
                placeholder={`搜索分支…（${branchNames.length}）`}
                aria-label="搜索分支"
                style={{
                  boxSizing: "border-box",
                  width: "calc(100% - 8px)",
                  margin: "0 4px 4px",
                  padding: "4px 8px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
                  background: "var(--dsw-alias-bg-base, #fff)",
                  color: "var(--dsw-alias-label-primary, #0f1115)",
                  flex: "none",
                }}
              />
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {menuBranches.length === 0 ? (
                  <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                    {branchNames.length === 0 ? "加载分支…" : "没有匹配的分支"}
                  </div>
                ) : (
                  menuBranches.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => pickBranch(n)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        textAlign: "left",
                        padding: "5px 10px",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12.5,
                        fontFamily: "inherit",
                        background: branchSel === n ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
                        color: "var(--dsw-alias-label-primary, #0f1115)",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
                      {branchSel === n ? <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span> : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })()}

      {/* row context menu */}
      {ctx && (
        <div
          data-ide-commit-ctx="1"
          style={{
            position: "fixed",
            left: Math.min(ctx.x, window.innerWidth - 200),
            top: Math.min(ctx.y, window.innerHeight - 150),
            zIndex: 465,
            minWidth: 172,
            padding: 4,
            borderRadius: 10,
            border: "1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,.08))",
            background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
            boxShadow: "0 10px 28px rgba(0,0,0,.16)",
            fontSize: 13,
            color: "var(--dsw-alias-label-primary, #0f1115)",
          }}
        >
          <div style={{ padding: "4px 10px 6px", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ctx.c.hash.slice(0, 8)} · {ctx.c.subject}
          </div>
          {(
            [
              { label: "提交详情", fn: () => openInfo(ctx.c), danger: false },
              { label: "与当前对比", fn: () => openDiffFor(ctx.c), danger: false },
              { label: "回滚该提交", fn: () => { setRevertFor(ctx.c); setCtx(null); }, danger: true, disabled: !canRevert(ctx.c) },
            ]
          ).map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              title={it.disabled ? "不在当前分支历史中" : undefined}
              onClick={() => {
                setCtx(null);
                it.fn();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                cursor: it.disabled ? "not-allowed" : "pointer",
                fontSize: 13,
                opacity: it.disabled ? 0.45 : 1,
                background: "transparent",
                color: it.danger ? "var(--dsw-alias-danger, #c43c2d)" : "var(--dsw-alias-label-primary, #0f1115)",
              }}
              onMouseEnter={(e) => {
                if (!it.disabled) e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}

      {/* revert confirm */}
      {revertFor && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRevertFor(null);
          }}
          style={maskStyle(485)}
        >
          <div style={{ width: 420, maxWidth: "92vw", padding: 16, borderRadius: 12, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 16px 48px rgba(0,0,0,.18)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>回滚该提交</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary, #61666b)", wordBreak: "break-all" }}>
              对提交 <b>{revertFor.hash.slice(0, 8)}</b>（{revertFor.subject}）执行 git revert——会生成一条<b>反向提交</b>撤销其改动（不改写历史）。需要干净的工作区。
            </div>
            {revertMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--dsw-alias-danger, #c43c2d)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{revertMsg}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setRevertFor(null)} style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                取消
              </button>
              <button
                type="button"
                disabled={revertBusy === "回滚"}
                onClick={() => void doRevert()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 18px", fontSize: 12.5, cursor: revertBusy === "回滚" ? "not-allowed" : "pointer", border: "1px solid var(--dsw-alias-border-danger, rgba(196,60,45,.35))", borderRadius: 8, background: "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))", color: "var(--dsw-alias-danger, #c43c2d)", opacity: revertBusy === "回滚" ? 0.6 : 1 }}
              >
                {revertBusy === "回滚" ? <Spinner size={12} /> : null}
                {revertBusy === "回滚" ? "回滚中…" : "确认回滚"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* detail modal */}
      {info && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setInfo(null);
          }}
          style={maskStyle(470)}
        >
          <div style={{ width: 580, maxWidth: "94vw", height: 560, maxHeight: "86vh", display: "flex", flexDirection: "column", padding: 14, borderRadius: 14, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 18px 56px rgba(0,0,0,.2)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flex: "none" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>提交详情</span>
              <span style={{ fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{info.hash.slice(0, 10)}…</span>
              {!canRevert(info) && <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>· 不在当前分支上</span>}
              <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => openDiffFor(info)}
                  style={{ padding: "3px 10px", fontSize: 12, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 7, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)", fontFamily: "inherit" }}
                >
                  与当前对比
                </button>
                <button type="button" aria-label="关闭" onClick={() => setInfo(null)} style={{ width: 26, height: 26, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent", color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: 15, lineHeight: 1 }}>
                  ✕
                </button>
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, flex: "none", wordBreak: "break-word" }}>{info.subject}</div>
            <div style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)", margin: "2px 0 8px", flex: "none" }}>
              {info.author} · {fmtDate(info.ts)}
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", maxHeight: 150, border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 10, overflow: "hidden", flex: "0 0 auto" }}>
                <div style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>提交说明</div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px", fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                  {detailLoading ? <Spinner size={12} /> : detail?.message || "（加载失败或无说明）"}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
                  改动文件{detail && !detailLoading ? `（${detail.files.length}）` : ""}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "3px 0" }}>
                  {detailLoading ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载文件…</div>
                  ) : infoLeaves.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>（无文件改动）</div>
                  ) : (
                    <ChangeTree leaves={infoLeaves} />
                  )}
                </div>
              </div>
            </div>

            <div style={{ flex: "none", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button type="button" onClick={() => setInfo(null)} style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                关闭
              </button>
              {canRevert(info) && (
                <button
                  type="button"
                  onClick={() => {
                    setRevertFor(info);
                    setInfo(null);
                  }}
                  style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-danger, rgba(196,60,45,.35))", borderRadius: 8, background: "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))", color: "var(--dsw-alias-danger, #c43c2d)" }}
                >
                  回滚该提交
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* diff vs current overlay */}
      {diffOpen && diffHash && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDiffOpen(false);
          }}
          style={maskStyle(480)}
        >
          <div style={{ width: 820, maxWidth: "96vw", height: 640, maxHeight: "90vh", display: "flex", flexDirection: "column", padding: 14, borderRadius: 14, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 18px 56px rgba(0,0,0,.2)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flex: "none" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>与当前对比</span>
              <span style={{ fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                {diffHash.slice(0, 10)}… ↔ HEAD
              </span>
              <button type="button" aria-label="关闭" onClick={() => setDiffOpen(false)} style={{ marginLeft: "auto", width: 26, height: 26, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent", color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: 15, lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #81858c)", marginBottom: 8, flex: "none" }}>
              方向：该提交 → 当前 HEAD。点左侧文件查看行级差异（+ 新增 / − 删除）。
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 10 }}>
              <div style={{ width: 270, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
                  差异文件{diffFiles ? `（${diffFiles.length}）` : ""}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "3px 0" }}>
                  {diffLoading ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载差异…</div>
                  ) : diffFiles === null ? null : diffFiles.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>{diffErr || "该提交与当前 HEAD 没有文件差异。"}</div>
                  ) : (
                    diffFiles.map((f) => {
                      const active = f.path === diffSel;
                      return (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => void pickDiffFile(f.path)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            width: "100%",
                            textAlign: "left",
                            padding: "4px 10px",
                            border: "none",
                            background: active ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <span style={{ flex: "none", width: 12, fontSize: 11, fontWeight: 700, color: diffStatusColor(f.status) }}>{f.status}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--dsw-alias-label-primary, #0f1115)" }}>{f.path.replace(/\\/g, "/")}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {diffSel ? diffSel.replace(/\\/g, "/") : "选择左侧文件查看差异"}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", fontSize: 11, lineHeight: 1.55, padding: "4px 0" }}>
                  {diffDetailLoading ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 12, fontFamily: "inherit", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                      <Spinner size={12} /> 加载行差异…
                    </div>
                  ) : diffErr && diffSel ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-danger, #c43c2d)", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{diffErr}</div>
                  ) : diffText === null ? null : diffText.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)", fontFamily: "inherit" }}>（无差异）</div>
                  ) : (
                    diffText.split("\n").map((l, i) => {
                      const ch = l.charAt(0);
                      const add = ch === "+" && !l.startsWith("+++");
                      const del = ch === "-" && !l.startsWith("---");
                      const hunk = ch === "@";
                      return (
                        <div
                          key={i}
                          style={{
                            whiteSpace: "pre",
                            minWidth: "100%",
                            color: add ? "#1a7f37" : del ? "#cf222e" : hunk ? "#1a66d8" : "var(--dsw-alias-label-primary, #0f1115)",
                            background: add ? "rgba(46,160,67,.07)" : del ? "rgba(209,36,47,.07)" : hunk ? "rgba(26,102,216,.06)" : "transparent",
                          }}
                        >
                          {l || " "}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, flex: "none" }}>
              <button type="button" onClick={() => setDiffOpen(false)} style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

