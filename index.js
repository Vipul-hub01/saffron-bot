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
  matchId: Number, host: String, teams: Array, results: Array, createdAt: { type: Date, default: Date.now }
});
const Match = mongoose.model('Match', matchSchema);

const tourneySchema = new mongoose.Schema({
  tourneyId: String, hostId: String, maxTeams: { type: Number, default: 100 }, teams: Array, status: { type: String, default: 'registering' }, createdAt: { type: Date, default: Date.now }
});
const Tourney = mongoose.model('Tourney', tourneySchema);

let matchCounter = 0;
async function loadMatchCounter() {
  const lastMatch = await Match.findOne().sort({ matchId: -1 });
  if (lastMatch) matchCounter = lastMatch.matchId;
}

async function connectDB() {
  try { await mongoose.connect(process.env.MONGODB_URI); console.log('✅ Connected to MongoDB'); } 
  catch (err) { console.error('⚠️ MongoDB connection failed:', err.message); }
}

// ==========================================
// ⚙️ CONSTANTS & IDS 
// ==========================================
const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";
const HOST_ROLE_ID = "1488613066470981673";

const ROLE_GROUP_A = "1492126223298596864";
const ROLE_GROUP_B = "1492126277199728741";
const ROLE_GROUP_C = "1492126324930641950";
const ROLE_GROUP_D = "1492126364218953831";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const activeScrims = new Map(); 
const activeTourneys = new Map();

client.once('ready', async () => {
  await connectDB();
  await loadMatchCounter();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 📝 LOGGING HELPER
async function sendLog(guild, title, description, color = 'Grey') {
  try {
    const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel) return;
    const logEmbed = new EmbedBuilder().setTitle(`LOG: ${title}`).setDescription(description).setColor(color).setTimestamp();
    await logChannel.send({ embeds: [logEmbed] });
  } catch (err) {}
}

// ==========================================
// 🎮 MESSAGE COMMANDS
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const isStaff = message.member.permissions.has('Administrator') || message.member.roles.cache.has(HOST_ROLE_ID);
  if (!isStaff) return;

  if (cmd === 'help') {
    const embed = new EmbedBuilder().setTitle('🤖 Admin Control Panel').setColor('Blurple').addFields(
        { name: '🎮 Scrims', value: '`!createscrim`, `!history`, `!match <id>`, `!deletematch <id>`' },
        { name: '🏆 Tournament', value: '`!createtourney`' },
        { name: '🛠️ Utility', value: '`!announce`, `!idp`' }
    );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'createscrim') {
    matchCounter++;
    const newScrim = { matchId: matchCounter, teams: [], maxSlots: 25, hostId: message.author.id, hostName: message.author.username, locked: false, message: null, results: [] };
    const embed = new EmbedBuilder().setTitle(`🔥 SCRIM MATCH #${newScrim.matchId}`).setDescription('Click Join to register.').addFields({ name: '🎮 Slots', value: '0/25' }).setColor('Orange');
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
    sendLog(message.guild, 'Scrim Created', `Match #${newScrim.matchId} started by ${message.author.tag}`, 'Blue');
  }

  if (cmd === 'createtourney') {
    const tourneyId = `T-${Date.now().toString().slice(-6)}`;
    const newTourney = { tourneyId, hostId: message.author.id, teams: [], maxTeams: 100, status: 'registering', message: null };
    const embed = new EmbedBuilder().setTitle(`🏆 TOURNAMENT REGISTRATION`).setDescription(`ID: ${tourneyId}`).addFields({ name: '📊 Teams', value: '0/100' }).setColor('Purple');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tourney_join').setLabel('Register').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tourney_close').setLabel('Close & Group').setStyle(ButtonStyle.Danger)
    );
    const panelMsg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = panelMsg;
    activeTourneys.set(panelMsg.id, newTourney);
  }
});

// ==========================================
// ⚡ INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    const isStaff = interaction.member?.permissions.has('Administrator') || interaction.member?.roles.cache.has(HOST_ROLE_ID);

    // BUTTONS
    if (interaction.isButton()) {
        const scrim = activeScrims.get(interaction.message.id);
        const tourney = activeTourneys.get(interaction.message.id);

        if (interaction.customId === 'join' && scrim) {
            if (scrim.teams.find(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ You are already in!', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`team_modal_${interaction.message.id}`).setTitle('Register Team');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'tourney_join' && tourney) {
            if (tourney.teams.find(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already registered!', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`tmodal_${interaction.message.id}`).setTitle('Tournament Registration');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
        }

        // STAFF ACTIONS (End, Lock, Close)
        if (['lock', 'end', 'tourney_close'].includes(interaction.customId) && !isStaff) {
            return interaction.reply({ content: '❌ Staff Only!', ephemeral: true });
        }
        
        // ... (Rest of lock/end logic remains same as provided in previous full versions)
    }

    // MODALS
    if (interaction.isModalSubmit()) {
        // FIXED SCRIM REGISTRATION
        if (interaction.customId.startsWith('team_modal_')) {
            const msgId = interaction.customId.split('_')[2];
            const scrim = activeScrims.get(msgId);
            if (!scrim) return interaction.reply({ content: '❌ Scrim expired.', ephemeral: true });

            const teamName = interaction.fields.getTextInputValue('team_name');
            scrim.teams.push({ name: teamName, userId: interaction.user.id });

            const member = interaction.guild.members.cache.get(interaction.user.id);
            if (member) await member.roles.add(SCRIM_ROLE_ID).catch(()=>{});

            updateEmbed(scrim);
            sendLog(interaction.guild, 'Scrim Join', `**${interaction.user.tag}** joined Scrim #${scrim.matchId} as **${teamName}**`, 'Green');
            return interaction.reply({ content: `✅ Registered **${teamName}**`, ephemeral: true });
        }

        // FIXED TOURNAMENT REGISTRATION
        if (interaction.customId.startsWith('tmodal_')) {
            const msgId = interaction.customId.split('_')[1];
            const tourney = activeTourneys.get(msgId);
            if (!tourney) return interaction.reply({ content: '❌ Tournament expired.', ephemeral: true });

            const teamName = interaction.fields.getTextInputValue('t_name');
            tourney.teams.push({ name: teamName, userId: interaction.user.id });

            const updatedEmbed = EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Teams', value: `${tourney.teams.length}/100` });
            await tourney.message.edit({ embeds: [updatedEmbed] });

            sendLog(interaction.guild, 'Tourney Join', `**${interaction.user.tag}** joined Tourney ${tourney.tourneyId} as **${teamName}**`, 'Purple');
            return interaction.reply({ content: `✅ Registered **${teamName}**`, ephemeral: true });
        }
    }
  } catch (err) { console.error(err); }
});

function updateEmbed(scrim) {
  const embed = new EmbedBuilder().setTitle(`🔥 SCRIM MATCH #${scrim.matchId}`).setColor('Orange').addFields(
      { name: '👑 Host', value: scrim.hostName },
      { name: '🎮 Slots', value: `${scrim.teams.length}/25` },
      { name: '📋 Teams', value: scrim.teams.length ? scrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n') : 'No teams yet' }
  );
  scrim.message.edit({ embeds: [embed] }).catch(()=>{});
}

client.login(process.env.DISCORD_TOKEN);
