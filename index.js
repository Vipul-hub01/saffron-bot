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
  TextInputStyle,
} = require('discord.js');
const mongoose = require('mongoose');

// ---------------- MONGOOSE ----------------
const matchSchema = new mongoose.Schema({
  matchId: Number,
  host: String,
  teams: Array,
  results: Array,
  createdAt: { type: Date, default: Date.now },
});
const Match = mongoose.model('Match', matchSchema);

let matchCounter = 0;
let currentScrim = null;

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('⚠️ MongoDB connection failed:', err.message);
  }
}

async function loadMatchCounter() {
  const lastMatch = await Match.findOne().sort({ matchId: -1 });
  if (lastMatch) matchCounter = lastMatch.matchId;
}

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---------------- CONFIG ----------------
const SCRIM_ROLE_ID = '1488611595318988850';
const LOG_CHANNEL_ID = '1489298280960622805';

// ---------------- CLIENT READY ----------------
client.once('ready', async () => {
  await connectDB();
  await loadMatchCounter();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------------- SLASH COMMANDS ----------------
client.on('interactionCreate', async (interaction) => {
  try {
    // ---------------- SLASH ----------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      await interaction.deferReply({ ephemeral: true }); // respond within 3s

      // HELP
      if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('📖 SAFFRON SCRIMS BOT - HELP')
          .setColor('Orange')
          .setDescription('Here are all available commands:')
          .addFields(
            {
              name: '🎮 Scrim Commands',
              value:
                '`/createscrim` → Create a new scrim\n' +
                '`/results` → Show current scrim results',
            },
            {
              name: '📊 Match Commands',
              value:
                '`/history` → View last 10 matches\n' +
                '`/match <id>` → View match details\n' +
                '`/deletematch <id>` → Delete a match',
            },
            {
              name: '📢 Utility',
              value: '`/announce` → Send announcement\n' + '`/help` → Show this help menu',
            },
            {
              name: '⚡ Interactive Buttons',
              value: 'Join / Leave / Lock / End / Submit Results\n(Use buttons in scrim message)',
            }
          )
          .setFooter({ text: '🔥 Saffron Scrims Bot | Automated Scrims System' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // CREATE SCRIM
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
          results: [],
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

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
        currentScrim.message = msg;
        return interaction.editReply({ content: '✅ Scrim created successfully!' });
      }

      // RESULTS
      if (commandName === 'results') {
        if (!currentScrim || !currentScrim.results.length)
          return interaction.editReply('❌ No results submitted yet!');

        const sorted = currentScrim.results.sort((a, b) => b.points - a.points);
        const resultText = sorted
          .map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`)
          .join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`🏆 SCRIM RESULTS - MATCH #${currentScrim.matchId}`)
          .setDescription(resultText)
          .setColor('Gold');

        return interaction.editReply({ embeds: [embed] });
      }

      // HISTORY
      if (commandName === 'history') {
        const scrims = await Match.find().sort({ matchId: -1 }).limit(10);
        if (!scrims.length) return interaction.editReply('❌ No scrim history found!');

        const historyText = scrims
          .map((s, i) => `**#${i + 1} Match ${s.matchId}** — Host: ${s.host} | Teams: ${s.teams.length}`)
          .join('\n');

        const embed = new EmbedBuilder().setTitle('📜 SCRIM HISTORY (Last 10)').setDescription(historyText).setColor('Orange');

        return interaction.editReply({ embeds: [embed] });
      }

      // MATCH
      if (commandName === 'match') {
        const id = interaction.options.getInteger('id');
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
          .setColor('Blue');

        return interaction.editReply({ embeds: [embed] });
      }

      // DELETE MATCH
      if (commandName === 'deletematch') {
        const id = interaction.options.getInteger('id');
        const deleted = await Match.findOneAndDelete({ matchId: id });
        if (!deleted) return interaction.editReply('❌ Match not found in DB');
        return interaction.editReply(`✅ Match #${id} deleted successfully`);
      }

      // ANNOUNCE
      if (commandName === 'announce') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('open_announce').setLabel('Create Announcement').setStyle(ButtonStyle.Primary)
        );
        return interaction.editReply({ content: 'Click button to create announcement', components: [row] });
      }
    }

    // ---------------- BUTTONS ----------------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // JOIN
      if (id === 'join') {
        if (!currentScrim) return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
        if (currentScrim.locked) return interaction.reply({ content: '❌ Scrim is locked!', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('team_modal').setTitle('Enter Team Name');
        const input = new TextInputBuilder().setCustomId('team_name').setLabel('Your Team Name').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // LEAVE
      if (id === 'leave') {
        if (!currentScrim) return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
        currentScrim.teams = currentScrim.teams.filter(t => t.userId !== interaction.user.id);
        try {
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.remove(SCRIM_ROLE_ID);
        } catch {}
        updateEmbed();
        return interaction.reply({ content: '❌ You left the scrim', ephemeral: true });
      }

      // LOCK, END, RESULT, OPEN_ANNOUNCE → handled via modals
      return;
    }

    // ---------------- MODALS ----------------
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      // TEAM NAME
      if (id === 'team_modal') {
        const teamName = interaction.fields.getTextInputValue('team_name');
        if (!currentScrim) return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
        if (currentScrim.teams.find(t => t.userId === interaction.user.id))
          return interaction.reply({ content: '❌ You already joined!', ephemeral: true });
        currentScrim.teams.push({ name: teamName, userId: interaction.user.id });
        try {
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && !member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.add(SCRIM_ROLE_ID);
        } catch {}
        updateEmbed();
        return interaction.reply({ content: `✅ **${teamName}** joined the scrim!`, ephemeral: true });
      }

      // MORE MODALS (LOCK, END, RESULT, ANNOUNCE) can be added here similarly
    }
  } catch (err) {
    console.error('⚠️ Interaction error:', err.message);
    if (!interaction.replied) interaction.reply({ content: '⚠️ Something went wrong!', ephemeral: true });
  }
});

// ---------------- UPDATE EMBED ----------------
function updateEmbed() {
  if (!currentScrim || !currentScrim.message) return;
  const embed = new EmbedBuilder()
    .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
    .setColor('Orange')
    .addFields(
      { name: '👑 Host', value: currentScrim.hostName },
      { name: '🎮 Slots', value: `${currentScrim.teams.length}/${currentScrim.maxSlots}` },
      {
        name: '📋 Teams',
        value: currentScrim.teams.length
          ? currentScrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
          : 'No teams yet',
      }
    );
  currentScrim.message.edit({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
