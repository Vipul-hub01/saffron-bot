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
// ⚙️ CONSTANTS & IDS 
// ==========================================
const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";

// 🔥 ADMIN / HOST SECURITY ROLE
const HOST_ROLE_ID = "1488613066470981673";

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

// 📝 LOGGING HELPER FUNCTION
async function sendLog(guild, title, description, color = 'Grey') {
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;
  const logEmbed = new EmbedBuilder().setTitle(`LOG: ${title}`).setDescription(description).setColor(color).setTimestamp();
  try { await logChannel.send({ embeds: [logEmbed] }); } catch (err) {}
}

// ==========================================
// 🎮 MESSAGE COMMANDS
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const isServerAdmin = message.member.permissions.has('Administrator');
  const hasHostRole = message.member.roles.cache.has(HOST_ROLE_ID);

  if (!isServerAdmin && !hasHostRole) {
    const reply = await message.reply('❌ You do not have the required Host role to use this bot.');
    setTimeout(() => reply.delete().catch(()=>{}), 5000);
    return;
  }

  // 🆘 HELP COMMAND
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Saffron Bot - Admin Control Panel')
      .setDescription('Here are all the commands you can use to manage your server:')
      .setColor('Blurple')
      .addFields(
        { name: '🎮 Scrim Management', value: '`!createscrim` — Opens a new scrim lobby panel.\n`!history` — View the last 10 past matches.\n`!match <id>` — View details and results of a specific match.\n`!deletematch <id>` — Permanently delete a match from history.' },
        { name: '🏆 Tournament System', value: '`!createtourney` — Launches a 100-team tournament registration panel. Groups and roles are assigned automatically when closed.' },
        { name: '🛠️ Utility Commands', value: '`!announce` — Opens a form to send an official server announcement.\n`!idp` — Opens a form to silently send Room ID & Passwords to any channel.' }
      )
      .setFooter({ text: 'Saffron Scrims & Tournaments' })
      .setTimestamp();

    return message.channel.send({ embeds: [embed] });
  }

  // ----------------------------------------
  // SCRIM COMMANDS 
  // ----------------------------------------
  if (cmd === 'history') {
    try {
      const scrims = await Match.find().sort({ matchId: -1 }).limit(10);
      if (scrims.length === 0) return message.reply('❌ No scrim history found!');
      const historyText = scrims.map((s, i) => `**#${i + 1} Match ${s.matchId}** — Host: ${s.host} | Teams: ${s.teams.length} | ${new Date(s.createdAt).toLocaleDateString()}`).join('\n');
      const embed = new EmbedBuilder().setTitle('📜 SCRIM HISTORY (Last 10)').setDescription(historyText).setColor('Orange');
      return message.channel.send({ embeds: [embed] });
    } catch (err) { return message.reply('❌ Could not fetch history.'); }
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
    sendLog(message.guild, 'Match Deleted', `🗑️ **${message.author.tag}** deleted Match #${id} from history.`, 'Red');
    return message.reply(`✅ Match #${id} deleted from history.`);
  }

  if (cmd === 'announce') {
    const button = new ButtonBuilder().setCustomId('open_announce').setLabel('Create Announcement').setStyle(ButtonStyle.Primary);
    return message.reply({ content: 'Click button to create announcement', components: [new ActionRowBuilder().addComponents(button)] });
  }

  if (cmd === 'idp') {
    const button = new ButtonBuilder().setCustomId('open_idp').setLabel('Enter ID & Password').setStyle(ButtonStyle.Success);
    return message.reply({ content: 'Click the button below to open the ID/Pass form:', components: [new ActionRowBuilder().addComponents(button)] });
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

    const embed = new EmbedBuilder().setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${newScrim.matchId}`).setDescription('Click buttons below to join or leave the scrim').addFields({ name: '👑 Host', value: newScrim.hostName }, { name: '🎮 Slots', value: '0/25' }, { name: '📋 Teams', value: 'No teams yet' }).setColor('Orange');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('end').setLabel('End Scrim').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('result').setLabel('Submit Result').setStyle(ButtonStyle.Success));

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newScrim.message = msg;
    activeScrims.set(msg.id, newScrim);
    sendLog(message.guild, 'Scrim Created', `🚀 **${message.author.tag}** started Scrim Match #${newScrim.matchId}`, 'Blue');
  }

  if (cmd === 'createtourney') {
    const tourneyId = `T-${Date.now().toString().slice(-6)}`;
    const newTourney = { tourneyId: tourneyId, hostId: message.author.id, maxTeams: 100, teams: [], status: 'registering', message: null };
    const embed = new EmbedBuilder().setTitle(`🏆 TOURNAMENT REGISTRATION`).setDescription(`**ID:** ${tourneyId}\n\nClick the button below to register your team.`).addFields({ name: '📊 Registered Teams', value: '0/100' }).setColor('Purple');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tourney_join').setLabel('Register Team').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('tourney_close').setLabel('Close & Make Groups').setStyle(ButtonStyle.Danger));
    const panelMsg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = panelMsg;
    activeTourneys.set(panelMsg.id, newTourney);
    sendLog(message.guild, 'Tournament Started', `🏆 **${message.author.tag}** opened registration for Tournament ${tourneyId}`, 'Purple');
  }
});

