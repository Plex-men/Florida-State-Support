import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config, checkConfig } from './config.js';
import { onCommand, onButton, onModal, onMessage, card } from './handlers.js';

checkConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function safely(interaction, work) {
  try {
    await work();
  } catch (err) {
    console.error(err);
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
  onMessage(message).catch((err) => console.error('Webhook message handling failed:', err));
});

client.once(Events.ClientReady, (c) => {
  console.log(`FSRP bot online as ${c.user.tag}`);
});

client.login(config.discordToken);