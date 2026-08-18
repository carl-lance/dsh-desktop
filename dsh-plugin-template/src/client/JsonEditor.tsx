/**
 * Raw JSON editor: paste an array (or single object) of server configs,
 * validate, and hand the normalized rows back for saving.
 */

import { useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ServerRow } from "../shared/types";
import { parseConfig } from "./validate";
import type { Translate } from "./validate";

export function JsonEditor({ initialText, t, onSave, onCancel }: {
  initialText: string;
  t: Translate;
  onSave: (rows: ServerRow[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      onSave(parseConfig(text, t)); // throws a localized message on any problem
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mcp-catalog">
      <div className="mcp-editorBlock">
        <label className="mcp-hint">{t("json.label")}</label>
        <textarea
          className="mcp-editor"
          spellCheck={false}
          value={text}
          placeholder='[{ "serverName": "github", "transport": "stdio", "command": "npx" }]'
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mcp-hint">{t("json.hint")}</div>
        {error !== null && <div className="mcp-errorText" role="alert">{error}</div>}
      </div>
      <div className="mcp-actions">
        <Button variant="outline" size="sm" onClick={onCancel}>{t("cancel")}</Button>
        <Button variant="primary" size="sm" onClick={save}>{t("save")}</Button>
      </div>
    </div>
  );
}
