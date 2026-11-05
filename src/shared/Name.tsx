/**
 * A name that keeps its end when it does not fit: `lane_backend_fe…ature_12`. Lanes often differ
 * only at the end. The full name is the title; screen readers get it whole too (the two visible
 * halves are flex items, which Chrome would read as two words).
 */
export function Name({ text, className = '' }: { text: string; className?: string }) {
  const tail = text.length > 12 ? text.slice(-8) : '';
  if (!tail) {
    return (
      <span title={text} className={`truncate ${className}`}>
        {text}
      </span>
    );
  }
  return (
    <span title={text} className={`flex min-w-0 ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="overflow-hidden text-ellipsis whitespace-pre">
        {text.slice(0, -8)}
      </span>
      <span aria-hidden="true" className="shrink-0 whitespace-pre">
        {tail}
      </span>
    </span>
  );
}
