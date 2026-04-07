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

client.once('clientReady', async () => {
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

      if (scrims.length === 0) {
        return message.reply('❌ No scrim history found!');
      }

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

  // 📊 RESULTS COMMAND
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

    const msg = await message.channel.send({
      embeds: [embed],
      components: [row]
    });

    currentScrim.message = msg;
  }
});

// ⚡ BUTTON + MODAL HANDLER
client.on('error', err => console.warn('⚠️ Discord client error:', err.message));

client.on('interactionCreate', async (interaction) => {
  try {

  // 📢 ANNOUNCE BUTTON → OPEN MODAL
  if (interaction.isButton() && interaction.customId === 'open_announce') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ No permission', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('announce_modal')
      .setTitle('Send Announcement');

    const msgInput = new TextInputBuilder()
      .setCustomId('announce_msg')
      .setLabel('Enter Message')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const channelInput = new TextInputBuilder()
      .setCustomId('announce_channel')
      .setLabel('Enter Channel ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(msgInput),
      new ActionRowBuilder().addComponents(channelInput)
    );

    return interaction.showModal(modal);
  }

  // 📢 ANNOUNCE MODAL SUBMIT
  if (interaction.isModalSubmit() && interaction.customId === 'announce_modal') {
    const msg = interaction.fields.getTextInputValue('announce_msg');
    const channelId = interaction.fields.getTextInputValue('announce_channel');

    const targetChannel = interaction.guild.channels.cache.get(channelId);
    if (!targetChannel) {
      return interaction.reply({ content: '❌ Invalid channel ID', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('📢 ANNOUNCEMENT')
      .setDescription(msg)
      .setColor('Orange')
      .setTimestamp();

    await targetChannel.send({ embeds: [embed] });

    return interaction.reply({ content: '✅ Announcement sent!', ephemeral: true });
  }

  // 🟢 JOIN BUTTON → OPEN MODAL
  if (interaction.isButton() && interaction.customId === 'join') {
    if (!currentScrim) {
      return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
    }

    if (currentScrim.locked) {
      return interaction.reply({ content: '❌ Scrim is locked!', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('team_modal')
      .setTitle('Enter Team Name');

    const input = new TextInputBuilder()
      .setCustomId('team_name')
      .setLabel('Your Team Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);

    return interaction.showModal(modal);
  }

  // 🔴 LEAVE BUTTON
  if (interaction.isButton() && interaction.customId === 'leave') {
    if (!currentScrim) return;

    currentScrim.teams = currentScrim.teams.filter(
      t => t.userId !== interaction.user.id
    );

    updateEmbed();

    try {
      const member = interaction.guild.members.cache.get(interaction.user.id);
      if (member && member.roles.cache.has(SCRIM_ROLE_ID)) {
        await member.roles.remove(SCRIM_ROLE_ID);
      }
    } catch (err) {
      console.warn('⚠️ Could not remove role:', err.message);
    }

    return interaction.reply({
      content: '❌ You left the scrim',
      ephemeral: true
    });
  }

  // 🛑 END SCRIM (HOST ONLY) → ASK FOR RESULTS CHANNEL
  if (interaction.isButton() && interaction.customId === 'end') {

    if (!currentScrim) {
      return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
    }

    if (interaction.user.id !== currentScrim.hostId) {
      return interaction.reply({
        content: '❌ Only host can end the scrim!',
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('end_modal')
      .setTitle('End Scrim — Post Results');

    const channelInput = new TextInputBuilder()
      .setCustomId('results_channel_id')
      .setLabel('Channel ID to post results')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Paste channel ID here')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(channelInput));

    return interaction.showModal(modal);
  }

  // 🛑 END MODAL SUBMIT
  if (interaction.isModalSubmit() && interaction.customId === 'end_modal') {

    const resultsChannelId = interaction.fields.getTextInputValue('results_channel_id');
    const resultsChannel = interaction.guild.channels.cache.get(resultsChannelId);

    if (!resultsChannel) {
      return interaction.reply({ content: '❌ Invalid channel ID!', ephemeral: true });
    }

    // 🏆 POST RESULTS
    if (currentScrim.results && currentScrim.results.length > 0) {
      const sorted = [...currentScrim.results].sort((a, b) => b.points - a.points);
      const resultText = sorted.map((r, i) =>
        `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`
      ).join('\n');

      const resultsEmbed = new EmbedBuilder()
        .setTitle(`🏆 SCRIM RESULTS - MATCH #${currentScrim.matchId}`)
        .setDescription(resultText)
        .setColor('Gold')
        .setTimestamp();

      await resultsChannel.send({ embeds: [resultsEmbed] });
    }

    // 📋 SEND TRANSCRIPT TO LOG CHANNEL
    const teamList = currentScrim.teams.length
      ? currentScrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
      : 'No teams joined';

    const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle(`📋 SCRIM TRANSCRIPT - MATCH #${currentScrim.matchId}`)
        .setColor('Orange')
        .addFields(
          { name: '👑 Host', value: currentScrim.hostName },
          { name: '🎮 Total Teams', value: `${currentScrim.teams.length}` },
          { name: '📋 Team List', value: teamList }
        )
        .setTimestamp();

      logChannel.send({ embeds: [logEmbed] });
    }

    // 🔥 Remove roles from all players
    for (const team of currentScrim.teams) {
      try {
        const member = interaction.guild.members.cache.get(team.userId);
        if (member && member.roles.cache.has(SCRIM_ROLE_ID)) {
          await member.roles.remove(SCRIM_ROLE_ID);
        }
      } catch (err) {
        console.warn('⚠️ Could not remove role:', err.message);
      }
    }

    // ⏱️ Clear timer if still running
    if (currentScrim.timerInterval) {
      clearInterval(currentScrim.timerInterval);
    }

    // 🧹 Delete room details message
    if (currentScrim.roomMessage) {
      try { await currentScrim.roomMessage.delete(); } catch {}
    }

    // 🧹 Delete scrim message
    try { await currentScrim.message.delete(); } catch {}

    // 🗄️ SAVE TO MONGODB
    try {
      await Match.create({
        matchId: currentScrim.matchId,
        host: currentScrim.hostName,
        teams: currentScrim.teams,
        results: currentScrim.results || []
      });
      console.log(`✅ Match #${currentScrim.matchId} saved to DB`);
    } catch (err) {
      console.warn('⚠️ Could not save to MongoDB:', err.message);
    }

    // 🔄 Reset scrim
    currentScrim = null;

    return interaction.reply({
      content: '✅ Scrim ended, results & transcript posted, roles removed!',
      ephemeral: true
    });
  }

  // 🔒 LOCK BUTTON (HOST ONLY)
  if (interaction.isButton() && interaction.customId === 'lock') {

    if (interaction.user.id !== currentScrim.hostId) {
      return interaction.reply({
        content: '❌ Only host can lock the scrim!',
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('room_modal')
      .setTitle('Enter Room Details');

    const roomInput = new TextInputBuilder()
      .setCustomId('room_id')
      .setLabel('Room ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const passInput = new TextInputBuilder()
      .setCustomId('room_pass')
      .setLabel('Password')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const channelInput = new TextInputBuilder()
      .setCustomId('channel_id')
      .setLabel('Channel ID to post details')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Paste channel ID here')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(roomInput),
      new ActionRowBuilder().addComponents(passInput),
      new ActionRowBuilder().addComponents(channelInput)
    );

    return interaction.showModal(modal);
  }

  // 🔒 ROOM MODAL SUBMIT
  if (interaction.isModalSubmit() && interaction.customId === 'room_modal') {

    const roomId = interaction.fields.getTextInputValue('room_id');
    const password = interaction.fields.getTextInputValue('room_pass');
    const channelId = interaction.fields.getTextInputValue('channel_id');

    const targetChannel = interaction.guild.channels.cache.get(channelId);

    if (!targetChannel) {
      return interaction.reply({
        content: '❌ Invalid channel ID!',
        ephemeral: true
      });
    }

    currentScrim.locked = true;
    currentScrim.roomId = roomId;
    currentScrim.password = password;

    // 🔥 POST ROOM DETAILS WITH ROLE MENTION
    const roomEmbed = new EmbedBuilder()
      .setTitle('🏠 SCRIM ROOM DETAILS')
      .setColor('Orange')
      .addFields(
        { name: '🏠 Room ID', value: roomId },
        { name: '🔑 Password', value: password }
      );

    const roomMessage = await targetChannel.send({
      content: `<@&${SCRIM_ROLE_ID}>`, // 🔥 mention role
      embeds: [roomEmbed]
    });

    // Save reference so it can be deleted on end
    currentScrim.roomMessage = roomMessage;

    // ⏱️ MATCH START TIMER (5 minutes)
    let timeLeft = 300;
    const timerMessage = await targetChannel.send(`⏱️ Match starts in 5:00`);

    const interval = setInterval(async () => {
      timeLeft -= 30;

      if (timeLeft <= 0) {
        clearInterval(interval);
        if (currentScrim) currentScrim.timerInterval = null;
        try { await targetChannel.send('🚀 Match Started! Best of luck to all teams!'); } catch {}
        return;
      }

      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      try {
        await timerMessage.edit(`⏱️ Match starts in ${minutes}:${seconds.toString().padStart(2, '0')}`);
      } catch (err) {
        clearInterval(interval);
        if (currentScrim) currentScrim.timerInterval = null;
        console.warn('⚠️ Timer stopped (message deleted):', err.message);
      }
    }, 30000);

    // Store so it can be cleared on end
    currentScrim.timerInterval = interval;

    // Update main embed (no room details shown here)
    updateEmbed();

    return interaction.reply({
      content: '✅ Room details posted successfully!',
      ephemeral: true
    });
  }

  // 🏆 RESULT BUTTON → OPEN MODAL
  if (interaction.isButton() && interaction.customId === 'result') {

    const modal = new ModalBuilder()
      .setCustomId('result_modal')
      .setTitle('Submit Match Result');

    const teamInput = new TextInputBuilder()
      .setCustomId('team_name')
      .setLabel('Team Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const posInput = new TextInputBuilder()
      .setCustomId('position')
      .setLabel('Position (1-25)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const killInput = new TextInputBuilder()
      .setCustomId('kills')
      .setLabel('Kills')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(teamInput),
      new ActionRowBuilder().addComponents(posInput),
      new ActionRowBuilder().addComponents(killInput)
    );

    return interaction.showModal(modal);
  }

  // 🏆 RESULT MODAL SUBMIT
  if (interaction.isModalSubmit() && interaction.customId === 'result_modal') {

    const team = interaction.fields.getTextInputValue('team_name');
    const position = parseInt(interaction.fields.getTextInputValue('position'));
    const kills = parseInt(interaction.fields.getTextInputValue('kills'));

    // 🎯 Simple Points System
    let points = 0;

    if (position === 1) points = 15;
    else if (position === 2) points = 12;
    else if (position === 3) points = 10;
    else if (position <= 5) points = 8;
    else if (position <= 10) points = 5;

    points += kills; // kill points

    if (!currentScrim.results) currentScrim.results = [];

    currentScrim.results.push({ team, position, kills, points });

    return interaction.reply({
      content: `✅ Result submitted for **${team}** (Points: ${points})`,
      ephemeral: true
    });
  }

  // 🧾 MODAL SUBMIT (TEAM NAME)
  if (interaction.isModalSubmit() && interaction.customId === 'team_modal') {

    const teamName = interaction.fields.getTextInputValue('team_name');

    if (currentScrim.teams.length >= currentScrim.maxSlots) {
      return interaction.reply({ content: '❌ Slots full!', ephemeral: true });
    }

    if (currentScrim.teams.find(t => t.userId === interaction.user.id)) {
      return interaction.reply({ content: '❌ You already joined!', ephemeral: true });
    }

    currentScrim.teams.push({
      name: teamName,
      userId: interaction.user.id
    });

    // ✅ GIVE ROLE
    try {
      const member = interaction.guild.members.cache.get(interaction.user.id);
      if (member && !member.roles.cache.has(SCRIM_ROLE_ID)) {
        await member.roles.add(SCRIM_ROLE_ID);
      }
    } catch (err) {
      console.warn('⚠️ Could not assign role:', err.message);
    }

    updateEmbed();

    return interaction.reply({
      content: `✅ **${teamName}** joined the scrim!`,
      ephemeral: true
    });
  }

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

  const embed = new EmbedBuilder()
    .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
    .setColor('Orange')
    .addFields(
      { name: '👑 Host', value: currentScrim.hostName },
      { name: '🎮 Slots', value: `${currentScrim.teams.length}/25` },
      {
        name: '📋 Teams',
        value: currentScrim.teams.length
          ? currentScrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
          : 'No teams yet'
      }
    );

  currentScrim.message.edit({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
