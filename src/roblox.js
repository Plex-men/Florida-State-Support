import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './store.js';

const BASE = 'https://apis.roblox.com';

async function cloud(method, path, { body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'x-api-key': config.robloxApiKey,
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 404) return { status: 404, data: null };
  if (res.status === 401 || res.status === 403) {
    const need = path.includes('memory-store')
      ? 'memory-store → Sorted Map: Read'
      : path.includes('user-restrictions')
        ? 'user-restrictions → Read and Write'
        : path.includes('messaging-service')
          ? 'messaging-service → Publish'
          : path.includes('datastores')
            ? 'universe-datastores → Read Entry, Create Entry, Update Entry, Delete Entry'
            : path.includes('/groups/')
              ? 'groups → Read and Write (the key must be created under the group, by someone who can change ranks)'
            : 'the permission for this API';
    const err = new Error(
      `The Roblox API key can't do this yet. In Creator Hub → Credentials, edit the key and add **${need}** ` +
        `for the FSRP experience (and check the key's IP list allows this machine).`,
    );
    err.short = `roblox ${res.status}, key needs ${need.split(' →')[0]}`;
    throw err;
  }
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).message || text;
    } catch {}
    const err = new Error(`Roblox said ${res.status}: ${String(message).slice(0, 300)}`);
    err.short = `roblox ${res.status}: ${String(message).slice(0, 80).toLowerCase()}`;
    throw err;
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

export async function resolveUser(input) {
  const value = String(input || '').trim();
  if (/^\d{1,13}$/.test(value)) {
    const res = await fetch(`https://users.roblox.com/v1/users/${value}`);
    if (!res.ok) return null;
    const user = await res.json();
    return { id: Number(user.id), name: user.name };
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(value)) return null;
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usernames: [value], excludeBannedUsers: false }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const user = json.data?.[0];
  return user ? { id: Number(user.id), name: user.name } : null;
}

const restrictionPath = (userId) =>
  `/cloud/v2/universes/${config.universeId}/user-restrictions/${userId}`;

export async function getRestriction(userId) {
  const { data } = await cloud('GET', restrictionPath(userId));
  return data?.gameJoinRestriction ?? null;
}

export async function ban(userId, { seconds, displayReason, privateReason, alts }) {
  const restriction = {
    active: true,
    privateReason: String(privateReason || '').slice(0, 1000),
    displayReason: String(displayReason || '').slice(0, 400),
    excludeAltAccounts: !alts,
  };
  if (seconds !== -1) restriction.duration = `${Math.floor(seconds)}s`;
  await cloud('PATCH', `${restrictionPath(userId)}?updateMask=gameJoinRestriction`, {
    body: { gameJoinRestriction: restriction },
  });
}

export async function unban(userId) {
  await cloud('PATCH', `${restrictionPath(userId)}?updateMask=gameJoinRestriction`, {
    body: { gameJoinRestriction: { active: false } },
  });
}

export async function restrictionLogs(userId) {
  const filter = encodeURIComponent(`user == 'users/${userId}'`);
  const { data } = await cloud(
    'GET',
    `/cloud/v2/universes/${config.universeId}/user-restrictions:listLogs?maxPageSize=10&filter=${filter}`,
  );
  return data?.logs ?? [];
}

export async function publish(payload) {
  await cloud('POST', `/messaging-service/v1/universes/${config.universeId}/topics/${config.topic}`, {
    body: { message: JSON.stringify(payload) },
  });
}

export async function listServers() {
  const { data } = await cloud(
    'GET',
    `/cloud/v2/universes/${config.universeId}/memory-store/sorted-maps/${config.serverListMap}/items?maxPageSize=100`,
  );
  return (data?.items ?? [])
    .map((item) => {
      let value = item.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {}
      }
      return {
        jobId: item.id,
        players: Number(value?.players) || 0,
        max: Number(value?.max) || 0,
        started: Number(value?.started) || 0,
        users: Array.isArray(value?.users) ? value.users.map(Number) : [],
      };
    })
    .sort((a, b) => a.started - b.started);
}

const entryPath = (store, key) =>
  `/datastores/v1/universes/${config.universeId}/standard-datastores/datastore/entries/entry` +
  `?datastoreName=${encodeURIComponent(store)}&entryKey=${encodeURIComponent(key)}`;

export async function getEntry(store, key) {
  const { data } = await cloud('GET', entryPath(store, key));
  return data;
}

export async function setEntry(store, key, value) {
  const body = JSON.stringify(value);
  const md5 = crypto.createHash('md5').update(body).digest('base64');
  await cloud('POST', entryPath(store, key), {
    raw: true,
    body,
    headers: { 'content-type': 'application/json', 'content-md5': md5 },
  });
}

export async function deleteEntry(store, key) {
  await cloud('DELETE', entryPath(store, key));
}

export async function updateEntry(store, key, change) {
  const current = (await getEntry(store, key)) ?? undefined;
  const next = change(current);
  await setEntry(store, key, next);
  return next;
}

export async function addRecord(userId, kind, entry) {
  return updateEntry(config.recordsStore, `u_${userId}`, (old) => {
    const record = old && typeof old === 'object' ? old : {};
    record.warns = Array.isArray(record.warns) ? record.warns : [];
    record.notes = Array.isArray(record.notes) ? record.notes : [];
    record[kind].push(entry);
    while (record[kind].length > 50) record[kind].shift();
    return record;
  });
}

export async function getRecord(userId) {
  const record = await getEntry(config.recordsStore, `u_${userId}`);
  return {
    warns: Array.isArray(record?.warns) ? record.warns : [],
    notes: Array.isArray(record?.notes) ? record.notes : [],
  };
}

