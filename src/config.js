import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env (see .env.example)`);
  }
  return value;
}

function ids(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN?.trim(),
  clientId: process.env.DISCORD_CLIENT_ID?.trim(),
  guildId: process.env.DISCORD_GUILD_ID?.trim(),

  robloxApiKey: process.env.ROBLOX_API_KEY?.trim(),
  universeId: process.env.ROBLOX_UNIVERSE_ID?.trim() || '4070239544',
  placeId: process.env.ROBLOX_PLACE_ID?.trim() || '11448102409',

  banRequestChannelId: process.env.BAN_REQUEST_CHANNEL_ID?.trim(),
  helpChannelId: process.env.HELP_CHANNEL_ID?.trim(),
  logChannelId: process.env.LOG_CHANNEL_ID?.trim(),

  roles: {
    staff: ids('STAFF_ROLE_IDS'),
    admin: ids('ADMIN_ROLE_IDS'),
    high: [...ids('HIGH_ROLE_IDS'), ...ids('SENIOR_ROLE_IDS')],
    foundership: ids('FOUNDERSHIP_ROLE_IDS'),
  },

  topic: 'FSRPAdmin',
  recordsStore: 'FSRPAdmin_Records_v1',
  bansStore: 'FSRPAdmin_Bans_v1',
  serverListMap: 'FSRP_ServerList',
  tempBanMaxSeconds: 7 * 86400,
};

export function checkConfig({ forDeploy = false } = {}) {
  required('DISCORD_TOKEN');
  required('DISCORD_CLIENT_ID');
  required('DISCORD_GUILD_ID');
  if (!forDeploy) {
    required('ROBLOX_API_KEY');
    const { staff, admin, high, foundership } = config.roles;
    if (!staff.length && !admin.length && !high.length && !foundership.length) {
      throw new Error('Set at least one of STAFF_ROLE_IDS, ADMIN_ROLE_IDS, HIGH_ROLE_IDS or FOUNDERSHIP_ROLE_IDS in .env');
    }
  }
}
