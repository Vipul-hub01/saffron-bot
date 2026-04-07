require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [

  new SlashCommandBuilder()
    .setName('createscrim')
    .setDescription('Create a new scrim'),

  new SlashCommandBuilder()
    .setName('results')
    .setDescription('Show current scrim results'),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show last 10 scrim matches'),

  new SlashCommandBuilder()
    .setName('match')
    .setDescription('Get match details')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('Match ID')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('deletematch')
    .setDescription('Delete a match')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('Match ID')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Create an announcement'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all commands')

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Registering slash commands...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();