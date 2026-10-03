export function markers(text: string) {
  return [...text.matchAll(/\[Image #([1-9]\d{0,8})\]/g)].map(match => ({
    id: match[1]!, start: match.index!, end: match.index! + match[0].length,
  }));
}

export function selectedImage(text: string, cursor: number): string | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  const matches = markers(text);
  return (matches.find(match => cursor >= match.start && cursor < match.end)
    ?? matches.find(match => cursor === match.end))?.id ?? null;
}

export function fitImage(width: number, height: number, columns: number, rows: number) {
  const maxColumns = Math.max(1, Math.min(255, Math.floor(columns)));
  const maxRows = Math.max(1, Math.min(255, Math.floor(rows)));
  // Terminal cells are approximately twice as tall as they are wide.
  const scale = Math.min(maxColumns / width, maxRows * 2 / height);
  return {
    columns: Math.max(1, Math.floor(width * scale)),
    rows: Math.max(1, Math.floor(height * scale / 2)),
  };
}
