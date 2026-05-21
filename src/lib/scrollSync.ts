export function syncScrollPosition(source: HTMLElement, target: HTMLElement | null): void {
  if (!target) return;

  const sourceMax = source.scrollHeight - source.clientHeight;
  const targetMax = target.scrollHeight - target.clientHeight;
  const nextScrollTop =
    sourceMax > 0 && targetMax > 0 ? Math.round((source.scrollTop / sourceMax) * targetMax) : 0;

  if (target.scrollTop !== nextScrollTop) {
    target.scrollTop = nextScrollTop;
  }
}
