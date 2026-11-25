import { REST, Routes } from 'discord.js';
import { config, checkConfig } from './config.js';
import { commands } from './commands.js';
import { info } from './log.js';

checkConfig({ forDeploy: true });

const rest = new REST({ version: '10' }).setToken(config.discordToken);
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
info('deploy', `registered ${commands.length} commands`);