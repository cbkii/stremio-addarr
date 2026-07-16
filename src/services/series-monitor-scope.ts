import type { AppConfig } from '../config.js';
import type { StatusTile } from '../types.js';

type SeriesMonitorMode = AppConfig['sonarr']['seriesMonitor'];

const MONITOR_SCOPE_LABELS: Record<SeriesMonitorMode, string> = {
  all: 'all episodes',
  future: 'future episodes',
  missing: 'missing episodes',
  existing: 'existing episodes',
  firstSeason: 'first season',
  lastSeason: 'last season',
  latestSeason: 'latest season',
  pilot: 'pilot only',
  recent: 'recent episodes',
  monitorSpecials: 'include specials',
  unmonitorSpecials: 'exclude specials',
  none: 'no episodes',
  skip: 'leave unchanged',
  ep: 'this episode only',
  epfuture: 'this + future episodes',
  epseason: 'this episode to season end'
};

export function seriesMonitorScopeLine(mode: SeriesMonitorMode): string {
  return `📡 Monitor scope: ${MONITOR_SCOPE_LABELS[mode]}`;
}

export function addSeriesMonitorScopeToActionTiles(
  tiles: StatusTile[],
  mode: SeriesMonitorMode
): StatusTile[] {
  const scopeLine = seriesMonitorScopeLine(mode);
  return tiles.map((tile) => {
    if (!tile.isAction || !tile.description) return tile;

    const lines = tile.description.split('\n');
    if (lines.includes(scopeLine)) return tile;

    const actionLineIndex = lines.findIndex((line) => line.startsWith('🗯️'));
    lines.splice(actionLineIndex >= 0 ? actionLineIndex : lines.length, 0, scopeLine);
    return { ...tile, description: lines.join('\n') };
  });
}
