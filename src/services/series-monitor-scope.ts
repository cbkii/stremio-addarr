import type { AppConfig } from '../config.js';
import type { StatusTile } from '../types.js';

type SeriesMonitorMode = AppConfig['sonarr']['seriesMonitor'];
type SeriesMonitorDisplayConfig = Pick<
  AppConfig['sonarr'],
  'seriesMonitor' | 'monitorNewItems' | 'epCount' | 'epCountPast' | 'epCountMod'
>;

const MONITOR_SCOPE_LABELS: Record<SeriesMonitorMode, string> = {
  all: 'all eps',
  future: 'future eps',
  missing: 'missing eps',
  existing: 'existing eps',
  firstSeason: 'first season',
  lastSeason: 'last season',
  latestSeason: 'latest season',
  pilot: 'pilot only',
  recent: 'recent eps',
  monitorSpecials: 'include specials',
  unmonitorSpecials: 'exclude specials',
  none: 'no eps',
  skip: 'leave unchanged',
  ep: 'this',
  epfuture: '+future',
  epseason: 'this to season end'
};

function epAutoUpgradeLabel(config: SeriesMonitorDisplayConfig): string | undefined {
  if (config.seriesMonitor !== 'ep' || config.epCount <= 1) return undefined;
  const target = config.epCountMod === 'epfuture' ? '+future' : 'season end';
  return `(⥸${config.epCount} / ⎗${config.epCountPast} = ${target})`;
}

function monitorNewItemsLabel(config: SeriesMonitorDisplayConfig): string {
  if (config.monitorNewItems === 'all') return '✅new';
  if (config.monitorNewItems === 'none') return '❌new';

  if (config.seriesMonitor === 'epfuture') return '✅new';
  if (config.seriesMonitor === 'epseason') return '❌new';
  if (config.seriesMonitor === 'ep') {
    return config.epCount > 1 && config.epCountMod === 'epfuture'
      ? '❌new→✅new'
      : '❌new';
  }

  return '✅new';
}

export function seriesMonitorScopeLabels(config: SeriesMonitorDisplayConfig): string[] {
  return [
    MONITOR_SCOPE_LABELS[config.seriesMonitor],
    epAutoUpgradeLabel(config),
    monitorNewItemsLabel(config)
  ].filter((label): label is string => Boolean(label));
}

export function seriesMonitorScopeLine(config: SeriesMonitorDisplayConfig): string {
  return `📡: ${seriesMonitorScopeLabels(config).join(' ')}`;
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
