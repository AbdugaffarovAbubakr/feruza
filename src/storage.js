'use strict';

const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

const FILES = {
  users: { name: 'users.json', defaultData: { users: [] } },
  channels: { name: 'channels.json', defaultData: { channels: [] } },
  tests: { name: 'tests.json', defaultData: { tests: [] } },
  results: { name: 'results.json', defaultData: { results: [] } },
  admins: { name: 'admins.json', defaultData: { admins: [] } }
};

const writeLocks = new Map();

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function ensureFile(fileName, defaultData) {
  const filePath = path.join(dataDir, fileName);
  try {
    await fs.access(filePath);
  } catch (_) {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

async function ensureDataFiles() {
  await ensureDir();
  const entries = Object.values(FILES);
  for (const entry of entries) {
    await ensureFile(entry.name, entry.defaultData);
  }
}

async function readJson(key) {
  const meta = FILES[key];
  if (!meta) throw new Error(`Unknown data key: ${key}`);
  await ensureFile(meta.name, meta.defaultData);
  const filePath = path.join(dataDir, meta.name);
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    return JSON.parse(JSON.stringify(meta.defaultData));
  }
}

async function writeJson(key, data) {
  const meta = FILES[key];
  if (!meta) throw new Error(`Unknown data key: ${key}`);
  await ensureDir();
  const filePath = path.join(dataDir, meta.name);
  const tempPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);

  const previous = writeLocks.get(filePath) || Promise.resolve();
  const next = previous.then(async () => {
    await fs.writeFile(tempPath, json, 'utf8');
    await fs.rename(tempPath, filePath);
  });
  writeLocks.set(filePath, next.catch(() => {}));
  return next;
}

module.exports = {
  ensureDataFiles,
  readJson,
  writeJson
};
