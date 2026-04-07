require('dotenv').config(); 
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const mongoose = require('mongoose');

// 🗄️ MONGOOSE MATCH MODEL
const matchSchema = new mongoose.Schema({
  matchId: Number,
  host: String,
  teams: Array,
  results: Array,
  createdAt: { type: Date, default: Date.now }
});
const Match = mongoose.model('Match', matchSchema);

// 🔢 MATCH COUNTER
let matchCounter = 0;

async function loadMatchCounter() {
  const lastMatch = await Match.findOne().sort({ matchId: -1 });
  if (lastMatch) matchCounter = lastMatch.matchId;
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('⚠️ MongoDB connection failed:', err.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ✅ YOUR ROLE ID ADDED HERE
const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";

let currentScrim = null;

client.once('ready', async () => {
  await connectDB();
  await loadMatchCounter();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 🎮 MESSAGE COMMANDS
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // 📜 HISTORY COMMAND
  if (cmd === 'history') {
    try {
      const scrims = await Match.find().sort({ matchId: -1 }).limit(10);
      if (!scrims.length) return message.reply('❌ No scrim history found!');
      const historyText = scrims.map((s, i) =>
        `**#${i + 1} Match ${s.matchId}** — Host: ${s.host} | Teams: ${s.teams.length} | ${new Date(s.createdAt).toLocaleDateString()}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('📜 SCRIM HISTORY (Last 10)')
        .setDescription(historyText)
        .setColor('Orange');

      return message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('⚠️ History fetch error:', err.message);
      return message.reply('❌ Could not fetch history.');
    }
  }

  // 📋 MATCH COMMAND
  if (cmd === 'match') {
    const id = parseInt(args[0]);
    if (!id) return message.reply('❌ Usage: `!match <id>`');
    const match = await Match.findOne({ matchId: id });
    if (!match) return message.reply('❌ Match not found');

    const teams = match.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
    const sorted = [...(match.results || [])].sort((a, b) => b.points - a.points);
    const resultsText = sorted.length
      ? sorted.map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`).join('\n')
      : 'No results recorded';

    const embed = new EmbedBuilder()
      .setTitle(`📋 MATCH #${id}`)
      .addFields(
        { name: '👑 Host', value: match.host },
        { name: '📋 Teams', value: teams || 'No teams' },
        { name: '🏆 Results', value: resultsText }
      )
      .setColor('Blue')
      .setTimestamp(match.createdAt);

    return message.channel.send({ embeds: [embed] });
  }

  // 🗑️ DELETE MATCH
  if (cmd === 'deletematch') {
    const id = parseInt(args[0]);
    if (!id) return message.reply('❌ Usage: `!deletematch <id>`');
    const deleted = await Match.findOneAndDelete({ matchId: id });
    if (!deleted) return message.reply('❌ Match not found in database.');
    return message.reply(`✅ Match #${id} deleted from history.`);
  }

  // 📖 HELP COMMAND
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 SAFFRON SCRIMS BOT - HELP')
      .setColor('Orange')
      .setDescription('Here are all available commands:')
      .addFields(
        { name: '🎮 Scrim Commands', value: '`!createscrim` → Create a new scrim\n`!results` → Show current scrim results' },
        { name: '📊 Match Commands', value: '`!history` → View last 10 matches\n`!match <id>` → View match details\n`!deletematch <id>` → Delete a match' },
        { name: '📢 Utility', value: '`!announce` → Send announcement\n`!help` → Show this help menu' },
        { name: '⚡ Interactive Buttons', value: 'Join / Leave / Lock / End / Submit Results\n(Use buttons in scrim message)' }
      )
      .setFooter({ text: '🔥 Saffron Scrims Bot | Automated Scrims System' })
      .setTimestamp();

    return message.channel.send({ embeds: [embed] });
  }

  // 📢 ANNOUNCE
  if (cmd === 'announce') {
    const button = new ButtonBuilder()
      .setCustomId('open_announce')
      .setLabel('Create Announcement')
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(button);

    return message.reply({ content: 'Click button to create announcement', components: [row] });
  }

  // 📊 RESULTS
  if (cmd === 'results') {
    if (!currentScrim || !currentScrim.results?.length) return message.reply('❌ No results submitted yet!');
    const sorted = [...currentScrim.results].sort((a, b) => b.points - a.points);
    const resultText = sorted.map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🏆 SCRIM RESULTS - MATCH #${currentScrim.matchId}`)
      .setDescription(resultText)
      .setColor('Gold');

    return message.channel.send({ embeds: [embed] });
  }

  // 🎮 CREATE SCRIM
  if (cmd === 'createscrim') {
    matchCounter++;
    currentScrim = {
      matchId: matchCounter,
      teams: [],
      maxSlots: 25,
      hostId: message.author.id,
      hostName: message.author.username,
      locked: false,
      roomId: null,
      password: null,
      results: []
    };

    const embed = new EmbedBuilder()
      .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
      .setDescription('Click buttons below to join or leave the scrim')
      .addFields(
        { name: '👑 Host', value: currentScrim.hostName },
        { name: '🎮 Slots', value: '0/25' },
        { name: '📋 Teams', value: 'No teams yet' }
      )
      .setColor('Orange');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('End Scrim').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('result').setLabel('Submit Result').setStyle(ButtonStyle.Success)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    currentScrim.message = msg;
  }
});

// ⚡ INTERACTION (SLASH COMMAND + BUTTON + MODAL)
client.on('interactionCreate', async (interaction) => {
  try {

    // ✅ SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      await interaction.deferReply();

      if (commandName === 'createscrim') {
        matchCounter++;
        currentScrim = {
          matchId: matchCounter,
          teams: [],
          maxSlots: 25,
          hostId: interaction.user.id,
          hostName: interaction.user.username,
          locked: false,
          roomId: null,
          password: null,
          results: []
        };

        const embed = new EmbedBuilder()
          .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
          .setDescription('Click buttons below to join or leave the scrim')
          .addFields(
            { name: '👑 Host', value: currentScrim.hostName },
            { name: '🎮 Slots', value: '0/25' },
            { name: '📋 Teams', value: 'No teams yet' }
          )
          .setColor('Orange');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('end').setLabel('End Scrim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('result').setLabel('Submit Result').setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.editReply({ embeds: [embed], components: [row] });
        currentScrim.message = msg;
        return;
      }

      // ✅ HISTORY
      if (commandName === 'history') {
        const scrims = await Match.find().sort({ matchId: -1 }).limit(10);
        if (!scrims.length) return interaction.editReply('❌ No scrim history found!');
        const historyText = scrims.map((s, i) =>
          `**#${i + 1} Match ${s.matchId}** — Host: ${s.host} | Teams: ${s.teams.length} | ${new Date(s.createdAt).toLocaleDateString()}`
        ).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('📜 SCRIM HISTORY (Last 10)')
          .setDescription(historyText)
          .setColor('Orange');

        return interaction.editReply({ embeds: [embed] });
      }

      // ✅ MATCH
      if (commandName === 'match') {
        const id = interaction.options.getInteger('id');
        if (!id) return interaction.editReply('❌ Provide match ID!');
        const match = await Match.findOne({ matchId: id });
        if (!match) return interaction.editReply('❌ Match not found');

        const teams = match.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
        const sorted = [...(match.results || [])].sort((a, b) => b.points - a.points);
        const resultsText = sorted.length
          ? sorted.map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`).join('\n')
          : 'No results recorded';

        const embed = new EmbedBuilder()
          .setTitle(`📋 MATCH #${id}`)
          .addFields(
            { name: '👑 Host', value: match.host },
            { name: '📋 Teams', value: teams || 'No teams' },
            { name: '🏆 Results', value: resultsText }
          )
          .setColor('Blue')
          .setTimestamp(match.createdAt);

        return interaction.editReply({ embeds: [embed] });
      }

      // ✅ DELETE MATCH
      if (commandName === 'deletematch') {
        const id = interaction.options.getInteger('id');
        if (!id) return interaction.editReply('❌ Provide match ID!');
        const deleted = await Match.findOneAndDelete({ matchId: id });
        if (!deleted) return interaction.editReply('❌ Match not found in database.');
        return interaction.editReply(`✅ Match #${id} deleted from history.`);
      }

      // ✅ RESULTS
      if (commandName === 'results') {
        if (!currentScrim?.results?.length) return interaction.editReply('❌ No results submitted yet!');
        const sorted = [...currentScrim.results].sort((a, b) => b.points - a.points);
        const resultText = sorted.map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`).join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`🏆 SCRIM RESULTS - MATCH #${currentScrim.matchId}`)
          .setDescription(resultText)
          .setColor('Gold');

        return interaction.editReply({ embeds: [embed] });
      }

      // ✅ ANNOUNCE
      if (commandName === 'announce') {
        return interaction.editReply({
          content: 'Click button below',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('open_announce')
                .setLabel('Create Announcement')
                .setStyle(ButtonStyle.Primary)
            )
          ]
        });
      }

      // ✅ HELP
      if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('📖 SAFFRON SCRIMS BOT - HELP')
          .setColor('Orange')
          .setDescription('Here are all available commands:')
          .addFields(
            { name: '🎮 Scrim Commands', value: '/createscrim → Create a new scrim\n/results → Show current scrim results' },
            { name: '📊 Match Commands', value: '/history → View last 10 matches\n/match <id> → View match details\n/deletematch <id> → Delete a match' },
            { name: '📢 Utility', value: '/announce → Send announcement\n/help → Show this help menu' },
            { name: '⚡ Interactive Buttons', value: 'Join / Leave / Lock / End / Submit Results\n(Use buttons in scrim message)' }
          )
          .setFooter({ text: '🔥 Saffron Scrims Bot | Automated Scrims System' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }
    }

    // ✅ BUTTONS AND MODALS (existing logic unchanged)
    // ...all your current button/modal code stays here...

  } catch (err) {
    if (err.code === 10062) {
      console.warn('⚠️ Interaction expired (ignored):', err.message);
    } else {
      console.error('⚠️ Interaction error:', err.message);
    }
  }
});

// 🔄 UPDATE EMBED FUNCTION
function updateEmbed() {
  if (!currentScrim?.message) return;
  const embed = new EmbedBuilder()
    .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
    .setColor('Orange')
    .addFields(
      { name: '👑 Host', value: currentScrim.hostName },
      { name: '🎮 Slots', value: `${currentScrim.teams.length}/25` },
      { name: '📋 Teams', value: currentScrim.teams.length
        ? currentScrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
        : 'No teams yet'
      }
    );

  currentScrim.message.edit({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
