import type { AppConfig } from '../config.js';
import type { StatusTile } from '../types.js';

type SeriesMonitorMode = AppConfig['sonarr']['seriesMonitor'];
type SeriesMonitorDisplayConfig = Pick<
  AppConfig['sonarr'],
  'seriesMonitor' | 'monitorNewItems' | 'epCount' | 'epCountPast' | 'epCountMod'
>;

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
  ep: 'this episode',
  epfuture: 'this + future episodes',
  epseason: 'this episode to season end'
};

function epAutoUpgradeLabel(config: SeriesMonitorDisplayConfig): string | undefined {
  if (config.seriesMonitor !== 'ep' || config.epCount <= 1) return undefined;
  const target = config.epCountMod === 'epfuture' ? 'this + future' : 'season end';
  return `≥${config.epCount} files in prior ${config.epCountPast} → ${target}`;
}

export function seriesMonitorScopeLabels(config: SeriesMonitorDisplayConfig): string[] {
  return [
    MONITOR_SCOPE_LABELS[config.seriesMonitor],
    epAutoUpgradeLabel(config),
    `new: ${config.monitorNewItems}`
  ].filter((label): label is string => Boolean(label));
}

export function seriesMonitorScopeLine(config: SeriesMonitorDisplayConfig): string {
  return `📡: ${seriesMonitorScopeLabels(config).join(' · ')}`;
}

export function addSeriesMonitorScopeToActionTiles(
  tiles: StatusTile[],
  config: SeriesMonitorDisplayConfig
): StatusTile[] {
  const scopeLine = seriesMonitorScopeLine(config);
  return tiles.map((tile) => {
    if (!tile.isAction || !tile.description) return tile;

    const lines = tile.description.split('\n');
    if (lines.includes(scopeLine)) return tile;

    const actionLineIndex = lines.findIndex((line) => line.startsWith('🗯️'));
    lines.splice(actionLineIndex >= 0 ? actionLineIndex : lines.length, 0, scopeLine);
    return { ...tile, description: lines.join('\n') };
  });
}
