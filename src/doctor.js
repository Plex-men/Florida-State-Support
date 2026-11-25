import { config } from './config.js';
import { info, warn, error } from './log.js';

const BASE = 'https://apis.roblox.com';
const u = config.universeId;

async function hit(method, path, body) {
  const key = path.startsWith('/cloud/v2/groups/') ? config.robloxGroupKey : config.robloxApiKey;
  if (!key) return { status: 0, text: 'ROBLOX_GROUP_API_KEY not set in .env (a key on your own account)' };
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
  return { status: res.status, text };
}

const checks = [
  ['universe-datastores.objects:read', 'GET',
    `/datastores/v1/universes/${u}/standard-datastores/datastore/entries/entry?datastoreName=FSRPAdmin_Records_v1&entryKey=u_1`],
  ['memory-store.sorted-map:read', 'GET',
    `/cloud/v2/universes/${u}/memory-store/sorted-maps/FSRP_ServerList/items?maxPageSize=1`],
  ['user-restrictions:read', 'GET', `/cloud/v2/universes/${u}/user-restrictions/1`],
  ['universe-messaging-service:publish', 'POST',
    `/messaging-service/v1/universes/${u}/topics/FSRPKeyCheck`, { message: 'key check' }],
];
if (config.mainGroupId) {
  checks.push(['group:read (ROBLOX_GROUP_API_KEY)', 'GET', `/cloud/v2/groups/${config.mainGroupId}/roles?maxPageSize=1`]);
}

info('doctor', `universe ${u}, group ${config.mainGroupId || 'not set'}, key ${config.robloxApiKey ? 'set' : 'MISSING'}`);
let bad = 0;
for (const [scope, method, path, body] of checks) {
  try {
    const r = await hit(method, path, body);
    // 404 = allowed in, the entry just doesn't exist
    if (r.status && (r.status < 300 || r.status === 404)) info('doctor', `ok    ${scope}`);
    else {
      bad++;
      error('doctor', `${r.status}   ${scope}: ${r.text}`);
    }
  } catch (err) {
    bad++;
    error('doctor', `fail  ${scope}: ${err.message}`);
  }
}

if (config.bloxlinkKey) {
  const res = await fetch(`https://api.blox.link/v4/public/guilds/${config.guildId}/discord-to-roblox/1`, {
    headers: { Authorization: config.bloxlinkKey },
  }).catch((err) => ({ status: 0, text: async () => err.message }));
  if (res.status === 200 || res.status === 404) info('doctor', 'ok    bloxlink key');
  else {
    bad++;
    error('doctor', `${res.status}   bloxlink key: ${(await res.text()).slice(0, 160)}`);
  }
} else {
  warn('doctor', 'bloxlink key not set, boosters won\'t be ranked');
}

if (bad) warn('doctor', `${bad} problem(s). the text after each code is roblox's own reason.`);
else info('doctor', 'everything works');