import { SlashCommandBuilder } from 'discord.js';

const LENGTHS = [
  { name: '1 hour', value: '3600' },
  { name: '1 day', value: '86400' },
  { name: '7 days', value: '604800' },
  { name: '30 days', value: '2592000' },
  { name: 'Permanent', value: '-1' },
];

const user = (o) => o.setName('user').setDescription('Roblox username or user ID').setRequired(true).setMaxLength(40);
const userId = (o) =>
  o.setName('userid').setDescription('Roblox user ID (numbers only)').setRequired(true).setMinLength(1).setMaxLength(13);
const reason = (o, required = true) =>
  o.setName('reason').setDescription("Reason (the player sees this for bans and kicks)").setRequired(required).setMaxLength(300);
const length = (o) => o.setName('length').setDescription('Preset length (or use duration)').addChoices(...LENGTHS);
const duration = (o) =>
  o.setName('duration').setDescription('Any length, e.g. 30m, 12h, 3d, 2w, 1d12h, perm').setMaxLength(20);

export const commands = [
  new SlashCommandBuilder()
    .setName('banrequest')
    .setDescription('Ask an admin to ban a player (they approve or deny it)')
    .addStringOption(userId)
    .addStringOption((o) => reason(o))
    .addStringOption(length)
    .addStringOption(duration)
    .addStringOption((o) => o.setName('evidence').setDescription('Clip link or context for the admins').setMaxLength(500))
    .addBooleanOption((o) => o.setName('alts').setDescription('Also ban their alt accounts')),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a player from FSRP (Roblox Ban API)')
    .addStringOption(userId)
    .addStringOption((o) => reason(o))
    .addStringOption(length)
    .addStringOption(duration)
    .addStringOption((o) => o.setName('note').setDescription('Private staff note').setMaxLength(500))
    .addBooleanOption((o) => o.setName('alts').setDescription('Also ban their alt accounts')),

  new SlashCommandBuilder()
    .setName('findserver')
    .setDescription('Find which live FSRP server a player is in')
    .addStringOption(user),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a player')
    .addStringOption(userId)
    .addStringOption((o) => reason(o, false)),

  new SlashCommandBuilder()
    .setName('baninfo')
    .setDescription("Show a player's ban status, history, warns and notes")
    .addStringOption(user),

  new SlashCommandBuilder().setName('servers').setDescription('List live FSRP servers'),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a player from whatever FSRP server they are in')
    .addStringOption(userId)
    .addStringOption((o) => reason(o)),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Show an announcement in every FSRP server')
    .addStringOption((o) => o.setName('message').setDescription('What to announce').setRequired(true).setMaxLength(200)),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Add a warning to a player (shows in the in-game panel)')
    .addStringOption(userId)
    .addStringOption((o) => reason(o)),

  new SlashCommandBuilder()
    .setName('notes')
    .setDescription("Show a player's staff notes, or add one")
    .addStringOption(user)
    .addStringOption((o) => o.setName('add').setDescription('Note to add').setMaxLength(300)),
].map((c) => c.setDMPermission(false).toJSON());