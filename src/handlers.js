import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  MessageType,
} from 'discord.js';
import { config } from './config.js';
import * as roblox from './roblox.js';
import * as store from './store.js';
import { info, warn, error, short } from './log.js';

const COLORS = { pending: 0xe25454, approved: 0x2ecc71, denied: 0x95a5a6, info: 0xf0f2f7, warn: 0xffd700, error: 0xe25454 };

export function card(kind, title, description) {
  const color = { ok: COLORS.approved, info: COLORS.info, warn: COLORS.warn, error: COLORS.error }[kind] ?? COLORS.info;
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: 'Florida State Roleplay' }).setTimestamp(new Date());
  if (description) embed.setDescription(String(description).slice(0, 4000));
  return embed;
}

function done(interaction, kind, title, description) {
  return interaction.editReply({ content: null, embeds: [card(kind, title, description)], allowedMentions: { parse: [] } });
}
const REQ_TAG = 'FSRP-BANREQ';

export const TIERS = ['None', 'Staff', 'Admin', 'High', 'Foundership'];

export function levelOf(member) {
  const has = (list) => list.some((id) => member?.roles?.cache?.has(id));
  if (has(config.roles.foundership)) return 4;
  if (has(config.roles.high)) return 3;
  if (has(config.roles.admin)) return 2;
  if (has(config.roles.staff)) return 1;
  return 0;
}

const NEEDS = { banrequest: 1, baninfo: 1, servers: 1, findserver: 1, notes: 1, warn: 1, kick: 1, ban: 2, unban: 2, announce: 3 };

export function lengthText(seconds) {
  if (seconds === -1) return 'Permanent';
  const parts = [];
  let left = Math.floor(seconds);
  for (const [size, unit] of [[86400, 'd'], [3600, 'h'], [60, 'm']]) {
    const n = Math.floor(left / size);
    if (n) parts.push(`${n}${unit}`);
    left -= n * size;
  }
  return parts.slice(0, 2).join(' ') || `${seconds}s`;
}

const UNITS = { s: 1, sec: 1, m: 60, min: 60, h: 3600, hr: 3600, d: 86400, day: 86400, days: 86400, w: 604800, wk: 604800, mo: 2592000, month: 2592000, y: 31536000, yr: 31536000 };
export function parseDuration(text) {
  const t = String(text ?? '').toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  if (t === 'perm' || t === 'permanent') return -1;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.floor(Number(t) * 86400);
  if (!/^(\d+(\.\d+)?[a-z]+)+$/.test(t)) return null;
  let total = 0;
  for (const [, n, unit] of t.matchAll(/(\d+(?:\.\d+)?)([a-z]+)/g)) {
    if (!UNITS[unit]) return null;
    total += Number(n) * UNITS[unit];
  }
  total = Math.floor(total);
  return total > 0 ? total : null;
}

async function getSeconds(interaction) {
  const typed = interaction.options.getString('duration');
  if (typed) {
    const seconds = parseDuration(typed);
    if (seconds === null) {
      await fail(interaction, "Couldn't read that duration. Use something like 30m, 12h, 3d, 2w, 1d12h or perm.");
      return null;
    }
    return seconds;
  }
  const preset = interaction.options.getString('length');
  if (!preset) {
    await fail(interaction, 'Pick a length or type a duration.');
    return null;
  }
  return Number(preset);
}

function clean(text, max) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/@(everyone|here)/gi, '@​$1')
    .trim()
    .slice(0, max);
}

function staffName(interaction) {
  return `${interaction.user.username} (Discord)`;
}

async function logToChannel(client, embed) {
  if (!config.logChannelId) return;
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    await channel?.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    warn('log', `log channel: ${short(err)}`);
  }
}

