import { REST, Routes } from 'discord.js';
import { config, checkConfig } from './config.js';
import { commands } from './commands.js';

checkConfig({ forDeploy: true });

const rest = new REST({ version: '10' }).setToken(config.discordToken);
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
console.log(`Registered ${commands.length} commands in server ${config.guildId}.`);