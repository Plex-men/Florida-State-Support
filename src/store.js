import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const file = process.env.FSRP_DATA_FILE || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bot.json');
let data = {};
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  data = {};
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
    fs.renameSync(file + '.tmp', file);
  }, 200);
}

export function get(key) {
  return data[key] ?? null;
}

export function set(key, value) {
  data[key] = value;
  save();
}

export function del(key) {
  if (key in data) {
    delete data[key];
    save();
  }
}

export function keys(prefix = '') {
  return Object.keys(data).filter((k) => k.startsWith(prefix));
}