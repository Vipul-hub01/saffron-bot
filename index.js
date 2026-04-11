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
  tourneyId: Number, hostId: String, hostName: String, maxTeams: { type: Number, default: 100 }, teams: Array, status: { type: String, default: 'registering' }, createdAt: { type: Date, default: Date.now }
});
const Tourney = mongoose.model('Tourney', tourneySchema);

// 🔢 COUNTERS
let matchCounter = 0;
let tourneyCounter = 0;

async function loadCounters() {
  try {
    const lastMatch = await Match.findOne().sort({ matchId: -1 });
    matchCounter = (lastMatch && !isNaN(lastMatch.matchId)) ? lastMatch.matchId : 0;
    const lastTourney = await Tourney.findOne().sort({ tourneyId: -1 });
    tourneyCounter = (lastTourney && !isNaN(lastTourney.tourneyId)) ? lastTourney.tourneyId : 0;
    console.log(`✅ DATABASE SYNC -> Scrims: ${matchCounter}, Tourneys: ${tourneyCounter}`);
  } catch (err) { matchCounter = 0; tourneyCounter = 0; }
}

async function connectDB() {
  try { 
    await mongoose.connect(process.env.MONGODB_URI); 
    console.log('✅ Connected to MongoDB'); 
    await loadCounters();
  } catch (err) { console.error('⚠️ DB Error:', err.message); }
}

// ==========================================
// ⚙️ SETTINGS & IDS (CRITICAL: UPDATE THESE)
// ==========================================
const SCRIM_ROLE_ID = "1488611595318988850";
const HOST_ROLE_ID = "1488613066470981673";
const LOG_CHANNEL_ID = "1489298280960622805";
const REG_LOG_CHANNEL_ID = "1489298280960622805"; // Put your Player Registration Log ID here

const ROLE_GROUP_A = "1492126223298596864";
const ROLE_GROUP_B = "1492126277199728741";
const ROLE_GROUP_C = "1492126324930641950";
const ROLE_GROUP_D = "1492126364218953831";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const activeScrims = new Map(); 
const activeTourneys = new Map();

client.once('ready', () => { connectDB(); console.log(`✅ Saffron Bot is ONLINE!`); });

// 📝 HELPER FUNCTIONS
async function sendLog(guild, title, description, color = 'Grey') {
    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logChannel) return;
      const logEmbed = new EmbedBuilder().setTitle(`LOG: ${title}`).setDescription(description).setColor(color).setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    } catch (err) {}
}

function updateScrimEmbed(scrim) {
    const embed = new EmbedBuilder().setTitle(`🔥 SCRIM MATCH #${scrim.matchId}`).setColor('#e67e22').addFields(
        { name: '🎮 Slots', value: `\`${scrim.teams.length} / 25\`` },
        { name: '📋 Teams', value: scrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n') || 'No teams' }
    );
    scrim.message.edit({ embeds: [embed] }).catch(() => {});
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

  if (cmd === 'createtourney') {
    if (isNaN(tourneyCounter)) tourneyCounter = 0;
    tourneyCounter++;
    const tid = tourneyCounter;
    const nt = { tourneyId: tid, hostId: message.author.id, teams: [], maxTeams: 100, message: null };
    const embed = new EmbedBuilder().setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`).setDescription('Click Register to join. Leaders must tag players!').addFields({ name: '📊 Slots', value: `\`0 / 100\`` }).setColor('#7d5ba6');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register Team').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close & Group').setStyle(ButtonStyle.Danger)
    );
    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    nt.message = msg;
    activeTourneys.set(msg.id, nt);
  }

  if (cmd === 'createscrim') {
    matchCounter++;
    const newScrim = { matchId: matchCounter, teams: [], maxSlots: 25, hostId: message.author.id, hostName: message.author.username, results: [], message: null };
    const embed = new EmbedBuilder().setTitle(`🔥 SCRIM MATCH #${matchCounter}`).setDescription('Click buttons below to manage.').addFields({ name: '🎮 Slots', value: '`0 / 25`' }, { name: '📋 Teams', value: 'No teams joined' }).setColor('#e67e22');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('s_join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('s_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('s_lock').setLabel('Lock/IDP').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('s_end').setLabel('End').setStyle(ButtonStyle.Secondary)
    );
    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newScrim.message = msg;
    activeScrims.set(msg.id, newScrim);
  }
});

// ==========================================
// ⚡ INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
      const isStaff = interaction.member?.permissions.has('Administrator') || interaction.member?.roles.cache.has(HOST_ROLE_ID);
      const tourney = activeTourneys.get(interaction.message?.id);
      const scrim = activeScrims.get(interaction.message?.id);

      if (interaction.isButton()) {
          // --- SCRIM BUTTONS ---
          if (scrim) {
              if (interaction.customId === 's_join') {
                  if (scrim.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
                  const m = new ModalBuilder().setCustomId(`smod_j_${interaction.message.id}`).setTitle('Scrim Join');
                  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
                  return interaction.showModal(m);
              }
              if (interaction.customId === 's_leave') {
                  scrim.teams = scrim.teams.filter(t => t.userId !== interaction.user.id);
                  updateScrimEmbed(scrim);
                  return interaction.reply({ content: '✅ Left scrim.', ephemeral: true });
              }
              if (interaction.customId === 's_lock' && isStaff) {
                const m = new ModalBuilder().setCustomId(`smod_l_${interaction.message.id}`).setTitle('ID/Pass');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return interaction.showModal(m);
              }
              if (interaction.customId === 's_end' && isStaff) {
                  await Match.create({ matchId: scrim.matchId, host: scrim.hostName, teams: scrim.teams });
                  activeScrims.delete(interaction.message.id);
                  return interaction.message.delete().catch(()=>{});
              }
          }

          // --- TOURNEY BUTTONS ---
          if (tourney) {
              if (interaction.customId === 't_join') {
                  if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
                  const m = new ModalBuilder().setCustomId(`tmod_j_${interaction.message.id}`).setTitle('Tournament Registration');
                  m.addComponents(
                      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tn').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)),
                      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tp').setLabel('Players (Tag Teammates)').setStyle(TextInputStyle.Paragraph).setRequired(true))
                  );
                  return interaction.showModal(m);
              }
              if (interaction.customId === 't_leave') {
                  tourney.teams = tourney.teams.filter(t => t.userId !== interaction.user.id);
                  await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots', value: `\`${tourney.teams.length} / 100\`` })] });
                  return interaction.reply({ content: '✅ Left tournament.', ephemeral: true });
              }
              if (interaction.customId === 't_close' && isStaff) {
                  await interaction.reply({ content: '⏳ Grouping teams...' });