function fail(interaction, text) {
  const payload = { embeds: [card('error', "Couldn't do that", text)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
}

async function getUser(interaction, { idOnly = false } = {}) {
  const idInput = interaction.options.getString('userid');
  const raw = (idInput ?? interaction.options.getString('user') ?? '').trim();
  if ((idOnly || idInput !== null) && !/^\d{1,13}$/.test(raw)) {
    await fail(interaction, 'Use the Roblox user ID (numbers only) for actions, not a username.');
    return null;
  }
  const target = await roblox.resolveUser(raw);
  if (!target) {
    await fail(interaction, "Couldn't find a Roblox user with that ID.");
    return null;
  }
  return target;
}

function requestEmbed(r, status = 'Pending') {
  return new EmbedBuilder()
    .setTitle('Ban request')
    .setColor(COLORS.pending)
    .setDescription(`**${r.requestedBy}** asked to ban **${r.target}**`)
    .addFields(
      { name: 'Target', value: r.target, inline: true },
      { name: 'User ID', value: String(r.userId), inline: true },
      { name: 'Length', value: String(r.seconds), inline: true },
      { name: 'Alt accounts', value: r.alts ? 'yes' : 'no', inline: true },
      { name: 'Reason', value: r.reason || '-', inline: false },
      { name: 'Staff note', value: r.note || '-', inline: false },
      { name: 'Requested by', value: r.requestedBy, inline: false },
    )
    .setFooter({ text: `${REQ_TAG} · ${status} · ${lengthText(r.seconds)}` })
    .setTimestamp(new Date());
}

function requestButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('br:approve').setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('br:deny').setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
}

function parseRequest(embed) {
  const field = (name) => embed?.fields?.find((f) => f.name === name)?.value ?? '';
  const userId = Number(field('User ID'));
  const seconds = Number(field('Length'));
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(seconds)) return null;
  return {
    target: field('Target'),
    userId,
    seconds,
    alts: field('Alt accounts') === 'yes',
    reason: field('Reason'),
    note: field('Staff note') === '-' ? '' : field('Staff note'),
    requestedBy: field('Requested by'),
    status: embed?.footer?.text ?? '',
  };
}

async function doBan(client, { userId, name, seconds, reason, note, alts, by }) {
  await roblox.ban(userId, {
    seconds,
    displayReason: reason,
    privateReason: `${note || 'no note'} | by ${by}`,
    alts,
  });
  await Promise.allSettled([
    roblox.logBan({
      userId,
      name,
      by,
      reason,
      note,
      seconds,
      alts: !!alts,
      t: Math.floor(Date.now() / 1000),
    }),
    roblox.publish({ action: 'banned', userId, reason, by }),
  ]);
  await logToChannel(
    client,
    new EmbedBuilder()
      .setTitle('Player banned (Discord)')
      .setColor(0xff0000)
      .addFields(
        { name: 'Player', value: `${name} (${userId})`, inline: true },
        { name: 'Length', value: lengthText(seconds), inline: true },
        { name: 'By', value: by, inline: true },
        { name: 'Reason', value: reason || '-', inline: false },
      )
      .setTimestamp(new Date()),
  );
}

