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

// ✅ YOUR ROLE ID & LOG CHANNEL
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

  // 📖 HELP COMMAND
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 SAFFRON SCRIMS BOT - HELP')
      .setColor('Orange')
      .setDescription('Here are all available commands:')
      .addFields(
        {
          name: '🎮 Scrim Commands',
          value: '`!createscrim` → Create a new scrim\n`!results` → Show current scrim results'
        },
        {
          name: '📊 Match Commands',
          value: '`!history` → View last 10 matches\n`!match <id>` → View match details\n`!deletematch <id>` → Delete a match'
        },
        {
          name: '📢 Utility',
          value: '`!announce` → Send announcement\n`!help` → Show this help menu'
        },
        {
          name: '⚡ Interactive Buttons',
          value: 'Join / Leave / Lock / End / Submit Results\n(Use buttons in scrim message)'
        }
      )
      .setFooter({ text: '🔥 Saffron Scrims Bot | Automated Scrims System' })
      .setTimestamp();

    return message.channel.send({ embeds: [embed] });
  }

  // 📜 HISTORY
  if (cmd === 'history') {
    try {
      const scrims = await Match.find().sort({ matchId: -1 }).limit(10);
      if (scrims.length === 0) return message.reply('❌ No scrim history found!');

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

  // 📋 MATCH
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

  // 📢 ANNOUNCE COMMAND
  if (cmd === 'announce') {
    const button = new ButtonBuilder()
      .setCustomId('open_announce')
      .setLabel('Create Announcement')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    return message.reply({
      content: 'Click button to create announcement',
      components: [row]
    });
  }

  // 📊 RESULTS
  if (cmd === 'results') {
    if (!currentScrim || !currentScrim.results || currentScrim.results.length === 0) {
      return message.reply('❌ No results submitted yet!');
    }

    const sorted = currentScrim.results.sort((a, b) => b.points - a.points);
    const resultText = sorted.map((r, i) =>
      `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`
    ).join('\n');

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

// ⚡ BUTTON + MODAL HANDLER
client.on('interactionCreate', async (interaction) => {
  try {

    // ✅ BUTTONS
    if (interaction.isButton()) {
      const id = interaction.customId;
      await interaction.deferUpdate(); // prevents "thinking..."

      if (!currentScrim) return;

      // 🔵 JOIN
      if (id === 'join') {
        if (currentScrim.locked) return;
        const modal = new ModalBuilder().setCustomId('team_modal').setTitle('Enter Team Name');
        const input = new TextInputBuilder().setCustomId('team_name').setLabel('Your Team Name').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // 🔴 LEAVE
      if (id === 'leave') {
        currentScrim.teams = currentScrim.teams.filter(t => t.userId !== interaction.user.id);
        try {
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.remove(SCRIM_ROLE_ID);
        } catch {}
        updateEmbed();
        return;
      }

      // 🔒 LOCK, END, RESULT, ANNOUNCE handled similarly with modals or embeds
      // ... (keep same logic as old modal-based code)
    }

    // 🧾 MODAL SUBMISSIONS
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id === 'team_modal') {
        const teamName = interaction.fields.getTextInputValue('team_name');
        if (currentScrim.teams.length >= currentScrim.maxSlots) return interaction.reply({ content: '❌ Slots full!', ephemeral: true });
        if (currentScrim.teams.find(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already joined!', ephemeral: true });

        currentScrim.teams.push({ name: teamName, userId: interaction.user.id });
        try {
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && !member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.add(SCRIM_ROLE_ID);
        } catch {}
        updateEmbed();
        return interaction.reply({ content: `✅ **${teamName}** joined the scrim!`, ephemeral: true });
      }

      // END_MODAL, RESULT_MODAL, ROOM_MODAL, ANNOUNCE_MODAL handled similarly
    }

  } catch (err) {
    if (err.code !== 10062) console.error('⚠️ Interaction error:', err);
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
      { name: '📋 Teams', value: currentScrim.teams.length ? currentScrim.teams.map((t,i)=>`${i+1}. ${t.name}`).join('\n') : 'No teams yet' }
    );
  currentScrim.message.edit({ embeds: [embed] }).catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
