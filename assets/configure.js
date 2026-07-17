const shell = document.querySelector('.shell');
const authPanel = document.querySelector('#auth-panel');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#login-form');
const authMessage = document.querySelector('#auth-message');
const configForm = document.querySelector('#config-form');
const saveBanner = document.querySelector('#save-banner');
let csrf = '';
let currentConfig = null;

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing configuration element: ${id}`);
  return element;
}

function setMessage(target, text, state = '') {
  target.textContent = text;
  target.dataset.state = state;
}

async function request(url, options = {}) {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (method !== 'GET' && csrf) headers.set('x-csrf-token', csrf);
  const response = await fetch(url, { ...options, method, headers });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(body?.error || `Request failed with HTTP ${response.status}`);
  return body;
}

function option(select, value, label) {
  const stringValue = String(value);
  let existing = [...select.options].find((item) => item.value === stringValue);
  if (!existing) {
    existing = document.createElement('option');
    existing.value = stringValue;
    select.append(existing);
  }
  existing.textContent = label;
  return existing;
}

function selectValue(id, value, fallbackLabel) {
  const select = byId(id);
  option(select, value ?? '', fallbackLabel || String(value ?? ''));
  select.value = String(value ?? '');
}

function populate(config) {
  currentConfig = config;
  const { catalog, radarr, sonarr, playback, trakt, tmdb } = config;

  byId('catalog-page-size').value = catalog.pageSize;
  byId('catalog-watched-keep').value = catalog.watchedKeepCount;

  byId('radarr-enabled').checked = radarr.enabled;
  byId('radarr-url').value = radarr.baseUrl;
  byId('radarr-card-url').value = radarr.cardUrl || '';
  byId('radarr-key').value = '';
  byId('radarr-key-state').textContent = radarr.apiKeyConfigured ? 'configured' : 'not configured';
  selectValue('radarr-root', radarr.rootFolderPath, radarr.rootFolderPath || 'Test connection to discover');
  selectValue('radarr-profile', radarr.qualityProfileId, `Profile ${radarr.qualityProfileId}`);
  byId('radarr-minimum').value = radarr.minimumAvailability;
  byId('radarr-tags').value = radarr.tags;
  byId('radarr-search').checked = radarr.searchOnAdd;
  byId('radarr-strict').checked = radarr.strictImdbMatch;

  byId('sonarr-enabled').checked = sonarr.enabled;
  byId('sonarr-url').value = sonarr.baseUrl;
  byId('sonarr-card-url').value = sonarr.cardUrl || '';
  byId('sonarr-key').value = '';
  byId('sonarr-key-state').textContent = sonarr.apiKeyConfigured ? 'configured' : 'not configured';
  selectValue('sonarr-root', sonarr.rootFolderPath, sonarr.rootFolderPath || 'Test connection to discover');
  selectValue('sonarr-profile', sonarr.qualityProfileId, `Profile ${sonarr.qualityProfileId}`);
  selectValue('sonarr-language', sonarr.languageProfileId ?? 0, sonarr.languageProfileId ? `Profile ${sonarr.languageProfileId}` : 'Not used');
  byId('sonarr-monitor').value = sonarr.seriesMonitor;
  byId('sonarr-new-items').value = sonarr.monitorNewItems;
  byId('sonarr-tags').value = sonarr.tags;
  byId('sonarr-search').checked = sonarr.searchOnAdd;
  byId('episode-timeout').value = sonarr.episodeReadyTimeoutMs;
  byId('episode-poll').value = sonarr.episodeReadyPollMs;
  byId('ep-count').value = sonarr.epCount;
  byId('ep-count-past').value = sonarr.epCountPast;
  byId('ep-count-mod').value = sonarr.epCountMod;

  byId('kodi-enabled').checked = playback.kodiEnabled;
  byId('kodi-package').value = playback.kodiPackageName;
  byId('streaming-enabled').checked = playback.fileStreamingEnabled;
  byId('playback-mode').value = playback.fileStreamingPlaybackMode;
  byId('streaming-secret-state').textContent = playback.fileStreamingSecretConfigured
    ? 'The file-streaming signing secret is configured outside this UI.'
    : 'Set FILE_STREAMING_SECRET in the server environment before enabling direct streaming.';

  byId('trakt-enabled').checked = trakt.enabled;
  byId('trakt-sync-mins').value = trakt.syncMins;
  byId('trakt-api-url').value = trakt.apiBaseUrl;
  byId('trakt-client-id').value = '';
  byId('trakt-client-secret').value = '';
  byId('trakt-refresh-token').value = '';
  byId('trakt-client-id-state').textContent = trakt.clientIdConfigured ? 'configured' : 'not configured';
  byId('trakt-client-secret-state').textContent = trakt.clientSecretConfigured ? 'configured' : 'not configured';
  byId('trakt-refresh-state').textContent = trakt.refreshTokenConfigured ? 'configured' : 'not configured';
  byId('trakt-redirect-uri').value = trakt.redirectUri;

  byId('tmdb-api-url').value = tmdb.apiBaseUrl;
  byId('tmdb-token').value = '';
  byId('tmdb-token-state').textContent = tmdb.authTokenConfigured ? 'configured' : 'not configured';
  byId('tmdb-region').value = tmdb.region;
  byId('install-link').href = config.app.stremioUrl;
  byId('manifest-url').textContent = config.app.manifestUrl;
}

function readNumber(id) {
  return Number(byId(id).value);
}

function collect() {
  return {
    catalog: {
      pageSize: readNumber('catalog-page-size'),
      watchedKeepCount: readNumber('catalog-watched-keep')
    },
    radarr: {
      enabled: byId('radarr-enabled').checked,
      baseUrl: byId('radarr-url').value,
      cardUrl: byId('radarr-card-url').value,
      apiKey: byId('radarr-key').value,
      rootFolderPath: byId('radarr-root').value,
      qualityProfileId: readNumber('radarr-profile'),
      minimumAvailability: byId('radarr-minimum').value,
      tags: byId('radarr-tags').value,
      searchOnAdd: byId('radarr-search').checked,
      strictImdbMatch: byId('radarr-strict').checked
    },
    sonarr: {
      enabled: byId('sonarr-enabled').checked,
      baseUrl: byId('sonarr-url').value,
      cardUrl: byId('sonarr-card-url').value,
      apiKey: byId('sonarr-key').value,
      rootFolderPath: byId('sonarr-root').value,
      qualityProfileId: readNumber('sonarr-profile'),
      languageProfileId: readNumber('sonarr-language') || null,
      seriesMonitor: byId('sonarr-monitor').value,
      monitorNewItems: byId('sonarr-new-items').value,
      episodeReadyTimeoutMs: readNumber('episode-timeout'),
      episodeReadyPollMs: readNumber('episode-poll'),
      epCount: readNumber('ep-count'),
      epCountPast: readNumber('ep-count-past'),
      epCountMod: byId('ep-count-mod').value,
      tags: byId('sonarr-tags').value,
      searchOnAdd: byId('sonarr-search').checked
    },
    playback: {
      kodiEnabled: byId('kodi-enabled').checked,
      kodiPackageName: byId('kodi-package').value,
      fileStreamingEnabled: byId('streaming-enabled').checked,
      fileStreamingPlaybackMode: byId('playback-mode').value
    },
    trakt: {
      enabled: byId('trakt-enabled').checked,
      syncMins: readNumber('trakt-sync-mins'),
      apiBaseUrl: byId('trakt-api-url').value,
      clientId: byId('trakt-client-id').value,
      clientSecret: byId('trakt-client-secret').value,
      refreshToken: byId('trakt-refresh-token').value,
      redirectUri: byId('trakt-redirect-uri').value
    },
    tmdb: {
      apiBaseUrl: byId('tmdb-api-url').value,
      authToken: byId('tmdb-token').value,
      region: byId('tmdb-region').value
    }
  };
}

async function loadConfiguration() {
  try {
    const data = await request('/api/config');
    csrf = data.csrf;
    populate(data.config);
    authPanel.hidden = true;
    dashboard.hidden = false;
    showPage('overview');
    document.querySelector('[data-section="overview"]')?.focus();
  } catch (error) {
    dashboard.hidden = true;
    authPanel.hidden = false;
    if (shell.dataset.authEnabled === 'false') {
      setMessage(authMessage, 'Editing is unavailable until CONFIG_UI_TOKEN is configured.', 'warning');
    }
  }
}

function showPage(page) {
  document.querySelectorAll('.config-section').forEach((section) => {
    section.hidden = section.dataset.page !== page;
  });
  document.querySelectorAll('[data-section]').forEach((button) => {
    const active = button.dataset.section === page;
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelector(`.config-section[data-page="${page}"]`)?.querySelector('h2')?.scrollIntoView({ block: 'start' });
}

async function testAndDiscover(service) {
  const result = byId(`${service}-result`);
  const baseUrl = byId(`${service}-url`).value;
  const apiKey = byId(`${service}-key`).value;
  setMessage(result, 'Testing connection…');
  try {
    const tested = await request(`/api/config/test/${service}`, {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey })
    });
    setMessage(result, `Connected to ${tested.name}${tested.version ? ` ${tested.version}` : ''}. Loading options…`, 'success');
    const options = await request(`/api/config/options/${service}`, {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey })
    });
    const root = byId(`${service}-root`);
    const profile = byId(`${service}-profile`);
    const selectedRoot = root.value;
    const selectedProfile = profile.value;
    root.replaceChildren();
    profile.replaceChildren();
    for (const item of options.rootFolders) option(root, item.path, item.path);
    for (const item of options.qualityProfiles) option(profile, item.id, item.name);
    if (selectedRoot) option(root, selectedRoot, selectedRoot);
    if (selectedProfile) option(profile, selectedProfile, `Profile ${selectedProfile}`);
    root.value = selectedRoot || root.options[0]?.value || '';
    profile.value = selectedProfile || profile.options[0]?.value || '';
    if (service === 'sonarr') {
      const language = byId('sonarr-language');
      const selectedLanguage = language.value;
      language.replaceChildren();
      option(language, 0, 'Not used');
      for (const item of options.languageProfiles) option(language, item.id, item.name);
      if (selectedLanguage && ![...language.options].some((item) => item.value === selectedLanguage)) {
        option(language, selectedLanguage, `Profile ${selectedLanguage}`);
      }
      language.value = selectedLanguage || '0';
    }
    setMessage(result, `Connected. Found ${options.rootFolders.length} root folder(s) and ${options.qualityProfiles.length} quality profile(s).`, 'success');
  } catch (error) {
    setMessage(result, error.message, 'error');
  }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(authMessage, 'Unlocking…');
  try {
    const data = await request('/api/config/session', {
      method: 'POST',
      body: JSON.stringify({ token: byId('admin-token').value })
    });
    csrf = data.csrf;
    byId('admin-token').value = '';
    await loadConfiguration();
  } catch (error) {
    setMessage(authMessage, error.message, 'error');
  }
});

configForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(saveBanner, 'Validating and saving…');
  try {
    const result = await request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(collect())
    });
    setMessage(saveBanner, `Saved safely. Restart Addarr to activate changes: ${result.restartCommand}`, 'success');
    await loadConfiguration();
  } catch (error) {
    setMessage(saveBanner, error.message, 'error');
    saveBanner.scrollIntoView({ block: 'center' });
  }
});

byId('test-radarr').addEventListener('click', () => testAndDiscover('radarr'));
byId('test-sonarr').addEventListener('click', () => testAndDiscover('sonarr'));
byId('copy-manifest').addEventListener('click', async () => {
  const value = byId('manifest-url').textContent;
  try {
    await navigator.clipboard.writeText(value);
    setMessage(saveBanner, 'Manifest URL copied.', 'success');
  } catch {
    setMessage(saveBanner, 'Copy is unavailable on this device. Select the manifest URL and copy it manually.', 'warning');
  }
});
byId('logout').addEventListener('click', async () => {
  try {
    await request('/api/config/session', { method: 'DELETE' });
  } finally {
    csrf = '';
    currentConfig = null;
    dashboard.hidden = true;
    authPanel.hidden = false;
    byId('admin-token').focus();
  }
});

document.querySelectorAll('[data-section]').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.section));
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' && event.key !== 'BrowserBack') return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) {
    event.preventDefault();
    active.blur();
    const page = active.closest('[data-page]')?.dataset.page || 'overview';
    document.querySelector(`[data-section="${page}"]`)?.focus();
    return;
  }
  const overview = document.querySelector('[data-page="overview"]');
  if (overview && !overview.hidden && !dashboard.hidden) return;
  if (!dashboard.hidden) {
    event.preventDefault();
    showPage('overview');
    document.querySelector('[data-section="overview"]')?.focus();
  }
});

enhanceConfigurationUi();
loadConfiguration();

const FIELD_HELP = {
  'radarr-url': 'The URL this Pi uses to reach Radarr, including http:// or https:// and its port.',
  'radarr-card-url': 'Optional user-facing Radarr URL shown on cards. Leave blank to reuse the server URL.',
  'radarr-key': 'Used only by the server. Leave blank to keep the existing key.',
  'radarr-root': 'Folder Radarr will use for movies added from Stremio.',
  'radarr-profile': 'Radarr quality profile applied to newly added movies.',
  'radarr-minimum': 'Earliest release stage at which Radarr is allowed to consider a movie available.',
  'radarr-tags': 'Optional comma-separated Radarr tag IDs, for example 1,3.',
  'sonarr-url': 'The URL this Pi uses to reach Sonarr, including http:// or https:// and its port.',
  'sonarr-card-url': 'Optional user-facing Sonarr URL shown on cards. Leave blank to reuse the server URL.',
  'sonarr-key': 'Used only by the server. Leave blank to keep the existing key.',
  'sonarr-root': 'Folder Sonarr will use for series added from Stremio.',
  'sonarr-profile': 'Sonarr quality profile applied to newly added series.',
  'sonarr-language': 'Only Sonarr v3 uses language profiles. Leave as Not used for Sonarr v4.',
  'sonarr-monitor': 'Which episodes Sonarr marks as monitored when an item is added from a Stremio episode page.',
  'sonarr-new-items': 'Controls whether future episodes become monitored after the initial add. Automatic follows the selected monitoring mode.',
  'sonarr-tags': 'Optional comma-separated Sonarr tag IDs, for example 2,4.',
  'episode-timeout': 'Maximum time to wait for Sonarr to create episode records after a new series is added.',
  'episode-poll': 'Delay between Sonarr episode-readiness checks. Smaller values poll more often.',
  'ep-count': 'In Selected episode mode, switch to the threshold upgrade mode after this many nearby prior episodes are downloaded. Use 0 or 1 to disable.',
  'ep-count-past': 'Maximum number of earlier episodes checked when applying the downloaded-episode threshold.',
  'ep-count-mod': 'Monitoring scope used when the downloaded-episode threshold is met.',
  'catalog-page-size': 'Cards built per request. Default 30; choose 10–100. Lower values reduce Pi and Arr load.',
  'catalog-watched-keep': 'Number of watched Radarr movies still retained in filtered catalogue views.',
  'kodi-package': 'Android package name used by the Kodi fallback intent. Standard Kodi is org.xbmc.kodi.',
  'playback-mode': 'Direct serves an existing file from this Pi; Kodi opens the item in Kodi when direct playback is unavailable.',
  'trakt-sync-mins': 'How often watched history is refreshed. Minimum 40 minutes.',
  'trakt-api-url': 'Normally https://api.trakt.tv. Change only for a compatible proxy.',
  'trakt-client-id': 'Leave blank to keep the stored Trakt client ID.',
  'trakt-client-secret': 'Leave blank to keep the stored Trakt client secret.',
  'trakt-refresh-token': 'Leave blank to keep the stored OAuth refresh token.',
  'trakt-redirect-uri': 'Must match the redirect URI configured for the Trakt application.',
  'tmdb-api-url': 'Normally https://api.themoviedb.org.',
  'tmdb-token': 'Optional TMDB read-access token used only as a release-date fallback.',
  'tmdb-region': 'Two-letter region used for release dates, for example AU.'
};

function enhanceConfigurationUi() {
  document.querySelectorAll('.status-card').forEach((card) => {
    const state = card.querySelector('strong')?.textContent?.trim().toLowerCase() || '';
    card.dataset.state = state === 'connected' || state === 'ready'
      ? 'online'
      : state === 'disabled' ? 'disabled' : 'error';
  });

  document.querySelectorAll('.config-section label[for]').forEach((label) => {
    if (label.closest('.toggle-row') || label.closest('.field')) return;
    const control = document.getElementById(label.htmlFor);
    if (!control || control.closest('.field')) return;
    const field = document.createElement('div');
    field.className = 'field';
    label.parentNode.insertBefore(field, label);
    field.append(label, control);
    const description = FIELD_HELP[control.id];
    if (description) {
      const help = document.createElement('p');
      help.className = 'field-help';
      help.id = `${control.id}-help`;
      help.textContent = description;
      field.append(help);
      const describedBy = [control.getAttribute('aria-describedby'), help.id].filter(Boolean).join(' ');
      control.setAttribute('aria-describedby', describedBy);
    }
  });

  const installLink = byId('install-link');
  installLink.textContent = 'Install / reinstall in Stremio';
  const saveButton = byId('save-configuration');
  saveButton.dataset.tvLast = 'true';
}

function visibleFocusable(includeSave = false) {
  return [...document.querySelectorAll('button:not([hidden]):not([disabled]), a[href]:not([hidden]), input:not([hidden]):not([disabled]), select:not([hidden]):not([disabled]), summary')]
    .filter((element) => element.getClientRects().length > 0)
    .filter((element) => includeSave || element.dataset.tvLast !== 'true');
}

function focusElement(element) {
  if (!(element instanceof HTMLElement)) return;
  element.focus();
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

function switchTab(delta) {
  const tabs = [...document.querySelectorAll('[data-section]')];
  const current = document.activeElement;
  const index = Math.max(0, tabs.indexOf(current));
  const next = tabs[(index + delta + tabs.length) % tabs.length];
  showPage(next.dataset.section);
  focusElement(next);
}

function moveSequential(delta) {
  const current = document.activeElement;
  let focusable = visibleFocusable(false);
  let index = focusable.indexOf(current);
  if (index < 0) {
    focusElement(focusable[0]);
    return;
  }
  const movingForward = delta > 0;
  if (movingForward && index === focusable.length - 1) {
    focusable = visibleFocusable(true);
    index = focusable.indexOf(current);
  }
  const nextIndex = Math.max(0, Math.min(focusable.length - 1, index + delta));
  focusElement(focusable[nextIndex]);
}

document.addEventListener('focusin', (event) => {
  if (event.target instanceof HTMLElement) {
    event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
});

document.addEventListener('keydown', (event) => {
  const direction = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[event.key];
  if (!direction) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;

  if (active.matches('[data-section]') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    switchTab(direction);
    return;
  }

  if (active instanceof HTMLSelectElement) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveSequential(direction);
    }
    return;
  }

  if (active instanceof HTMLInputElement) {
    if (active.type === 'number') {
      event.preventDefault();
      moveSequential(direction);
      return;
    }
    if (['text', 'password', 'url'].includes(active.type)) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveSequential(direction);
      }
      return;
    }
  }

  event.preventDefault();
  moveSequential(direction);
});
