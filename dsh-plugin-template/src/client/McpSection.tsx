/**
 * The settings section: card grid of servers plus the JSON editor for
 * add/edit. State flows through the settings scope; the host half mounts
 * rows into live mcp-client instances.
 */

import { useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ServerRow } from "../shared/types";
import { JsonEditor } from "./JsonEditor";
import { ServerCard } from "./ServerCard";
import type { Translate } from "./validate";

export interface SectionContext {
  controller: { set(field: string, value: unknown): void };
  useSnapshot: (selector: (state: any) => any) => any;
  t: Translate;
}

export function McpSection({ controller, useSnapshot, t }: SectionContext) {
  const snapshot = useSnapshot((state: any) => state);
  const [editing, setEditing] = useState<{ id: string | undefined } | null>(null);

  if (snapshot.status === "loading") {
    return <div className="mcp-section"><p className="mcp-status">{t("loading")}</p></div>;
  }
  if (snapshot.status !== "ready") {
    return <div className="mcp-section"><p className="mcp-status">{t("unavailable")}</p></div>;
  }

  const servers: ServerRow[] = snapshot.value?.servers ?? [];
  const runtimeStatus: Record<string, { state: string; error?: string }> = snapshot.value?.runtimeStatus ?? {};

  const saveRows = (rows: ServerRow[]) => {
    controller.set("servers", rows); // JSON is the source of truth: wholesale replace
    setEditing(null);
  };
  const removeServer = (server: ServerRow) => {
    controller.set("servers", servers.filter((candidate) => candidate.id !== server.id));
  };

  const editingServer = editing !== null && editing.id !== undefined
    ? servers.find((server) => server.id === editing.id)
    : undefined;
  const initialJson = editingServer === undefined ? "" : JSON.stringify(editingServer, null, 2);

  return (
    <div className="mcp-section">
      <div className="mcp-toolbar">
        <Button variant="outline" size="sm" onClick={() => setEditing({ id: undefined })}>{t("add")}</Button>
      </div>

      {editing !== null ? (
        <JsonEditor
          key={editing.id ?? "new"}
          initialText={initialJson}
          t={t}
          onSave={saveRows}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="mcp-heading">
            <h3>{t("catalog")}</h3>
            <span>{servers.length}</span>
          </div>
          {servers.length === 0 ? (
            <p className="mcp-status">{t("empty")}</p>
          ) : (
            <ul className="mcp-cards">
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  status={runtimeStatus[server.id] as any}
                  t={t}
                  onEdit={() => setEditing({ id: server.id })}
                  onRemove={() => removeServer(server)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
