export function AdapterTag({ adapter, version }: { adapter: string; version?: string }) {
  return (
    <>
      <span className={`adapter-tag ${adapter}`}>{adapter}</span>
      {version && <span className="ver-tag">v{version}</span>}
    </>
  );
}
