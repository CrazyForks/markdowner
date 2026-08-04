export async function waitForExportPreviewAssets(doc: Document): Promise<void> {
  const fonts = doc.fonts?.ready
    ? Promise.resolve(doc.fonts.ready).catch(() => undefined)
    : Promise.resolve();
  const images = Array.from(doc.images, (image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  });
  await Promise.all([fonts, ...images]);
}

export async function waitForExportPreviewLayout(
  frame: HTMLIFrameElement,
  doc: Document,
): Promise<void> {
  const maxFrames = 60;
  for (let frameIndex = 0; frameIndex < maxFrames; frameIndex += 1) {
    if (frame.clientWidth > 0 && frame.clientHeight > 0 && doc.documentElement.clientWidth > 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  throw new Error('Export preview did not receive a measurable layout.');
}