export async function logBan(entry) {
  return updateEntry(config.bansStore, 'recent', (old) => {
    const list = Array.isArray(old) ? old : [];
    list.unshift(entry);
    while (list.length > 200) list.pop();
    return list;
  });
}

export async function getAdonisBan(userId) {
  const map = await getEntry(config.bansStore, 'adonis');
  const ban = map && typeof map === 'object' ? map[String(userId)] : null;
  if (!ban) return null;
  if (Number(ban.untilT) > 0 && Number(ban.untilT) <= Date.now() / 1000) return null;
  return ban;
}

export async function removeAdonisBan(userId) {
  const map = await getEntry(config.bansStore, 'adonis');
  if (!map || typeof map !== 'object' || !(String(userId) in map)) return;
  delete map[String(userId)];
  await setEntry(config.bansStore, 'adonis', map);
}

const bloxCache = new Map();
export async function bloxlinkRobloxId(discordId) {
  if (!config.bloxlinkKey) return null;
  const hit = bloxCache.get(discordId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.id;
  const res = await fetch(`https://api.blox.link/v4/public/guilds/${config.guildId}/discord-to-roblox/${discordId}`, {
    headers: { Authorization: config.bloxlinkKey },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Bloxlink rejected the API key (check BLOXLINK_API_KEY).');
  let id = null;
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const n = Number(data?.robloxID);
    id = Number.isInteger(n) && n > 0 ? n : null;
  } else if (res.status !== 404) {
    throw new Error(`Bloxlink said ${res.status}`);
  }
  bloxCache.set(discordId, { at: Date.now(), id });
  return id;
}

export async function listKeys(store, prefix = '') {
  const keys = [];
  let cursor = '';
  do {
    const { data } = await cloud(
      'GET',
      `/datastores/v1/universes/${config.universeId}/standard-datastores/datastore/entries` +
        `?datastoreName=${encodeURIComponent(store)}&prefix=${encodeURIComponent(prefix)}&limit=100` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
    );
    for (const k of data?.keys ?? []) keys.push(k.key);
    cursor = data?.nextPageCursor ?? '';
  } while (cursor);
  return keys;
}

const dKey = (discordId) => `link:d_${discordId}`;
const rKey = (userId) => `link:r_${Number(userId)}`;

export async function getLink(discordId) {
  const link = store.get(dKey(discordId));
  return link && typeof link === 'object' && Number.isFinite(link.userId) ? link : null;
}

export async function getLinkByRoblox(userId) {
  const back = store.get(rKey(userId));
  if (!back?.discordId) return null;
  const link = await getLink(back.discordId);
  return link && link.userId === Number(userId) ? { discordId: back.discordId, ...link } : null;
}

export async function saveLink(discordId, user, extra = {}) {
  const back = store.get(rKey(user.id));
  if (back?.discordId && back.discordId !== discordId) store.del(dKey(back.discordId));
  const old = await getLink(discordId);
  if (old && old.userId !== user.id) store.del(rKey(old.userId));
  const link = { userId: user.id, name: user.name, linkedAt: Math.floor(Date.now() / 1000), boost: {}, ...extra };
  store.set(dKey(discordId), link);
  store.set(rKey(user.id), { discordId });
  return link;
}

export async function setLinkBoost(discordId, boost) {
  const link = await getLink(discordId);
  if (link) store.set(dKey(discordId), { ...link, boost });
  return link;
}

export async function removeLink(discordId) {
  const link = await getLink(discordId);
  if (!link) return null;
  store.del(dKey(discordId));
  if (store.get(rKey(link.userId))?.discordId === discordId) store.del(rKey(link.userId));
  return link;
}

export function linkedDiscordIds() {
  return store.keys('link:d_').map((k) => k.slice('link:d_'.length));
}

const roleCache = new Map();
export async function groupRoles(groupId) {
  const hit = roleCache.get(groupId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.roles;
  const roles = [];
  let token = '';
  do {
    const { data } = await cloud(
      'GET',
      `/cloud/v2/groups/${groupId}/roles?maxPageSize=20${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
    );
    for (const r of data?.groupRoles ?? []) roles.push({ path: r.path, id: r.id, name: r.displayName, rank: Number(r.rank) });
    token = data?.nextPageToken ?? '';
  } while (token);
  roleCache.set(groupId, { at: Date.now(), roles });
  return roles;
}

export async function groupMembership(groupId, userId) {
  const filter = encodeURIComponent(`user == 'users/${Number(userId)}'`);
  const { data } = await cloud('GET', `/cloud/v2/groups/${groupId}/memberships?maxPageSize=1&filter=${filter}`);
  const m = data?.groupMemberships?.[0];
  if (!m) return null;
  return { path: m.path, role: m.role, roles: Array.isArray(m.roles) && m.roles.length ? m.roles : [m.role] };
}

export async function assignGroupRole(membershipPath, rolePath) {
  await cloud('POST', `/cloud/v2/${membershipPath}:assignRole`, { body: { role: rolePath } });
}

export async function unassignGroupRole(membershipPath, rolePath) {
  await cloud('POST', `/cloud/v2/${membershipPath}:unassignRole`, { body: { role: rolePath } });
}

export async function setGroupRole(membershipPath, rolePath) {
  await cloud('PATCH', `/cloud/v2/${membershipPath}`, { body: { path: membershipPath, role: rolePath } });
}

export async function logUnban(userId, by) {
  return updateEntry(config.bansStore, 'recent', (old) => {
    const list = Array.isArray(old) ? old : [];
    for (const b of list) {
      if (b.userId === userId && !b.unbannedAt) {
        b.unbannedAt = Math.floor(Date.now() / 1000);
        b.unbannedBy = by;
      }
    }
    return list;
  });
}