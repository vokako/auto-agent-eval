import { useState } from "react";

export function JsonView({ data }: { data: unknown }) {
  return <div className="json-view"><JsonNode value={data} depth={0} defaultOpen /></div>;
}

function JsonNode({ name, value, depth, defaultOpen }: { name?: string; value: unknown; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || depth < 2);

  if (value === null) return <Line name={name}><span className="jv-null">null</span></Line>;
  if (typeof value === "boolean") return <Line name={name}><span className="jv-bool">{String(value)}</span></Line>;
  if (typeof value === "number") return <Line name={name}><span className="jv-num">{value}</span></Line>;
  if (typeof value === "string") {
    if (value.length > 200) {
      return <Line name={name}><span className="jv-str">"{value.slice(0, 200)}…"</span></Line>;
    }
    return <Line name={name}><span className="jv-str">"{value}"</span></Line>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <Line name={name}><span className="jv-bracket">[]</span></Line>;
    return (
      <div className="jv-node">
        <div className="jv-toggle" onClick={() => setOpen(!open)}>
          <span className={`jv-arrow ${open ? "open" : ""}`}>▶</span>
          {name !== undefined && <span className="jv-key">{name}: </span>}
          {!open && <span className="jv-preview">[{value.length} items]</span>}
        </div>
        {open && (
          <div className="jv-children">
            {value.map((item, i) => <JsonNode key={i} name={String(i)} value={item} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <Line name={name}><span className="jv-bracket">{"{}"}</span></Line>;
    return (
      <div className="jv-node">
        <div className="jv-toggle" onClick={() => setOpen(!open)}>
          <span className={`jv-arrow ${open ? "open" : ""}`}>▶</span>
          {name !== undefined && <span className="jv-key">{name}: </span>}
          {!open && <span className="jv-preview">{`{${entries.length} keys}`}</span>}
        </div>
        {open && (
          <div className="jv-children">
            {entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  return <Line name={name}><span>{String(value)}</span></Line>;
}

function Line({ name, children }: { name?: string; children: React.ReactNode }) {
  return (
    <div className="jv-line">
      {name !== undefined && <span className="jv-key">{name}: </span>}
      {children}
    </div>
  );
}
