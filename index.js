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
  tourneyId: Number, 
  hostId: String, 
  hostName: String, 
  maxTeams: { type: Number, default: 100 }, 
  teams: Array, 
  status: { type: String, default: 'registering' }, 
  createdAt: { type: Date, default: Date.now }
});
const Tourney = mongoose.model('Tourney', tourneySchema);

// 🔢 COUNTERS
let matchCounter = 0;
let tourneyCounter = 0;

async function loadCounters() {
  const lastMatch = await Match.findOne().sort({ matchId: -1 });
  if (lastMatch) matchCounter = lastMatch.matchId;

  const lastTourney = await Tourney.findOne().sort({ tourneyId: -1 });
  if (lastTourney) tourneyCounter = lastTourney.tourneyId;
  
  console.log(`📊 Counters Loaded -> Scrims: ${matchCounter}, Tourneys: ${tourneyCounter}`);
}

async function connectDB() {
  try { 
    await mongoose.connect(process.env.MONGODB_URI); 
    console.log('✅ Connected to MongoDB'); 
    await loadCounters();
  } catch (err) { 
    console.error('⚠️ MongoDB connection failed:', err.message); 
  }
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

client.once('ready', () => {
  connectDB();
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

  // 🏆 CREATE TOURNAMENT
  if (cmd === 'createtourney') {
    tourneyCounter++;
    const tourneyId = tourneyCounter; 
    const newTourney = { tourneyId, hostId: message.author.id, hostName: message.author.username, teams: [], maxTeams: 100, status: 'registering', message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🏆 TOURNAMENT REGISTRATION #${tourneyId}`)
        .setDescription(`Click the button below to register your team.`)
        .addFields({ name: '📊 Registered Teams', value: '0/100' })
        .setColor('Purple');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tourney_join').setLabel('Register Team').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tourney_close').setLabel('Close & Group').setStyle(ButtonStyle.Danger)
    );

    const panelMsg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = panelMsg;
    activeTourneys.set(panelMsg.id, newTourney);
    sendLog(message.guild, 'Tournament Started',
