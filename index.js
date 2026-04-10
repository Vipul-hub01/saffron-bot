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
    
    console.log(`✅ DB SYNC COMPLETE -> Scrims: ${matchCounter}, Tourneys: ${tourneyCounter}`);
  } catch (err) {
    matchCounter = 0; tourneyCounter = 0;
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

client.once('ready', () => { connectDB(); console.log(`✅ Saffron Bot is Online!`); });

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

  // 🆘 HELP
  if (cmd === 'help') {
      const h = new EmbedBuilder().setTitle('🤖 Admin Commands').setColor('Blue').addFields(
          { name: '🎮 Scrims', value: '`!createscrim`, `!history`, `!match <id>`' },
          { name: '🏆 Tournaments', value: '`!createtourney`' },
          { name: '🛠️ Tools', value: '`!idp`, `!announce`' }
      );
      return message.channel.send({ embeds: [h] });
  }

  // 🔥 CREATE SCRIM
  if (cmd === 'createscrim') {
    matchCounter++;
    const newScrim = { matchId: matchCounter, teams: [], maxSlots: 25, hostId: message.author.id, hostName: message.author.username, results: [], message: null, timerInterval: null };
    
    const embed = new EmbedBuilder().setTitle(`🔥 SCRIM MATCH #${matchCounter}`).setDescription('Click buttons below to manage.').addFields({ name: '🎮 Slots', value: '`0 / 25`' }, { name: '📋 Teams', value: 'No teams joined' }).setColor('#e67e22');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('s_join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('s_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('s_lock').setLabel('Lock/IDP').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('s_result').setLabel('Result').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('s_end').setLabel('End').setStyle(ButtonStyle.Secondary)
    );
    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newScrim.message = msg;
    activeScrims.set(msg.id, newScrim);
    sendLog(message.guild, 'Scrim Created', `Match #${matchCounter} started by ${message.author.tag}`, 'Blue');
  }

  // 🏆 CREATE TOURNEY
  if (cmd === 'createtourney') {
    if (isNaN(tourneyCounter)) tourneyCounter = 0;
    tourneyCounter++;
    const tid = tourneyCounter;
    const nt = { tourneyId: tid, hostId: message.author.id, teams: [], maxTeams: 100, message: null };
    
    const embed = new EmbedBuilder().setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`).setDescription('Click Register to join.').addFields({ name: '📊 Slots', value: `\`0 / 100\`` }).setColor('#7d5ba6');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );
    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    nt.message = msg;
    activeTourneys.set(msg.id, nt);
  }

  // 🛠️ IDP TOOL
  if (cmd === 'idp') {
    const b = new ButtonBuilder().setCustomId('tool_idp').setLabel('Send ID/Pass').setStyle(ButtonStyle.Success);
    return message.reply({ content: 'Click to open form:', components: [new ActionRowBuilder().addComponents(b)] });
  }
});