export async function onCommand(interaction) {
  const name = interaction.commandName;
  const level = levelOf(interaction.member);
  if (level < (NEEDS[name] ?? 99)) return fail(interaction, "Your role can't use this command.");

  await interaction.deferReply({ flags: name === 'servers' || name === 'baninfo' || name === 'notes' ? undefined : MessageFlags.Ephemeral });

  if (name === 'banrequest') {
    if (!config.banRequestChannelId) return fail(interaction, 'BAN_REQUEST_CHANNEL_ID is not set in .env.');
    const target = await getUser(interaction);
    if (!target) return;
    const seconds = await getSeconds(interaction);
    if (seconds === null) return;
    const evidence = clean(interaction.options.getString('evidence'), 500);
    const r = {
      target: target.name,
      userId: target.id,
      seconds,
      alts: interaction.options.getBoolean('alts') ?? false,
      reason: clean(interaction.options.getString('reason'), 300),
      note: evidence,
      requestedBy: `${interaction.user.username} (Discord) <@${interaction.user.id}>`,
    };
    const channel = await interaction.client.channels.fetch(config.banRequestChannelId);
    await channel.send({ embeds: [requestEmbed(r)], components: [requestButtons()], allowedMentions: { parse: [] } });
    return done(interaction, 'ok', 'Ban request sent', `**${target.name}** (${target.id}) · ${lengthText(seconds)}\nAdmins can approve it in <#${config.banRequestChannelId}>.`);
  }

  if (name === 'ban') {
    const target = await getUser(interaction);
    if (!target) return;
    const seconds = await getSeconds(interaction);
    if (seconds === null) return;
    const alts = interaction.options.getBoolean('alts') ?? false;
    const reason = clean(interaction.options.getString('reason'), 300);
    await doBan(interaction.client, {
      userId: target.id,
      name: target.name,
      seconds,
      reason,
      note: clean(interaction.options.getString('note'), 500),
      alts,
      by: staffName(interaction),
    });
    return done(interaction, 'ok', 'Player banned', `**${target.name}** (${target.id})\nLength: ${lengthText(seconds)}${alts ? ' · alts included' : ''}\nReason: ${reason || '-'}`);
  }

  if (name === 'unban') {
    const target = await getUser(interaction);
    if (!target) return;
    await roblox.unban(target.id);
    await Promise.allSettled([
      roblox.logUnban(target.id, staffName(interaction)),
      roblox.removeAdonisBan(target.id),
    ]);
    await logToChannel(
      interaction.client,
      new EmbedBuilder()
        .setTitle('Player unbanned (Discord)')
        .setColor(COLORS.approved)
        .addFields(
          { name: 'Player', value: `${target.name} (${target.id})`, inline: true },
          { name: 'By', value: staffName(interaction), inline: true },
          { name: 'Reason', value: clean(interaction.options.getString('reason'), 300) || '-', inline: false },
        ),
    );
    return done(interaction, 'ok', 'Player unbanned', `**${target.name}** (${target.id}) can join again.`);
  }

  if (name === 'baninfo') {
    const target = await getUser(interaction);
    if (!target) return;
    const [restriction, logs, record, adonis] = await Promise.all([
      roblox.getRestriction(target.id).catch(() => null),
      roblox.restrictionLogs(target.id).catch(() => []),
      roblox.getRecord(target.id).catch(() => ({ warns: [], notes: [] })),
      roblox.getAdonisBan(target.id).catch(() => null),
    ]);
    const banned = restriction?.active || !!adonis;
    const embed = new EmbedBuilder()
      .setTitle(`${target.name} (${target.id})`)
      .setURL(`https://www.roblox.com/users/${target.id}/profile`)
      .setColor(banned ? 0xff0000 : COLORS.approved)
      .addFields(
        {
          name: 'Status',
          value: restriction?.active
            ? `Banned${restriction.duration ? ` (${restriction.duration})` : ' permanently'}\nReason: ${restriction.displayReason || '-'}`
            : adonis
              ? `Banned (old Adonis ban)\nReason: ${clean(adonis.reason, 200) || '-'}\nBy: ${clean(adonis.by, 60) || '-'}`
              : 'Not banned',
        },
        {
          name: `History (${logs.length})`,
          value:
            logs
              .slice(0, 5)
              .map((l) => `${l.active ? 'Ban' : 'Unban'} · ${l.displayReason || '-'} · ${l.createTime?.slice(0, 10) ?? ''}`)
              .join('\n') || 'None',
        },
        {
          name: `Warnings (${record.warns.length})`,
          value: record.warns.slice(-5).map((w) => `• ${clean(w.reason, 120)} (by ${clean(w.by, 40)})`).join('\n') || 'None',
        },
        {
          name: `Notes (${record.notes.length})`,
          value: record.notes.slice(-5).map((n) => `• ${clean(n.text, 120)} (by ${clean(n.by, 40)})`).join('\n') || 'None',
        },
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  if (name === 'servers') {
    const servers = await roblox.listServers();
    const now = Math.floor(Date.now() / 1000);
    const lines = servers.map((s, i) => {
      const up = Math.max(0, now - s.started);
      const h = Math.floor(up / 3600);
      const m = Math.floor((up % 3600) / 60);
      return `**Server ${i + 1}** · ${s.players}/${s.max} players · up ${h ? `${h}h ` : ''}${m}m`;
    });
    const total = servers.reduce((n, s) => n + s.players, 0);
    const embed = new EmbedBuilder()
      .setTitle(`FSRP servers · ${total} players`)
      .setColor(COLORS.info)
      .setDescription(lines.join('\n') || 'No public servers are running right now.');
    return interaction.editReply({ embeds: [embed] });
  }

  if (name === 'findserver') {
    const target = await getUser(interaction);
    if (!target) return;
    const servers = await roblox.listServers();
    const index = servers.findIndex((s) => s.users.includes(target.id));
    if (index === -1) return fail(interaction, `${target.name} isn't in a live FSRP server right now.`);
    const s = servers[index];
    const join = `https://www.roblox.com/games/start?placeId=${config.placeId}&gameInstanceId=${s.jobId}`;
    const embed = new EmbedBuilder()
      .setTitle(`${target.name} is in Server ${index + 1}`)
      .setColor(COLORS.info)
      .addFields(
        { name: 'Players', value: `${s.players}/${s.max}`, inline: true },
        { name: 'Server ID', value: `\`${s.jobId}\``, inline: false },
        { name: 'Join', value: `[Join their server](${join})`, inline: false },
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  if (name === 'kick') {
    const target = await getUser(interaction);
    if (!target) return;
    const servers = await roblox.listServers();
    if (!servers.some((s) => s.users.includes(target.id))) {
      return fail(interaction, `${target.name} isn't in a live FSRP server right now.`);
    }
    const reason = clean(interaction.options.getString('reason'), 200);
    await roblox.publish({ action: 'kick', userId: target.id, reason, by: staffName(interaction) });
    await logToChannel(
      interaction.client,
      new EmbedBuilder()
        .setTitle('Player kicked (Discord)')
        .setColor(0xff8c00)
        .addFields(
          { name: 'Player', value: `${target.name} (${target.id})`, inline: true },
          { name: 'By', value: staffName(interaction), inline: true },
          { name: 'Reason', value: reason, inline: false },
        ),
    );
    return done(interaction, 'ok', 'Kick sent', `**${target.name}** (${target.id}) is being kicked.\nReason: ${reason}`);
  }

  if (name === 'announce') {
    const text = clean(interaction.options.getString('message'), 200);
    await roblox.publish({ action: 'announce', text, by: staffName(interaction) });
    await logToChannel(
      interaction.client,
      new EmbedBuilder().setTitle('Announcement (Discord)').setColor(COLORS.info).setDescription(text).setFooter({ text: staffName(interaction) }),
    );
    return done(interaction, 'ok', 'Announcement sent', `${text}\n\n-# Shown in every server. Roblox filters the text in game.`);
  }

  if (name === 'warn') {
    const target = await getUser(interaction);
    if (!target) return;
    const reason = clean(interaction.options.getString('reason'), 200);
    const record = await roblox.addRecord(target.id, 'warns', {
      t: Math.floor(Date.now() / 1000),
      by: staffName(interaction),
      reason,
    });
    await logToChannel(
      interaction.client,
      new EmbedBuilder()
        .setTitle('Player warned (Discord)')
        .setColor(COLORS.warn)
        .addFields(
          { name: 'Player', value: `${target.name} (${target.id})`, inline: true },
          { name: 'By', value: staffName(interaction), inline: true },
          { name: 'Reason', value: reason, inline: false },
        ),
    );
    return done(interaction, 'ok', 'Player warned', `**${target.name}** (${target.id}) · ${record.warns.length} warning${record.warns.length === 1 ? '' : 's'} total\nReason: ${reason}`);
  }

  if (name === 'notes') {
    const add = clean(interaction.options.getString('add'), 300);
    const target = await getUser(interaction, { idOnly: !!add });
    if (!target) return;
    const record = add
      ? await roblox.addRecord(target.id, 'notes', { t: Math.floor(Date.now() / 1000), by: staffName(interaction), text: add })
      : await roblox.getRecord(target.id);
    const embed = new EmbedBuilder()
      .setTitle(add ? `Note added · ${target.name}` : `Notes · ${target.name}`)
      .setColor(COLORS.info)
      .setDescription(
        [
          ...record.warns.slice(-10).map((w) => `⚠️ ${clean(w.reason, 150)} — ${clean(w.by, 40)}`),
          ...record.notes.slice(-10).map((n) => `📝 ${clean(n.text, 150)} — ${clean(n.by, 40)}`),
        ].join('\n') || 'No notes or warnings yet.',
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
}

export async function onButton(interaction) {
  const level = levelOf(interaction.member);

  if (interaction.customId === 'help:claim') {
    if (level < 1) return fail(interaction, 'Only staff can claim help requests.');
    await interaction.update({
      content: null,
      embeds: [card('ok', 'Help request claimed', `<@${interaction.user.id}> is on it.`)],
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.customId === 'br:approve' || interaction.customId === 'br:deny') {
    const r = parseRequest(interaction.message.embeds[0]);
    if (!r) return fail(interaction, "This request is missing details; it can't be processed.");
    if (!r.status.includes('Pending')) return fail(interaction, 'This request was already handled.');
    if (level < 2) return fail(interaction, 'Only admins can approve or deny ban requests.');

    if (interaction.customId === 'br:deny') {
      const modal = new ModalBuilder()
        .setCustomId(`br:denymodal:${interaction.message.id}`)
        .setTitle('Deny ban request')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('why')
              .setLabel('Why are you denying it?')
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(300)
              .setRequired(true),
          ),
        );
      return interaction.showModal(modal);
    }

    await interaction.deferUpdate();
    try {
      await doBan(interaction.client, {
        userId: r.userId,
        name: r.target,
        seconds: r.seconds,
        reason: r.reason,
        note: r.note,
        alts: r.alts,
        by: `${interaction.user.username} (Discord, approved request)`,
      });
    } catch (err) {
      return interaction.followUp({ embeds: [card('error', 'Ban failed', err.message)], flags: MessageFlags.Ephemeral });
    }
    const embed = requestEmbed(r, 'Approved')
      .setColor(COLORS.approved)
      .addFields({ name: 'Decision', value: `Approved by <@${interaction.user.id}>`, inline: false });
    return interaction.message.edit({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
  }
}

export async function onModal(interaction) {
  if (!interaction.customId.startsWith('br:denymodal:')) return;
  if (levelOf(interaction.member) < 2) return fail(interaction, 'Only admins can deny ban requests.');
  const messageId = interaction.customId.split(':')[2];
  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  const r = message && parseRequest(message.embeds[0]);
  if (!r || !r.status.includes('Pending')) return fail(interaction, 'This request was already handled.');
  const why = clean(interaction.fields.getTextInputValue('why'), 300);
  const embed = requestEmbed(r, 'Denied')
    .setColor(COLORS.denied)
    .addFields({ name: 'Decision', value: `Denied by <@${interaction.user.id}>: ${why}`, inline: false });
  await message.edit({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
  return interaction.reply({ embeds: [card('ok', 'Ban request denied', `${r.target} (${r.userId}) will not be banned.`)], flags: MessageFlags.Ephemeral });
}

export async function onMessage(message) {
  if (!message.webhookId || !message.embeds?.length) return;
  const embed = message.embeds[0];

if (message.channelId === config.banRequestChannelId && embed.footer?.text?.startsWith(REQ_TAG)) {
    const r = parseRequest(embed);
    if (!r) return;
    await message.channel.send({ embeds: [requestEmbed(r)], components: [requestButtons()], allowedMentions: { parse: [] } });
    await message.delete().catch(() => {});
    return;
  }

if (message.channelId === config.helpChannelId && embed.title === 'Player needs help') {
    await message.reply({
      embeds: [card('warn', 'Unclaimed', 'A staff member can claim this help request.')],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('help:claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
        ),
      ],
      allowedMentions: { parse: [] },
    });
  }
}

const BOOST_MESSAGES = new Set([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
]);

const boostLocks = new Map();
function withBoostLock(id, work) {
  const run = (boostLocks.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
  boostLocks.set(id, run);
  run.finally(() => boostLocks.get(id) === run && boostLocks.delete(id)).catch(() => {});
  return run;
}

async function changeBoosts(discordId, change) {
  const key = `boosts:${discordId}`;
  const current = store.get(key);
  const before = Number.isFinite(current?.count) ? current.count : 0;
  const after = Math.max(0, Math.min(100, change(before)));
  if (after !== before) {
    if (after === 0) store.del(key);
    else store.set(key, { count: after, updatedAt: Math.floor(Date.now() / 1000) });
  }
  return { before, after };
}

async function getBoostCount(discordId) {
  const current = store.get(`boosts:${discordId}`);
  return Number.isFinite(current?.count) ? current.count : 0;
}

function rankFor(map, count) {
  let rank = null;
  for (const step of map) if (count >= step.tier) rank = step.rank;
  return rank;
}

async function syncGroup(groupId, map, link, count) {
  if (!groupId || !map.length) return { groupId, text: null, state: link.boost?.[groupId] ?? null };
  const label = 'Group';
  let state = link.boost?.[groupId] ?? null;
  try {
    const roles = await roblox.groupRoles(groupId);
    const byRank = new Map(roles.map((r) => [r.rank, r]));
    const byPath = new Map(roles.map((r) => [r.path, r]));
    const want = rankFor(map, count);
    const wantRole = want === null ? null : byRank.get(want);
    if (want !== null && !wantRole) return { groupId, text: `${label}: there's no role with rank ${want}.`, state };

    const m = await roblox.groupMembership(groupId, link.userId);
    if (!m) return { groupId, text: `${label}: not in the group yet (ranked on the next sync after they join).`, state };
    const has = (path) => m.roles.includes(path);

    const remove = async (path) => {
      if (m.roles.length > 1) await roblox.unassignGroupRole(m.path, path);
      else {
        const back = (state?.previous && byPath.get(state.previous)) || roles.filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank)[0];
        if (back) await roblox.setGroupRole(m.path, back.path);
      }
      m.roles = m.roles.filter((p) => p !== path);
    };

    if (state?.assigned && state.assigned !== wantRole?.path && has(state.assigned)) await remove(state.assigned);
    if (!wantRole) return { groupId, text: state?.assigned ? `${label}: booster role removed.` : null, change: state?.assigned ? 'removed booster role' : null, state: null };

    if (has(wantRole.path)) return { groupId, text: `${label}: already has ${wantRole.name}.`, state: state?.assigned === wantRole.path ? state : null };
    const highest = Math.max(0, ...m.roles.map((p) => byPath.get(p)?.rank ?? 0));
    if (highest > wantRole.rank) return { groupId, text: `${label}: ranked above ${wantRole.name}, left as is.`, state: null };

    const previous = m.roles.length === 1 ? m.roles[0] : null;
    await roblox.assignGroupRole(m.path, wantRole.path);
    state = { assigned: wantRole.path, previous };
    return { groupId, text: `${label}: given **${wantRole.name}**.`, change: `gave ${wantRole.name.toLowerCase()}`, state };
  } catch (err) {
    return { groupId, text: `${label}: couldn't change the rank (${err.message})`, failed: short(err), state };
  }
}

const BOOST_GROUPS = () => [
  [config.mainGroupId, config.boostRanks.main],
];

export async function syncBoostRanks(discordId, count) {
  const robloxId = await roblox.bloxlinkRobloxId(discordId);
  let link = await roblox.getLink(discordId);
  if (link && link.userId !== robloxId) {
    for (const [groupId, map] of BOOST_GROUPS()) await syncGroup(groupId, map, link, 0);
    await roblox.removeLink(discordId);
    link = null;
  }
  if (!robloxId) return null;
  if (!link) {
    if (count <= 0) return null;
    link = await roblox.saveLink(discordId, { id: robloxId, name: String(robloxId) });
  }
  const results = [];
  for (const [groupId, map] of BOOST_GROUPS()) results.push(await syncGroup(groupId, map, link, count));
  const boost = {};
  for (const r of results) if (r.state) boost[r.groupId] = r.state;
  if (count <= 0 && Object.keys(boost).length === 0) {
    await roblox.removeLink(discordId);
  } else if (JSON.stringify(boost) !== JSON.stringify(link.boost ?? {})) {
    await roblox.setLinkBoost(discordId, boost);
  }
  return {
    link,
    lines: results.map((r) => r.text).filter(Boolean),
    changes: results.map((r) => r.change).filter(Boolean),
    failed: results.map((r) => r.failed).filter(Boolean),
  };
}

const who = (member) => member?.user?.username ?? member?.id ?? '?';

async function boostAdded(client, member, count) {
  try {
    const res = await syncBoostRanks(member.id, count);
    if (!res) info('boost', `${who(member)} boosted (${count}), not verified with bloxlink`);
    else if (res.failed.length) error('boost', `${who(member)}: ${res.failed[0]}`);
    else info('boost', `${who(member)} boosted (${count})${res.changes.length ? ', ' + res.changes.join(', ') : ''}`);
  } catch (err) {
    error('boost', `${who(member)}: ${short(err)}`);
  }
}

let lastMemberFetch = 0;
export async function loadMembers(guild) {
  if (Date.now() - lastMemberFetch < 60 * 60 * 1000 && guild.members.cache.size > 1) return guild.members.cache;
  try {
    const members = await guild.members.fetch();
    lastMemberFetch = Date.now();
    info('bot', `loaded ${members.size} members`);
    return guild.members.cache ?? members;
  } catch (err) {
    warn('bot', `member list skipped (${short(err)}), using cache`);
  }
  return guild.members.cache ?? new Map();
}

let sweeping = false;
export async function sweepBoosters(guild) {
  if (sweeping) return;
  sweeping = true;
  const pause = () => new Promise((r) => setTimeout(r, 300));
  const failures = new Map();
  const fail = (reason) => failures.set(reason, (failures.get(reason) ?? 0) + 1);
  let checked = 0;
  let changed = 0;
  try {
    const members = await loadMembers(guild);
    const missing = [
      !config.bloxlinkKey && 'BLOXLINK_API_KEY',
      !config.mainGroupId && 'MAIN_GROUP_ID',
      !config.robloxGroupKey && 'ROBLOX_GROUP_API_KEY',
    ].filter(Boolean);
    if (missing.length) {
      warn('boost', `booster ranking off, set ${missing.join(', ')} in .env`);
      return;
    }
    const check = async (id, work) => {
      checked++;
      try {
        const res = await withBoostLock(id, work);
        if (res?.failed.length) res.failed.forEach(fail);
        if (res?.changes.length) {
          changed++;
          info('boost', `${who(members.get(id))}: ${res.changes.join(', ')}`);
        }
      } catch (err) {
        fail(short(err));
      }
      await pause();
    };
    for (const m of members.values()) {
      if (!m.premiumSince) continue;
      const count = Math.max(1, await getBoostCount(m.id));
      await check(m.id, () => syncBoostRanks(m.id, count));
    }
    for (const id of roblox.linkedDiscordIds()) {
      if (members.get(id)?.premiumSince) continue;
      await check(id, async () => {
        await changeBoosts(id, () => 0);
        return syncBoostRanks(id, 0);
      });
    }
    if (checked) info('boost', `sync done, ${checked} checked, ${changed} changed`);
    for (const [reason, n] of failures) error('boost', `${n} failed: ${reason}`);
  } catch (err) {
    error('boost', `sync failed: ${short(err)}`);
  } finally {
    sweeping = false;
  }
}

export async function onBoostMessage(message) {
  if (!BOOST_MESSAGES.has(message.type) || !message.author || message.author.bot) return;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;
  const { after } = await withBoostLock(member.id, () => changeBoosts(member.id, (c) => c + 1));
  await boostAdded(message.client, member, after);
}

export async function onGuildMemberUpdate(oldMember, newMember) {
  const wasBoosting = !!oldMember?.premiumSince;
  const isBoosting = !!newMember.premiumSince;
  if (wasBoosting === isBoosting) return;

  if (!isBoosting) {
    await withBoostLock(newMember.id, () => changeBoosts(newMember.id, () => 0));
    const res = await syncBoostRanks(newMember.id, 0).catch((err) => ({ failed: [short(err)], changes: [] }));
    if (res?.failed.length) error('boost', `${who(newMember)} unboosted: ${res.failed[0]}`);
    else info('boost', `${who(newMember)} unboosted${res?.changes.length ? ', ' + res.changes.join(', ') : ''}`);
    return;
  }

  await new Promise((r) => setTimeout(r, 8000));
  const { before, after } = await withBoostLock(newMember.id, () => changeBoosts(newMember.id, (c) => Math.max(c, 1)));
  if (before === 0 && after === 1) await boostAdded(newMember.client, newMember, after);
}