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

// 🔢 COUNTERS (Initialized to 0)
let matchCounter = 0;
let tourneyCounter = 0;

async function loadCounters() {
  try {
    const lastMatch = await Match.findOne().sort({ matchId: -1 });
    matchCounter = lastMatch ? lastMatch.matchId : 0;

    const lastTourney = await Tourney.findOne().sort({ tourneyId: -1 });
    tourneyCounter = lastTourney ? lastTourney.tourneyId : 0;
    
    console.log(`✅ Counters Fixed -> Scrims: ${matchCounter}, Tourneys: ${tourneyCounter}`);
  } catch (err) {
    console.error('❌ Error loading counters:', err);
    matchCounter = 0;
    tourneyCounter = 0;
  }
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

  if (cmd === 'createtourney') {
    tourneyCounter++; // Increments safely from the loaded number
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
    sendLog(message.guild, 'Tournament Started', `🏆 Registration opened for **Tournament #${tourneyId}**`, 'Purple');
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
  }
});

// ==========================================
// ⚡ INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
      const isStaff = interaction.member?.permissions.has('Administrator') || interaction.member?.roles.cache.has(HOST_ROLE_ID);
  
      if (interaction.isButton()) {
          const tourney = activeTourneys.get(interaction.message.id);
  
          if (interaction.customId === 'tourney_join' && tourney) {
              if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already registered!', ephemeral: true });
              const modal = new ModalBuilder().setCustomId(`tmodal_${interaction.message.id}`).setTitle(`Register Team`);
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
              return interaction.showModal(modal);
          }
  
          if (interaction.customId === 'tourney_close' && tourney) {
              if (!isStaff) return interaction.reply({ content: '❌ Staff Only!', ephemeral: true });
              
              await interaction.reply({ content: '⏳ Shuffling and generating groups...', ephemeral: false });
  
              const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
              const groupNames = ['A', 'B', 'C', 'D'];
              const roleMapping = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
              const groupLists = { A: [], B: [], C: [], D: [] };
  
              for (let i = 0; i < shuffled.length; i++) {
                const groupLetter = groupNames[i % 4]; 
                shuffled[i].group = groupLetter;
                groupLists[groupLetter].push(shuffled[i].name);
              }
  
              const finalEmbed = new EmbedBuilder()
                .setTitle(`🏆 GROUPS FOR TOURNAMENT #${tourney.tourneyId}`)
                .setColor('Gold')
                .addFields(
                  { name: '📘 Group A', value: groupLists.A.join('\n') || 'None', inline: true },
                  { name: '📕 Group B', value: groupLists.B.join('\n') || 'None', inline: true },
                  { name: '\u200B', value: '\u200B' },
                  { name: '📗 Group C', value: groupLists.C.join('\n') || 'None', inline: true },
                  { name: '📒 Group D', value: groupLists.D.join('\n') || 'None', inline: true }
                );
  
              await interaction.channel.send({ embeds: [finalEmbed] });
              if (tourney.message) await tourney.message.edit({ components: [] }).catch(()=>{});
              
              // BACKGROUND ROLES
              for (const team of shuffled) {
                  const roleId = roleMapping[team.group];
                  const member = await interaction.guild.members.fetch(team.userId).catch(() => null);
                  if (member && roleId) await member.roles.add(roleId).catch(() => {});
              }

              await Tourney.create({ tourneyId: tourney.tourneyId, hostId: tourney.hostId, hostName: tourney.hostName, teams: shuffled, status: 'grouped' });
              activeTourneys.delete(interaction.message.id);
              return interaction.editReply({ content: '✅ Groups Generated!' });
          }
      }
  
      if (interaction.isModalSubmit()) {
          if (interaction.customId.startsWith('tmodal_')) {
              const msgId = interaction.customId.split('_')[1];
              const tourney = activeTourneys.get(msgId);
              if (!tourney) return interaction.reply({ content: '❌ Expired.', ephemeral: true });
  
              const teamName = interaction.fields.getTextInputValue('t_name');
              tourney.teams.push({ name: teamName, userId: interaction.user.id });
  
              const updatedEmbed = EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Registered Teams', value: `${tourney.teams.length}/${tourney.maxTeams}` });
              await tourney.message.edit({ embeds: [updatedEmbed] });
              return interaction.reply({ content: `✅ Registered!`, ephemeral: true });
          }
      }
    } catch (err) { console.error(err); }
});

client.login(process.env.DISCORD_TOKEN);