// ==========================================
// ⚡ INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
      const isStaff = interaction.member?.permissions.has('Administrator') || interaction.member?.roles.cache.has(HOST_ROLE_ID);
      const scrim = activeScrims.get(interaction.message?.id);
      const tourney = activeTourneys.get(interaction.message?.id);

      // --- SCRIM BUTTONS ---
      if (scrim && interaction.isButton()) {
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
          if (['s_lock', 's_result', 's_end'].includes(interaction.customId) && !isStaff) return interaction.reply({ content: '❌ Staff Only', ephemeral: true });
          
          if (interaction.customId === 's_lock') {
              const m = new ModalBuilder().setCustomId(`smod_l_${interaction.message.id}`).setTitle('Lock & ID/Pass');
              m.addComponents(
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
              );
              return interaction.showModal(m);
          }
          if (interaction.customId === 's_result') {
              const m = new ModalBuilder().setCustomId(`smod_r_${interaction.message.id}`).setTitle('Submit Result');
              m.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tn').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pos').setLabel('Position (1-25)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kl').setLabel('Kills').setStyle(TextInputStyle.Short).setRequired(true))
              );
              return interaction.showModal(m);
          }
          if (interaction.customId === 's_end') {
              await interaction.reply({ content: '⏳ Saving and cleaning up...', ephemeral: true });
              await Match.create({ matchId: scrim.matchId, host: scrim.hostName, teams: scrim.teams, results: scrim.results });
              if (scrim.timerInterval) clearInterval(scrim.timerInterval);
              await interaction.message.delete().catch(()=>{});
              activeScrims.delete(interaction.message.id);
          }
      }

      // --- TOURNEY BUTTONS ---
      if (tourney && interaction.isButton()) {
          if (interaction.customId === 't_join') {
              if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
              const m = new ModalBuilder().setCustomId(`tmod_j_${interaction.message.id}`).setTitle('Tourney Join');
              m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
              return interaction.showModal(m);
          }
          if (interaction.customId === 't_leave') {
              const idx = tourney.teams.findIndex(t => t.userId === interaction.user.id);
              if (idx === -1) return interaction.reply({ content: '❌ Not in list!', ephemeral: true });
              tourney.teams.splice(idx, 1);
              await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots', value: `\`${tourney.teams.length} / 100\`` })] });
              return interaction.reply({ content: '✅ Left tourney.', ephemeral: true });
          }
          if (interaction.customId === 't_close') {
              if (!isStaff) return interaction.reply({ content: '❌ Staff Only', ephemeral: true });
              await interaction.reply({ content: '⏳ Generating Groups...' });
              const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
              const rMap = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
              const gs = { A: [], B: [], C: [], D: [] };
              const ns = ['A', 'B', 'C', 'D'];

              shuffled.forEach((t, i) => {
                  t.group = ns[i % 4];
                  gs[t.group].push(`• ${t.name}`);
              });

              const res = new EmbedBuilder().setTitle(`🏆 GROUPS FOR #${tourney.tourneyId}`).setColor('Gold').addFields(
                  { name: '📘 Group A', value: gs.A.join('\n') || 'None', inline: true },
                  { name: '📕 Group B', value: gs.B.join('\n') || 'None', inline: true },
                  { name: '📗 Group C', value: gs.C.join('\n') || 'None', inline: true },
                  { name: '📒 Group D', value: gs.D.join('\n') || 'None', inline: true }
              );

              await interaction.channel.send({ embeds: [res] });
              await interaction.message.edit({ components: [] });

              for (const team of shuffled) {
                  const mem = await interaction.guild.members.fetch(team.userId).catch(() => null);
                  if (mem && rMap[team.group]) await mem.roles.add(rMap[team.group]).catch(() => {});
              }
              activeTourneys.delete(interaction.message.id);
          }
      }

      // --- UTILITY TOOLS ---
      if (interaction.customId === 'tool_idp' && isStaff) {
          const m = new ModalBuilder().setCustomId('tool_modal_idp').setTitle('Manual ID/Pass');
          m.addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
          );
          return interaction.showModal(m);
      }

      // --- MODAL SUBMISSIONS ---
      if (interaction.isModalSubmit()) {
          const name = interaction.fields.getTextInputValue('n') || interaction.fields.getTextInputValue('tn');
          
          if (interaction.customId.startsWith('smod_j_')) {
              scrim.teams.push({ name, userId: interaction.user.id });
              updateScrimEmbed(scrim);
              return interaction.reply({ content: `✅ Joined scrim as ${name}`, ephemeral: true });
          }
          if (interaction.customId.startsWith('tmod_j_')) {
              tourney.teams.push({ name, userId: interaction.user.id });
              await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots', value: `\`${tourney.teams.length} / 100\`` })] });
              return interaction.reply({ content: `✅ Registered as ${name}`, ephemeral: true });
          }
          if (interaction.customId.startsWith('smod_l_')) {
              const id = interaction.fields.getTextInputValue('id');
              const pw = interaction.fields.getTextInputValue('pw');
              const ch = interaction.guild.channels.cache.get(interaction.fields.getTextInputValue('ch'));
              if (!ch) return interaction.reply({ content: '❌ Invalid Channel', ephemeral: true });
              
              const emb = new EmbedBuilder().setTitle('🏠 ROOM DETAILS').setColor('Green').addFields({ name: 'ID', value: id }, { name: 'Pass', value: pw });
              await ch.send({ embeds: [emb] });
              return interaction.reply({ content: '✅ ID/Pass Sent', ephemeral: true });
          }
          if (interaction.customId === 'tool_modal_idp') {
              const ch = interaction.guild.channels.cache.get(interaction.fields.getTextInputValue('ch'));
              const emb = new EmbedBuilder().setTitle('🏠 ROOM DETAILS').setColor('Green').addFields({ name: 'ID', value: interaction.fields.getTextInputValue('id') }, { name: 'Pass', value: interaction.fields.getTextInputValue('pw') });
              await ch.send({ embeds: [emb] });
              return interaction.reply({ content: '✅ Sent!', ephemeral: true });
          }
          if (interaction.customId.startsWith('smod_r_')) {
              const team = interaction.fields.getTextInputValue('tn');
              const pos = interaction.fields.getTextInputValue('pos');
              const kills = interaction.fields.getTextInputValue('kl');
              scrim.results.push({ team, position: pos, kills });
              return interaction.reply({ content: `✅ Result saved for ${team}`, ephemeral: true });
          }
      }
    } catch (e) { console.error(e); }
});

function updateScrimEmbed(scrim) {
  const embed = new EmbedBuilder().setTitle(`🔥 SCRIM MATCH #${scrim.matchId}`).setColor('#e67e22').addFields(
      { name: '🎮 Slots', value: `\`${scrim.teams.length} / 25\`` },
      { name: '📋 Teams', value: scrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n') || 'No teams' }
  );
  scrim.message.edit({ embeds: [embed] }).catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
