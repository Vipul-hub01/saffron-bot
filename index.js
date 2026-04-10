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

// 🔢 COUNTERS (FORCE INITIALIZED)
let matchCounter = 0;
let tourneyCounter = 0;

async function loadCounters() {
  try {
    const lastMatch = await Match.findOne().sort({ matchId: -1 });
    matchCounter = (lastMatch && !isNaN(lastMatch.matchId)) ? lastMatch.matchId : 0;

    const lastTourney = await Tourney.findOne().sort({ tourneyId: -1 });
    tourneyCounter = (lastTourney && !isNaN(lastTourney.tourneyId)) ? lastTourney.tourneyId : 0;
    
    console.log(`✅ DATABASE SYNC -> Scrims: ${matchCounter}, Tourneys: ${tourneyCounter}`);
  } catch (err) {
    console.error('❌ Counter Load Failed:', err);
    matchCounter = 0;
    tourneyCounter = 0;
  }
}

async function connectDB() {
  try { 
    await mongoose.connect(process.env.MONGODB_URI); 
    console.log('✅ Connected to MongoDB'); 
    await loadCounters();
  } catch (err) { console.error('⚠️ DB Error:', err.message); }
}

// ⚙️ IDS
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

client.once('ready', () => { connectDB(); console.log(`✅ Bot Live: ${client.user.tag}`); });

// 🎮 COMMANDS
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const isStaff = message.member.permissions.has('Administrator') || message.member.roles.cache.has(HOST_ROLE_ID);
  if (!isStaff) return;

  if (cmd === 'createtourney') {
    // 🛡️ NaN PROTECTION
    if (isNaN(tourneyCounter)) tourneyCounter = 0;
    tourneyCounter++;
    
    const tid = tourneyCounter;
    const newTourney = { tourneyId: tid, hostId: message.author.id, hostName: message.author.username, teams: [], maxTeams: 100, status: 'registering', message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`)
        .setDescription(`Register your team below. Use the Leave button if you need to exit.`)
        .addFields({ name: '📊 Registered Teams', value: '0/100' })
        .setColor('Purple');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = msg;
    activeTourneys.set(msg.id, newTourney);
  }
});

// ⚡ ACTIONS
client.on('interactionCreate', async (interaction) => {
    try {
      const tourney = activeTourneys.get(interaction.message.id);
      if (!tourney && interaction.isButton()) return interaction.reply({ content: '❌ Tournament Expired.', ephemeral: true });

      if (interaction.customId === 't_join') {
          if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
          const modal = new ModalBuilder().setCustomId(`tmod_${interaction.message.id}`).setTitle('Join Tournament');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
          return interaction.showModal(modal);
      }

      if (interaction.customId === 't_leave') {
          const idx = tourney.teams.findIndex(t => t.userId === interaction.user.id);
          if (idx === -1) return interaction.reply({ content: '❌ You are not in this tournament!', ephemeral: true });
          tourney.teams.splice(idx, 1);
          const emb = EmbedBuilder.from(interaction.message.embeds[0]).setFields({ name: '📊 Registered Teams', value: `${tourney.teams.length}/100` });
          await interaction.message.edit({ embeds: [emb] });
          return interaction.reply({ content: '✅ You have left the tournament.', ephemeral: true });
      }

      if (interaction.customId === 't_close') {
          const isStaff = interaction.member.permissions.has('Administrator') || interaction.member.roles.cache.has(HOST_ROLE_ID);
          if (!isStaff) return interaction.reply({ content: '❌ Staff only!', ephemeral: true });
          
          await interaction.reply({ content: '⏳ Shuffling...' });
          const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
          const groups = { A: [], B: [], C: [], D: [] };
          const names = ['A', 'B', 'C', 'D'];

          shuffled.forEach((t, i) => groups[names[i % 4]].push(t.name));

          const res = new EmbedBuilder().setTitle(`🏆 GROUPS FOR #${tourney.tourneyId}`).setColor('Gold').addFields(
              { name: 'A', value: groups.A.join('\n') || 'None', inline: true },
              { name: 'B', value: groups.B.join('\n') || 'None', inline: true },
              { name: 'C', value: groups.C.join('\n') || 'None', inline: true },
              { name: 'D', value: groups.D.join('\n') || 'None', inline: true }
          );

          await interaction.channel.send({ embeds: [res] });
          await interaction.message.edit({ components: [] });
          activeTourneys.delete(interaction.message.id);
          return interaction.editReply('✅ Done!');
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('tmod_')) {
          const name = interaction.fields.getTextInputValue('n');
          tourney.teams.push({ name, userId: interaction.user.id });
          const emb = EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Registered Teams', value: `${tourney.teams.length}/100` });
          await tourney.message.edit({ embeds: [emb] });
          return interaction.reply({ content: `✅ Registered as ${name}`, ephemeral: true });
      }
    } catch (e) { console.error(e); }
});

client.login(process.env.DISCORD_TOKEN);
