const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listStableReleases,
  selectPreviousRelease,
  selectInstallerAsset,
  installerName
} = require('../src/update-release');

function release(version, publishedAt, extra = {}) {
  return {
    tag_name: `v${version}`,
    published_at: publishedAt,
    assets: [{
      name: installerName(version),
      browser_download_url: `https://github.com/pokemon1742000-commits/PU/releases/download/v${version}/${installerName(version)}`
    }],
    ...extra
  };
}

test('stable release selection ignores drafts and prereleases and sorts by published time', () => {
  const releases = listStableReleases([
    release('1.0.23', '2026-01-01T00:00:00Z'),
    release('1.0.25', '2026-03-01T00:00:00Z', { draft: true }),
    release('1.0.24', '2026-02-01T00:00:00Z', { prerelease: true }),
    release('1.0.22', '2025-12-01T00:00:00Z'),
    release('1.0.24', '2026-02-15T00:00:00Z')
  ]);
  assert.deepEqual(releases.map(item => item.version), ['1.0.24', '1.0.23', '1.0.22']);
});

test('previous release is immediately before latest and older than current', () => {
  const result = selectPreviousRelease([
    release('1.0.25', '2026-03-01T00:00:00Z'),
    release('1.0.24', '2026-02-01T00:00:00Z'),
    release('1.0.23', '2026-01-01T00:00:00Z')
  ], '1.0.25');
  assert.equal(result.latest.version, '1.0.25');
  assert.equal(result.previous.version, '1.0.24');
  assert.equal(result.reason, null);
});

test('rollback refuses when there is no older stable release', () => {
  const result = selectPreviousRelease([release('1.0.25', '2026-03-01T00:00:00Z')], '1.0.25');
  assert.equal(result.previous, null);
  assert.equal(result.reason, 'not-enough-releases');
});

test('rollback refuses when selected previous release is not older than current', () => {
  const result = selectPreviousRelease([
    release('1.0.25', '2026-03-01T00:00:00Z'),
    release('1.0.26', '2026-02-01T00:00:00Z')
  ], '1.0.25');
  assert.equal(result.previous, null);
  assert.equal(result.reason, 'previous-is-not-older-than-current');
});

test('installer selection requires exact setup name and GitHub release URL', () => {
  const target = release('1.0.24', '2026-02-01T00:00:00Z');
  assert.equal(selectInstallerAsset(target).name, 'Doi-Chieu-Setup-1.0.24.exe');
  assert.equal(selectInstallerAsset({ ...target, assets: [{ name: 'Doi-Chieu-Setup-1.0.24.exe', browser_download_url: 'https://example.com/setup.exe' }] }), null);
  assert.equal(selectInstallerAsset({ ...target, assets: [{ name: 'Doi-Chieu-Setup-1.0.23.exe', browser_download_url: target.assets[0].browser_download_url }] }), null);
});

test('release without a valid publication date is ignored', () => {
  const result = selectPreviousRelease([
    release('1.0.25', '2026-03-01T00:00:00Z'),
    release('1.0.24', '')
  ], '1.0.25');
  assert.equal(result.previous, null);
});
