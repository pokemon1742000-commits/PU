'use strict';

const REPOSITORY = Object.freeze({ owner: 'pokemon1742000-commits', name: 'PU' });
const INSTALLER_PREFIX = 'Doi-Chieu-Setup-';
const INSTALLER_SUFFIX = '.exe';

function normalizeVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(text)) return null;
  return text;
}

function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) throw new Error('Phiên bản không hợp lệ.');
  const av = a.split('.').map(Number);
  const bv = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return av[index] > bv[index] ? 1 : -1;
  }
  return 0;
}

function stableReleaseVersion(release) {
  return normalizeVersion(release?.tag_name || release?.name);
}

function listStableReleases(releases) {
  return (Array.isArray(releases) ? releases : [])
    .filter(release => release && !release.draft && !release.prerelease && stableReleaseVersion(release) && !Number.isNaN(Date.parse(release.published_at || '')))
    .map(release => ({ ...release, version: stableReleaseVersion(release) }))
    .sort((left, right) => {
      const dateDifference = Date.parse(right.published_at) - Date.parse(left.published_at);
      return dateDifference || compareVersions(right.version, left.version);
    });
}

function selectPreviousRelease(releases, currentVersion) {
  const stable = listStableReleases(releases);
  if (stable.length < 2) return { latest: stable[0] || null, previous: null, reason: 'not-enough-releases' };
  const latest = stable[0];
  const previous = stable[1];
  const current = normalizeVersion(currentVersion);
  if (!current) return { latest, previous: null, reason: 'invalid-current-version' };
  if (compareVersions(previous.version, current) >= 0) return { latest, previous: null, reason: 'previous-is-not-older-than-current' };
  return { latest, previous, reason: null };
}

function releasesForOperation(releases, currentVersion, operation) {
  const current = normalizeVersion(currentVersion);
  if (!current) throw new Error('Phiên bản hiện tại không hợp lệ.');
  if (!['update', 'rollback'].includes(operation)) throw new Error('Thao tác phiên bản không hợp lệ.');
  const direction = operation === 'update' ? 1 : -1;
  return listStableReleases(releases).filter(release => compareVersions(release.version, current) * direction > 0);
}

function selectReleaseForOperation(releases, currentVersion, operation, version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  return releasesForOperation(releases, currentVersion, operation)
    .find(release => release.version === normalized) || null;
}

function installerName(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) throw new Error('Phiên bản bộ cài không hợp lệ.');
  return `${INSTALLER_PREFIX}${normalized}${INSTALLER_SUFFIX}`;
}

function assetBelongsToRepository(asset, release) {
  const url = String(asset?.browser_download_url || '');
  const version = stableReleaseVersion(release);
  const tag = String(release?.tag_name || `v${version}`).trim();
  if (!url || !version || !tag) return false;
  try {
    const parsed = new URL(url);
    const expectedPath = `/${REPOSITORY.owner}/${REPOSITORY.name}/releases/download/${tag}/`;
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.pathname.startsWith(expectedPath);
  } catch {
    return false;
  }
}

function selectInstallerAsset(release) {
  const version = stableReleaseVersion(release);
  if (!version) return null;
  const expectedName = installerName(version);
  return (Array.isArray(release?.assets) ? release.assets : [])
    .find(asset => asset?.name === expectedName && assetBelongsToRepository(asset, release)) || null;
}

module.exports = {
  REPOSITORY,
  INSTALLER_PREFIX,
  INSTALLER_SUFFIX,
  normalizeVersion,
  compareVersions,
  listStableReleases,
  selectPreviousRelease,
  releasesForOperation,
  selectReleaseForOperation,
  installerName,
  selectInstallerAsset
};
