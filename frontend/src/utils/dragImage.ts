/**
 * Replaces Chromium's translucent DOM snapshot with a small, stable drag chip.
 * The chip is removed after the browser has captured it for the drag session.
 */
export function setCodeCourseDragImage(dataTransfer: DataTransfer, label: string) {
  const image = document.createElement("div");
  image.className = "codecourse-drag-image";
  image.textContent = label;
  document.body.appendChild(image);
  dataTransfer.setDragImage(image, 18, 18);
  window.requestAnimationFrame(() => image.remove());
}
