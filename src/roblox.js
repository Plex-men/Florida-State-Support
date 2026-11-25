import crypto from 'node:crypto';
import { config } from './config.js';

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
    // say which permission the Open Cloud key is missing instead of a raw 403
    const need = path.includes('memory-store')
      ? 'memory-store → Sorted Map: Read'
      : path.includes('user-restrictions')
        ? 'user-restrictions → Read and Write'
        : path.includes('messaging-service')
          ? 'messaging-service → Publish'
          : path.includes('datastores')
            ? 'universe-datastores → Read Entry, Create Entry, Update Entry'
            : 'the permission for this API';
    throw new Error(
      `The Roblox API key can't do this yet. In Creator Hub → Credentials, edit the key and add **${need}** ` +
        `for the FSRP experience (and check the key's IP list allows this machine).`,
    );
  }
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).message || text;
    } catch {}
    throw new Error(`Roblox said ${res.status}: ${String(message).slice(0, 300)}`);
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

// old Adonis bans, imported into FSRPAdmin_Bans_v1 key "adonis" as { "<userId>": { name, reason, by, untilT } }
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