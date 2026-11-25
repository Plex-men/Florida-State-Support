import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config, checkConfig } from './config.js';
import { onCommand, onButton, onModal, onMessage, onGuildMemberUpdate, onBoostMessage, sweepBoosters, card } from './handlers.js';
import { info, error, short } from './log.js';

checkConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function safely(interaction, work) {
  try {
    await work();
  } catch (err) {
    const what = interaction.commandName ? `/${interaction.commandName}` : interaction.customId ?? 'interaction';
    error('cmd', `${what} by ${interaction.user?.username}: ${short(err)}`);
    const payload = { embeds: [card('error', 'Something went wrong', err.message)], flags: MessageFlags.Ephemeral };
    if (interaction.deferred && !interaction.replied) await interaction.editReply(payload).catch(() => {});
    else if (interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.guildId !== config.guildId) return;
  if (interaction.isChatInputCommand()) return safely(interaction, () => onCommand(interaction));
  if (interaction.isButton()) return safely(interaction, () => onButton(interaction));
  if (interaction.isModalSubmit()) return safely(interaction, () => onModal(interaction));
});

client.on(Events.MessageCreate, (message) => {
  if (message.guildId !== config.guildId) return;
  onMessage(message).catch((err) => error('hook', short(err)));
  onBoostMessage(message).catch((err) => error('boost', short(err)));
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  if (newMember.guildId !== config.guildId) return;
  onGuildMemberUpdate(oldMember, newMember).catch((err) => error('boost', short(err)));
});

client.once(Events.ClientReady, async (c) => {
  info('bot', `online as ${c.user.tag}`);

  const guild = await c.guilds.fetch(config.guildId).catch(() => null);
  if (guild) {
    sweepBoosters(guild);
    setInterval(() => sweepBoosters(guild), 30 * 60 * 1000);
  }
});

client.login(config.discordToken);