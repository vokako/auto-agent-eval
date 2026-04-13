export function ResultBar({ pass, fail, error }: { pass: number; fail: number; error: number }) {
  const total = pass + fail + error || 1;
  return (
    <div className="result-bar">
      <div className="bar-pass" style={{ width: `${pass / total * 100}%` }} />
      <div className="bar-fail" style={{ width: `${fail / total * 100}%` }} />
      <div className="bar-err" style={{ width: `${error / total * 100}%` }} />
    </div>
  );
}
