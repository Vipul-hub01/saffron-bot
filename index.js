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
  } catch (err) {
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

// ⚙️ ROLE & CHANNEL IDS
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

client.once('ready', () => { connectDB(); console.log(`✅ Saffron Bot Live!`); });

// 🎮 COMMANDS
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const isStaff = message.member.permissions.has('Administrator') || message.member.roles.cache.has(HOST_ROLE_ID);
  if (!isStaff) return;

  // 🏆 TOURNAMENT COMMAND
  if (cmd === 'createtourney') {
    if (isNaN(tourneyCounter)) tourneyCounter = 0;
    tourneyCounter++;
    const tid = tourneyCounter;
    const newTourney = { tourneyId: tid, hostId: message.author.id, teams: [], maxTeams: 100, message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`)
        .setDescription('Click Register to join. Groups will be auto-generated.')
        .addFields({ name: '📊 Slots', value: `\`0 / 100\``, inline: true })
        .setColor('#7d5ba6');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = msg;
    activeTourneys.set(msg.id, newTourney);
  }

  // 🔥 SCRIM COMMAND
  if (cmd === 'createscrim') {
    matchCounter++;
    const newScrim = { matchId: matchCounter, teams: [], maxSlots: 25, hostId: message.author.id, hostName: message.author.username, message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🔥 SCRIM MATCH #${matchCounter}`)
        .setDescription('Click Join to participate in the scrim.')
        .addFields({ name: '🎮 Slots', value: `\`0 / 25\`` }, { name: '📋 Teams', value: 'No teams yet' })
        .setColor('#e67e22');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('s_join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('s_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('s_end').setLabel('End Scrim').setStyle(ButtonStyle.Secondary)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newScrim.message = msg;
    activeScrims.set(msg.id, newScrim);
  }
});

// ⚡ INTERACTION HANDLER
client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton() && !interaction.isModalSubmit()) return;

      const tourney = activeTourneys.get(interaction.message?.id);
      const scrim = activeScrims.get(interaction.message?.id);

      // --- TOURNAMENT LOGIC ---
      if (interaction.customId === 't_join') {
          if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
          const modal = new ModalBuilder().setCustomId(`tmod_${interaction.message.id}`).setTitle('Tournament Join');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
          return interaction.showModal(modal);
      }

      if (interaction.customId === 't_leave') {
          const idx = tourney.teams.findIndex(t => t.userId === interaction.user.id);
          if (idx === -1) return interaction.reply({ content: '❌ Not in list!', ephemeral: true });
          tourney.teams.splice(idx, 1);
          await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setFields({ name: '📊 Slots', value: `\`${tourney.teams.length} / 100\`` })] });
          return interaction.reply({ content: '✅ Left tournament.', ephemeral: true });
      }

      if (interaction.customId === 't_close') {
          const isStaff = interaction.member.permissions.has('Administrator') || interaction.member.roles.cache.has(HOST_ROLE_ID);
          if (!isStaff) return interaction.reply({ content: '❌ Staff only!', ephemeral: true });
          
          await interaction.reply({ content: '⏳ Grouping teams...' });
          const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
          const roleMap = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
          const groups = { A: [], B: [], C: [], D: [] };
          const names = ['A', 'B', 'C', 'D'];

          shuffled.forEach((t, i) => {
              const letter = names[i % 4];
              t.group = letter;
              groups[letter].push(`• ${t.name}`);
          });

          const resEmbed = new EmbedBuilder().setTitle(`🏆 GROUPS FOR #${tourney.tourneyId}`).setColor('#FFD700').addFields(
              { name: '📘 Group A', value: groups.A.join('\n') || 'None', inline: true },
              { name: '📕 Group B', value: groups.B.join('\n') || 'None', inline: true },
              { name: '📗 Group C', value: groups.C.join('\n') || 'None', inline: true },
              { name: '📒 Group D', value: groups.D.join('\n') || 'None', inline: true }
          );

          await interaction.channel.send({ embeds: [resEmbed] });
          await interaction.message.edit({ components: [] });

          for (const team of shuffled) {
              const member = await interaction.guild.members.fetch(team.userId).catch(() => null);
              if (member && roleMap[team.group]) await member.roles.add(roleMap[team.group]).catch(() => {});
          }
          activeTourneys.delete(interaction.message.id);
          return interaction.editReply('✅ Finished!');
      }

      // --- SCRIM LOGIC ---
      if (interaction.customId === 's_join') {
          if (scrim.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already joined!', ephemeral: true });
          const modal = new ModalBuilder().setCustomId(`smod_${interaction.message.id}`).setTitle('Scrim Join');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
          return interaction.showModal(modal);
      }

      if (interaction.customId === 's_leave') {
          scrim.teams = scrim.teams.filter(t => t.userId !== interaction.user.id);
          updateScrimEmbed(scrim);
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member) await member.roles.remove(SCRIM_ROLE_ID).catch(() => {});
          return interaction.reply({ content: '✅ Left scrim.', ephemeral: true });
      }

      if (interaction.customId === 's_end') {
          const isStaff = interaction.member.permissions.has('Administrator') || interaction.member.roles.cache.has(HOST_ROLE_ID);
          if (!isStaff) return interaction.reply({ content: '❌ Staff only!', ephemeral: true });
          
          await Match.create({ matchId: scrim.matchId, host: scrim.hostName, teams:
