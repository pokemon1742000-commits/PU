'use strict';

const fs = require('fs/promises');
const path = require('path');
const { normalizeVersion } = require('./update-release');

const MARKER_FILE_NAME = 'app-data-version.json';

function normalizedCurrentVersion(currentVersion) {
  const version = normalizeVersion(currentVersion);
  if (!version) throw new Error('Phiên bản ứng dụng không hợp lệ.');
  return version;
}

function markerPath(userDataDir) {
  return path.join(userDataDir, MARKER_FILE_NAME);
}

async function readDataVersion(markerFile) {
  try {
    const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
    return normalizeVersion(marker?.version);
  } catch {
    return null;
  }
}

async function prepareDataVersion({ userDataDir, currentVersion }) {
  const version = normalizedCurrentVersion(currentVersion);
  const dataDir = path.join(userDataDir, 'data');
  const versionMarker = markerPath(userDataDir);
  const previousVersion = await readDataVersion(versionMarker);
  const preserved = previousVersion === version;

  if (!preserved) await fs.rm(dataDir, { recursive:true, force:true });

  return { dataDir, versionMarker, previousVersion, version, preserved, reset:!preserved };
}

async function completeDataVersion({ userDataDir, currentVersion }) {
  const version = normalizedCurrentVersion(currentVersion);
  const versionMarker = markerPath(userDataDir);
  const temporaryMarker = `${versionMarker}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify({ version, updatedAt:new Date().toISOString() });

  await fs.mkdir(userDataDir, { recursive:true });
  await fs.writeFile(temporaryMarker, content, 'utf8');
  await fs.rename(temporaryMarker, versionMarker);
  return { versionMarker, version };
}

module.exports = {
  MARKER_FILE_NAME,
  markerPath,
  readDataVersion,
  prepareDataVersion,
  completeDataVersion
};