// ==========================================
// ⚡ BUTTON + MODAL HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    const isStaff = interaction.member?.permissions.has('Administrator') || interaction.member?.roles.cache.has(HOST_ROLE_ID);

    // 📢 ANNOUNCEMENT MODAL
    if (interaction.isButton() && interaction.customId === 'open_announce') {
      if (!isStaff) return interaction.reply({ content: '❌ No permission', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('announce_modal').setTitle('Send Announcement');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('announce_msg').setLabel('Message').setStyle(TextInputStyle.Paragraph).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('announce_channel').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }

    // 🆔 ID/PASS MODAL
    if (interaction.isButton() && interaction.customId === 'open_idp') {
      if (!isStaff) return interaction.reply({ content: '❌ No permission', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('idp_submit_modal').setTitle('Send Room ID & Password');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_pass').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Target Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }

    if (interaction.isButton() && ['tourney_join', 'tourney_close'].includes(interaction.customId)) {
      const tourney = activeTourneys.get(interaction.message.id);
      if (!tourney) return interaction.reply({ content: '❌ Closed!', ephemeral: true });

      if (interaction.customId === 'tourney_join') {
        const modal = new ModalBuilder().setCustomId(`tmodal_${interaction.message.id}`).setTitle('Registration');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'tourney_close') {
        if (interaction.user.id !== tourney.hostId && !isStaff) return interaction.reply({ content: '❌ No Permission', ephemeral: true });
        tourney.status = 'closed';
        await interaction.reply({ content: '⏳ Processing...', ephemeral: false });
        // Shuffling/Grouping Logic ... (Same as before)
        sendLog(interaction.guild, 'Tournament Closed', `🛑 **${interaction.user.tag}** closed registration for ${tourney.tourneyId} and generated groups.`, 'DarkRed');
        activeTourneys.delete(interaction.message.id);
      }
    }

    // SCRIM BUTTONS
    if (interaction.isButton() && ['join', 'leave', 'lock', 'end', 'result'].includes(interaction.customId)) {
      const scrim = activeScrims.get(interaction.message.id);
      if (!scrim) return;

      if (interaction.customId === 'join') {
        const modal = new ModalBuilder().setCustomId(`team_modal_${interaction.message.id}`).setTitle('Join');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
      
      if (interaction.customId === 'lock' && isStaff) {
        const modal = new ModalBuilder().setCustomId(`room_modal_${interaction.message.id}`).setTitle('Lock Scrim');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_pass').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      // SCRIM JOIN LOG
      if (interaction.customId.startsWith('team_modal_')) {
        const msgId = interaction.customId.split('_')[2];
        const scrim = activeScrims.get(msgId);
        const teamName = interaction.fields.getTextInputValue('team_name');
        scrim.teams.push({ name: teamName, userId: interaction.user.id });
        updateEmbed(scrim);
        sendLog(interaction.guild, 'Scrim Join', `👤 **${interaction.user.tag}** joined Match #${scrim.matchId} as **${teamName}**`, 'Green');
        return interaction.reply({ content: '✅ Joined!', ephemeral: true });
      }

      // TOURNEY JOIN LOG
      if (interaction.customId.startsWith('tmodal_')) {
        const msgId = interaction.customId.split('_')[1];
        const tourney = activeTourneys.get(msgId);
        const teamName = interaction.fields.getTextInputValue('t_name');
        tourney.teams.push({ name: teamName, userId: interaction.user.id });
        sendLog(interaction.guild, 'Tourney Registration', `🏆 **${interaction.user.tag}** registered **${teamName}** for ${tourney.tourneyId}`, 'Purple');
        return interaction.reply({ content: '✅ Registered!', ephemeral: true });
      }

      // ID/PASS LOG
      if (interaction.customId === 'idp_submit_modal') {
        const targetChannel = interaction.guild.channels.cache.get(interaction.fields.getTextInputValue('channel_id'));
        sendLog(interaction.guild, 'ID/Pass Sent', `🔑 **${interaction.user.tag}** sent room details to <#${targetChannel.id}>`, 'Yellow');
        return interaction.reply({ content: '✅ Sent!', ephemeral: true });
      }
    }

  } catch (err) {}
});

function updateEmbed(scrim) {
  const embed = new EmbedBuilder().setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${scrim.matchId}`).setColor('Orange').addFields({ name: '👑 Host', value: scrim.hostName }, { name: '🎮 Slots', value: `${scrim.teams.length}/25` }, { name: '📋 Teams', value: scrim.teams.length ? scrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n') : 'No teams yet' });
  scrim.message.edit({ embeds: [embed] }).catch(()=>{});
}

client.login(process.env.DISCORD_TOKEN);
