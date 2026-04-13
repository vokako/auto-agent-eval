export function TabSection({ title, content, defaultOpen }: { title: string; content: string; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen}>
      <summary>{title}</summary>
      <pre className="log-content">{content || "—"}</pre>
    </details>
  );
}
