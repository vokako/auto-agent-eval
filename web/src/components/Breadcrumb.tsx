import { Link } from "react-router-dom";

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <div className="breadcrumb">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="sep">/</span>}
          {item.to ? <Link className="link" to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
        </span>
      ))}
    </div>
  );
}
