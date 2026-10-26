interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface Area { position: Point; size: Size }
export interface DragMonitor extends Area { workArea: Area; scaleFactor: number }

export function clampPetDragPosition(position: Point, windowSize: Size, monitors: DragMonitor[], cursor?: Point): Point {
  if (monitors.length === 0) return position;
  const center = cursor ?? { x: position.x + windowSize.width / 2, y: position.y + windowSize.height / 2 };
  const distance = (monitor: DragMonitor) => {
    const dx = Math.max(monitor.position.x - center.x, 0, center.x - monitor.position.x - monitor.size.width);
    const dy = Math.max(monitor.position.y - center.y, 0, center.y - monitor.position.y - monitor.size.height);
    return dx * dx + dy * dy;
  };
  const monitor = monitors.reduce((closest, candidate) => distance(candidate) < distance(closest) ? candidate : closest);
  const area = monitor.workArea;
  const minY = Math.max(area.position.y, monitor.position.y + Math.ceil(48 * monitor.scaleFactor));
  const maxY = Math.max(minY, area.position.y + area.size.height - windowSize.height);
  const y = Math.min(Math.max(position.y, minY), maxY);
  const eligible = monitors.filter((item) => y < item.workArea.position.y + item.workArea.size.height && y + windowSize.height > item.workArea.position.y);
  const intervals = (eligible.length ? eligible : [monitor])
    .map((item) => ({ start: item.workArea.position.x, end: item.workArea.position.x + item.workArea.size.width }))
    .sort((a, b) => a.start - b.start);
  const merged = intervals.reduce<{ start: number; end: number }[]>((groups, interval) => {
    const last = groups[groups.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else groups.push({ ...interval });
    return groups;
  }, []);
  const selected = merged.find((item) => item.start <= area.position.x && item.end >= area.position.x + area.size.width) ?? merged[0];
  const maxX = Math.max(selected.start, selected.end - windowSize.width);
  return {
    x: Math.min(Math.max(position.x, selected.start), maxX),
    y,
  };
}
