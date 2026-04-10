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

// ==========================================
// 🗄️ DATABASE MODELS
// ==========================================
const matchSchema = new mongoose.Schema({
  matchId: Number,
  host: String,
  teams: Array,
  results: Array,
  createdAt: { type: Date, default: Date.now }
});
const Match = mongoose.model('Match', matchSchema);

const tourneySchema = new mongoose.Schema({
  tourneyId: String,
  hostId: String,
  maxTeams: { type: Number, default: 100 },
  teams: Array,
  status: { type: String, default: 'registering' },
  createdAt: { type: Date, default: Date.now }
});
const Tourney = mongoose.model('Tourney', tourneySchema);

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

// ==========================================
// ⚙️ CONSTANTS & IDS (PASTE YOUR ROLE IDS HERE)
// ==========================================
const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";

// 🔥 TOURNAMENT GROUP ROLES
const ROLE_GROUP_A = "1492126223298596864";
const ROLE_GROUP_B = "1492126277199728741";
const ROLE_GROUP_C = "1492126324930641950";
const ROLE_GROUP_D = "1492126364218953831";

// ==========================================
// 🤖 BOT SETUP & MEMORY MAPS
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const activeScrims = new Map(); 
const activeTourneys = new Map();

client.once('ready', async () => {
  await connectDB();
  await loadMatchCounter();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ==========================================
// 🎮 MESSAGE COMMANDS
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // ----------------------------------------
  // SCRIM COMMANDS (Untouched)
  // ----------------------------------------
  if (cmd === 'history') {
    try {
      const scrims = await Match.find().sort({ matchId: -1 }).limit(10);
      if (scrims.length === 0) return message.reply('❌ No scrim history found!');

      const historyText = scrims.map((s, i) =>
        `**#${i + 1} Match ${s.matchId}** — Host: ${s.host} | Teams: ${s.teams.length} | ${new Date(s.createdAt).toLocaleDateString()}`
      ).join('\n');

      const embed = new EmbedBuilder().setTitle('📜 SCRIM HISTORY (Last 10)').setDescription(historyText).setColor('Orange');
      return message.channel.send({ embeds: [embed] });
    } catch (err) {
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
    const resultsText = sorted.length ? sorted.map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`).join('\n') : 'No results recorded';

    const embed = new EmbedBuilder().setTitle(`📋 MATCH #${id}`).addFields({ name: '👑 Host', value: match.host }, { name: '📋 Teams', value: teams || 'No teams' }, { name: '🏆 Results', value: resultsText }).setColor('Blue').setTimestamp(match.createdAt);
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'deletematch') {
    const id = parseInt(args[0]);
    if (!id) return message.reply('❌ Usage: `!deletematch <id>`');
    const deleted = await Match.findOneAndDelete({ matchId: id });
    if (!deleted) return message.reply('❌ Match not found in database.');
    return message.reply(`✅ Match #${id} deleted from history.`);
  }

  if (cmd === 'announce') {
    const button = new ButtonBuilder().setCustomId('open_announce').setLabel('Create Announcement').setStyle(ButtonStyle.Primary);
    return message.reply({ content: 'Click button to create announcement', components: [new ActionRowBuilder().addComponents(button)] });
  }

  if (cmd === 'createscrim') {
    matchCounter++;
    const newScrim = {
      matchId: matchCounter,
      teams: [],
      maxSlots: 25,
      hostId: message.author.id,
      hostName: message.author.username,
      locked: false,
      roomId: null,
      password: null,
      results: [],
      message: null
    };

    const embed = new EmbedBuilder()
      .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${newScrim.matchId}`)
      .setDescription('Click buttons below to join or leave the scrim')
      .addFields({ name: '👑 Host', value: newScrim.hostName }, { name: '🎮 Slots', value: '0/25' }, { name: '📋 Teams', value: 'No teams yet' })
      .setColor('Orange');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('End Scrim').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('result').setLabel('Submit Result').setStyle(ButtonStyle.Success)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newScrim.message = msg;
    activeScrims.set(msg.id, newScrim);
  }

  // ----------------------------------------
  // 🏆 TOURNAMENT COMMANDS (NEW)
  // ----------------------------------------
  if (cmd === 'createtourney') {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Only Admins can create tournaments.');

    const tourneyId = `T-${Date.now().toString().slice(-6)}`;
    const newTourney = {
      tourneyId: tourneyId,
      hostId: message.author.id,
      maxTeams: 100,
      teams: [],
      status: 'registering',
      message: null
    };

    const embed = new EmbedBuilder()
      .setTitle(`🏆 TOURNAMENT REGISTRATION`)
      .setDescription(`**ID:** ${tourneyId}\n\nClick the button below to register your team. Once registration is closed, teams will be randomly divided into 4 groups and your Discord role will be assigned automatically.`)
      .addFields({ name: '📊 Registered Teams', value: '0/100' })
      .setColor('Purple');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tourney_join').setLabel('Register Team').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tourney_close').setLabel('Close & Make Groups').setStyle(ButtonStyle.Danger)
    );

    const panelMsg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = panelMsg;
    activeTourneys.set(panelMsg.id, newTourney);
  }
});

// ==========================================
// ⚡ BUTTON + MODAL HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    // 📢 ANNOUNCEMENT LOGIC
    if (interaction.isButton() && interaction.customId === 'open_announce') {
      if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ No permission', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('announce_modal').setTitle('Send Announcement');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('announce_msg').setLabel('Message').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('announce_channel').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
      );
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'announce_modal') {
      const msg = interaction.fields.getTextInputValue('announce_msg');
      const targetChannel = interaction.guild.channels.cache.get(interaction.fields.getTextInputValue('announce_channel'));
      if (!targetChannel) return interaction.reply({ content: '❌ Invalid channel ID', ephemeral: true });
      await targetChannel.send({ embeds: [new EmbedBuilder().setTitle('📢 ANNOUNCEMENT').setDescription(msg).setColor('Orange').setTimestamp()] });
      return interaction.reply({ content: '✅ Announcement sent!', ephemeral: true });
    }

    // ----------------------------------------
    // 🔥 TOURNAMENT BUTTONS
    // ----------------------------------------
    if (interaction.isButton() && ['tourney_join', 'tourney_close'].includes(interaction.customId)) {
      const tourney = activeTourneys.get(interaction.message.id);
      if (!tourney) return interaction.reply({ content: '❌ Tournament data not found or already closed!', ephemeral: true });

      // 🟢 REGISTER TEAM
      if (interaction.customId === 'tourney_join') {
        if (tourney.status !== 'registering') return interaction.reply({ content: '❌ Registration is closed!', ephemeral: true });
        if (tourney.teams.length >= tourney.maxTeams) return interaction.reply({ content: '❌ Tournament is full (100/100)!', ephemeral: true });
        if (tourney.teams.find(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ You already registered a team!', ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`tmodal_${interaction.message.id}`).setTitle('Tournament Registration');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      // 🔴 CLOSE & DISTRIBUTE
      if (interaction.customId === 'tourney_close') {
        if (interaction.user.id !== tourney.hostId && !interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Only host can close registration!', ephemeral: true });
        if (tourney.teams.length === 0) return interaction.reply({ content: '❌ No teams registered yet!', ephemeral: true });

        tourney.status = 'closed';
        await interaction.reply({ content: '⏳ Closing registration, shuffling teams, and assigning roles... This might take a minute.', ephemeral: false });

        // Shuffle teams randomly
        const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
        
        const groupNames = ['A', 'B', 'C', 'D'];
        const roleMapping = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
        const groupLists = { A: [], B: [], C: [], D: [] };

        // Round-robin distribution (1st goes to A, 2nd to B, 3rd to C, 4th to D, 5th to A...)
        for (let i = 0; i < shuffled.length; i++) {
          const groupLetter = groupNames[i % 4]; 
          shuffled[i].group = groupLetter;
          groupLists[groupLetter].push(shuffled[i].name);

          // Give the specific role to the user using your hardcoded IDs
          try {
            const member = await interaction.guild.members.fetch(shuffled[i].userId);
            if (member && roleMapping[groupLetter]) {
              await member.roles.add(roleMapping[groupLetter]);
            }
          } catch (err) {
            console.warn(`⚠️ Could not assign role to user ${shuffled[i].userId}`);
          }
        }

        // Save to Database
        tourney.teams = shuffled;
        await Tourney.create({ tourneyId: tourney.tourneyId, hostId: tourney.hostId, teams: tourney.teams, status: 'grouped' });

        // Print final groups
        const finalEmbed = new EmbedBuilder()
          .setTitle(`🏆 TOURNAMENT GROUPS: ${tourney.tourneyId}`)
          .setColor('Gold')
          .addFields(
            { name: '📘 Group A', value: groupLists.A.join('\n') || 'None', inline: true },
            { name: '📕 Group B', value: groupLists.B.join('\n') || 'None', inline: true },
            { name: '\u200B', value: '\u200B' }, // Empty line break
            { name: '📗 Group C', value: groupLists.C.join('\n') || 'None', inline: true },
            { name: '📒 Group D', value: groupLists.D.join('\n') || 'None', inline: true }
          );

        await interaction.channel.send({ content: `✅ **Groups have been generated and roles assigned!**`, embeds: [finalEmbed] });
        
        tourney.message.edit({ components: [] }).catch(()=>{}); // Remove buttons
        activeTourneys.delete(interaction.message.id); // Clear from active memory
      }
    }

    // ----------------------------------------
    // 🔥 SCRIM BUTTONS
    // ----------------------------------------
    if (interaction.isButton() && ['join', 'leave', 'lock', 'end', 'result'].includes(interaction.customId)) {
      const scrim = activeScrims.get(interaction.message.id);
      if (!scrim) return interaction.reply({ content: '❌ This scrim is no longer active!', ephemeral: true });

      if (interaction.customId === 'join') {
        if (scrim.locked) return interaction.reply({ content: '❌ Scrim is locked!', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`team_modal_${interaction.message.id}`).setTitle('Enter Team Name');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Your Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'leave') {
        scrim.teams = scrim.teams.filter(t => t.userId !== interaction.user.id);
        updateEmbed(scrim);
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (member && member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.remove(SCRIM_ROLE_ID).catch(()=>{});
        return interaction.reply({ content: '❌ You left the scrim', ephemeral: true });
      }

      if (interaction.customId === 'lock') {
        if (interaction.user.id !== scrim.hostId && !interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Only host can lock!', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`room_modal_${interaction.message.id}`).setTitle('Enter Room Details');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_pass').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'end') {
        if (interaction.user.id !== scrim.hostId && !interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Only host can end!', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`end_modal_${interaction.message.id}`).setTitle('End Scrim');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('results_channel_id').setLabel('Channel ID for results').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'result') {
        if (interaction.user.id !== scrim.hostId && !interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Only host can submit results!', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`result_modal_${interaction.message.id}`).setTitle('Submit Result');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('position').setLabel('Position (1-25)').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kills').setLabel('Kills').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
    }

    // ==========================================
    // 🔥 MODAL SUBMIT LOGIC
    // ==========================================
    if (interaction.isModalSubmit()) {
      
      // 🏆 TOURNAMENT REGISTRATION MODAL
      if (interaction.customId.startsWith('tmodal_')) {
        const msgId = interaction.customId.split('_')[1];
        const tourney = activeTourneys.get(msgId);
        if (!tourney) return interaction.reply({ content: '❌ Tournament no longer active.', ephemeral: true });

        const teamName = interaction.fields.getTextInputValue('t_name');
        tourney.teams.push({ name: teamName, userId: interaction.user.id, group: null });

        const updatedEmbed = EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Registered Teams', value: `${tourney.teams.length}/${tourney.maxTeams}` });
        await tourney.message.edit({ embeds: [updatedEmbed] }).catch(()=>{});

        return interaction.reply({ content: `✅ **${teamName}** successfully registered!`, ephemeral: true });
      }

      // 🎮 SCRIM MODALS
      const parts = interaction.customId.split('_');
      if (parts.length >= 3) {
        const modalType = `${parts[0]}_${parts[1]}`;
        const msgId = parts[2];
        const scrim = activeScrims.get(msgId);

        if (!scrim && modalType !== 'announce_modal') return interaction.reply({ content: '❌ This scrim is no longer active!', ephemeral: true });

        if (modalType === 'team_modal') {
          const teamName = interaction.fields.getTextInputValue('team_name');
          if (scrim.teams.length >= scrim.maxSlots) return interaction.reply({ content: '❌ Slots full!', ephemeral: true });
          if (scrim.teams.find(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ You already joined!', ephemeral: true });

          scrim.teams.push({ name: teamName, userId: interaction.user.id });
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && !member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.add(SCRIM_ROLE_ID).catch(()=>{});

          updateEmbed(scrim);
          return interaction.reply({ content: `✅ **${teamName}** joined!`, ephemeral: true });
        }

        if (modalType === 'room_modal') {
          const roomId = interaction.fields.getTextInputValue('room_id');
          const password = interaction.fields.getTextInputValue('room_pass');
          const targetChannel = interaction.guild.channels.cache.get(interaction.fields.getTextInputValue('channel_id'));
          if (!targetChannel) return interaction.reply({ content: '❌ Invalid channel ID!', ephemeral: true });

          scrim.locked = true;
          scrim.roomId = roomId;
          scrim.password = password;

          const roomEmbed = new EmbedBuilder().setTitle('🏠 SCRIM ROOM DETAILS').setColor('Orange').addFields({ name: '🏠 Room ID', value: roomId }, { name: '🔑 Password', value: password });
          scrim.roomMessage = await targetChannel.send({ content: `<@&${SCRIM_ROLE_ID}>`, embeds: [roomEmbed] });

          let timeLeft = 300;
          const timerMessage = await targetChannel.send(`⏱️ Match starts in 5:00`);
          scrim.timerInterval = setInterval(async () => {
            timeLeft -= 30;
            if (timeLeft <= 0) {
              clearInterval(scrim.timerInterval);
              scrim.timerInterval = null;
              targetChannel.send('🚀 Match Started!').catch(()=>{});
              return;
            }
            const min = Math.floor(timeLeft / 60);
            const sec = timeLeft % 60;
            timerMessage.edit(`⏱️ Match starts in ${min}:${sec.toString().padStart(2, '0')}`).catch(() => clearInterval(scrim.timerInterval));
          }, 30000);

          updateEmbed(scrim);
          return interaction.reply({ content: '✅ Room details posted!', ephemeral: true });
        }

        if (modalType === 'result_modal') {
          const team = interaction.fields.getTextInputValue('team_name');
          const pos = parseInt(interaction.fields.getTextInputValue('position'));
          const kills = parseInt(interaction.fields.getTextInputValue('kills'));

          let points = kills;
          if (pos === 1) points += 15; else if (pos === 2) points += 12; else if (pos === 3) points += 10; else if (pos <= 5) points += 8; else if (pos <= 10) points += 5;

          scrim.results.push({ team, position: pos, kills, points });
          return interaction.reply({ content: `✅ Result saved: **${team}** (${points} pts)`, ephemeral: true });
        }

        if (modalType === 'end_modal') {
          const resultsChannel = interaction.guild.channels.cache.get(interaction.fields.getTextInputValue('results_channel_id'));
          if (!resultsChannel) return interaction.reply({ content: '❌ Invalid channel ID!', ephemeral: true });

          if (scrim.results.length > 0) {
            const sorted = [...scrim.results].sort((a, b) => b.points - a.points);
            const resultText = sorted.map((r, i) => `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`).join('\n');
            await resultsChannel.send({ embeds: [new EmbedBuilder().setTitle(`🏆 MATCH #${scrim.matchId} RESULTS`).setDescription(resultText).setColor('Gold')] });
          }

          const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
          if (logChannel) {
            const teamList = scrim.teams.length ? scrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n') : 'No teams';
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`📋 TRANSCRIPT #${scrim.matchId}`).setColor('Orange').addFields({ name: '👑 Host', value: scrim.hostName }, { name: '📋 Team List', value: teamList })] });
          }

          for (const team of scrim.teams) {
            const member = interaction.guild.members.cache.get(team.userId);
            if (member && member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.remove(SCRIM_ROLE_ID).catch(()=>{});
          }
          if (scrim.timerInterval) clearInterval(scrim.timerInterval);
          if (scrim.roomMessage) scrim.roomMessage.delete().catch(()=>{});
          scrim.message.delete().catch(()=>{});

          await Match.create({ matchId: scrim.matchId, host: scrim.hostName, teams: scrim.teams, results: scrim.results });
          activeScrims.delete(msgId);

          return interaction.reply({ content: '✅ Scrim ended, saved, and cleaned up!', ephemeral: true });
        }
      }
    }

  } catch (err) {
    if (err.code !== 10062) console.error('⚠️ Interaction error:', err.message);
  }
});

function updateEmbed(scrim) {
  const embed = new EmbedBuilder()
    .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${scrim.matchId}`)
    .setColor('Orange')
    .addFields(
      { name: '👑 Host', value: scrim.hostName },
      { name: '🎮 Slots', value: `${scrim.teams.length}/25` },
      { name: '📋 Teams', value: scrim.teams.length ? scrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n') : 'No teams yet' }
    );
  scrim.message.edit({ embeds: [embed] }).catch(()=>{});
}

client.login(process.env.DISCORD_TOKEN);
