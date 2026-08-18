/**
 * One server card: expandable row in the plugin-inventory style, showing the
 * serverName, a mount-status dot, the transport tag, and (when expanded) the
 * full JSON plus edit/delete actions.
 */

import { useState } from "react";
import { Button, IconChevronDownOutline14, IconEditOutline16, IconTrashOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ServerRow, RuntimeStatus } from "../shared/types";
import type { Translate } from "./validate";

export function ServerCard({ server, status, t, onEdit, onRemove }: {
  server: ServerRow;
  status: RuntimeStatus | undefined;
  t: Translate;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const badge = status === undefined
    ? { label: t("status.unknown"), phase: undefined as string | undefined }
    : status.state === "mounted"
      ? { label: t("status.mounted"), phase: "active" }
      : status.state === "error"
        ? { label: t("status.error"), phase: "failed" }
        : { label: t("status.unknown"), phase: undefined };

  return (
    <li className="mcp-card" data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="mcp-cardContent"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong className="mcp-cardTitle" title={server.serverName}>{server.serverName}</strong>
        <span className="mcp-cardTrailing">
          {badge.phase !== undefined && (
            <span className="mcp-statusDot" data-phase={badge.phase} role="img" title={badge.label} />
          )}
          <span className="mcp-tag">{server.transport}</span>
          <IconChevronDownOutline14 className="mcp-chevron" size={12} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="mcp-cardDetails">
          <code className="mcp-entryValue">{JSON.stringify(server, null, 2)}</code>
          {confirming && (
            <div className="mcp-hint" style={{ marginTop: 8 }}>
              {t("delete.confirm").replace("{name}", server.serverName)}
            </div>
          )}
          <div className="mcp-actions">
            {confirming ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>{t("cancel")}</Button>
                <Button variant="primary" size="sm" onClick={onRemove}>{t("delete")}</Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <IconEditOutline16 size={14} /> {t("edit")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  <IconTrashOutline16 size={14} />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
