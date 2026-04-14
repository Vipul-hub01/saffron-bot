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
// 🛡️ SYSTEM CRASH OVERRIDES
// ==========================================
process.on('unhandledRejection', (reason) => console.error('❌ REJECTION:', reason));
process.on('uncaughtException', (err) => console.error('❌ EXCEPTION:', err));

// ==========================================
// 🗄️ DATABASE SCHEMA
// ==========================================
const matchSchema = new mongoose.Schema({
  matchId: Number, host: String, teams: Array, results: Array, createdAt: { type: Date, default: Date.now }
});
const Match = mongoose.model('Match', matchSchema);

const tourneySchema = new mongoose.Schema({
  tourneyId: Number, hostId: String, hostName: String, maxTeams: { type: Number, default: 100 }, teams: Array, status: { type: String, default: 'registering' }, createdAt: { type: Date, default: Date.now }
});
const Tourney = mongoose.model('Tourney', tourneySchema);

// 🔢 GLOBAL COUNTERS
let matchCounter = 0;
let tourneyCounter = 0;

// ==========================================
// ⚙️ CONSTANTS & IDS (CRITICAL)
// ==========================================
const SCRIM_ROLE_ID = "1488611595318988850";
const HOST_ROLE_ID = "1488613066470981673";
const LOG_CHANNEL_ID = "1489298280960622805"; // General Staff Logs
const REG_LOG_CHANNEL_ID = "1489298280960622805"; // Player Registration Tags

const ROLE_GROUP_A = "1492126223298596864";
const ROLE_GROUP_B = "1492126277199728741";
const ROLE_GROUP_C = "1492126324930641950";
const ROLE_GROUP_D = "1492126364218953831";

// ==========================================
// 🤖 BOT INITIALIZATION
// ==========================================
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers 
    ] 
});

const activeScrims = new Map(); 
const activeTourneys = new Map();

// --- HELPER: SYNC COUNTERS ---
async function loadCounters() {
  try {
    const lastMatch = await Match.findOne().sort({ matchId: -1 });
    matchCounter = (lastMatch && !isNaN(lastMatch.matchId)) ? lastMatch.matchId : 0;
    const lastTourney = await Tourney.findOne().sort({ tourneyId: -1 });
    tourneyCounter = (lastTourney && !isNaN(lastTourney.tourneyId)) ? lastTourney.tourneyId : 0;
    console.log(`✅ SYNC COMPLETE | Scrims: ${matchCounter} | Tourneys: ${tourneyCounter}`);
  } catch (err) { console.error('⚠️ Counter Sync Failed'); }
}

// --- HELPER: DATABASE ---
async function connectDB() {
  console.log('⏳ Connecting to Database...');
  try { 
    await mongoose.connect(process.env.MONGODB_URI); 
    console.log('✅ Connected to MongoDB'); 
    await loadCounters();
  } catch (err) { console.error('❌ DB CONNECTION ERROR:', err.message); }
}

// --- HELPER: LOGS ---
async function sendLog(guild, title, description, color = '#3498db') {
    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logChannel) return;
      const logEmbed = new EmbedBuilder()
          .setTitle(`📜 SYSTEM LOG: ${title}`)
          .setDescription(description)
          .setColor(color)
          .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    } catch (err) { console.error('Log failure'); }
}

// --- HELPER: SCRIM EMBED REFRESH ---
function updateScrimEmbed(scrim) {
    const embed = new EmbedBuilder()
        .setTitle(`🔥 SCRIM MATCH #${scrim.matchId}`)
        .setColor('#e67e22')
        .setDescription(`**Host:** <@${scrim.hostId}>\n**Status:** 🔓 Registration Open`)
        .addFields(
            { name: '🎮 Slots', value: `\`${scrim.teams.length} / 25\``, inline: true },
            { name: '📋 Registered Teams', value: scrim.teams.map((t, i) => `**${i + 1}.** ${t.name}`).join('\n') || '*No teams joined yet*' }
        )
        .setFooter({ text: 'Saffron Scrims' })
        .setTimestamp();
    scrim.message.edit({ embeds: [embed] }).catch(() => {});
}

client.once('ready', () => { 
    connectDB(); 
    console.log(`🚀 Saffron Scrims Bot is Online as ${client.user.tag}`); 
});

// ==========================================
// 🎮 CORE COMMANDS
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const isStaff = message.member.permissions.has('Administrator') || message.member.roles.cache.has(HOST_ROLE_ID);
  if (!isStaff) return;

  // 🏆 TOURNAMENT START
  if (cmd === 'createtourney') {
    if (isNaN(tourneyCounter)) tourneyCounter = 0;
    tourneyCounter++;
    const tid = tourneyCounter;
    const nt = { tourneyId: tid, hostId: message.author.id, teams: [], maxTeams: 100, message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`)
        .setDescription('Click **Register Team** to participate. Leaders must tag players in the form.')
        .addFields({ name: '📊 Slots Filled', value: `\`0 / 100\`` })
        .setColor('#7d5ba6')
        .setFooter({ text: 'Tournament Management System' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register Team').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close Registration').setStyle(ButtonStyle.Danger)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    nt.message = msg;
    activeTourneys.set(msg.id, nt);
    sendLog(message.guild, 'Tournament Created', `Registration for Tournament #${tid} opened by ${message.author.tag}`, '#7d5ba6');
  }

  // 🔥 SCRIM START
  if (cmd === 'createscrim') {
    matchCounter++;
    const mid = matchCounter;
    const newScrim = { matchId: mid, hostId: message.author.id, teams: [], maxSlots: 25, results: [], message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🔥 SCRIM MATCH #${mid}`)
        .setDescription('Click Join to participate. Staff can manage results using buttons below.')
        .addFields({ name: '🎮 Slots', value: '`0 / 25`' }, { name: '📋 Teams', value: '*Waiting for entries...*' })
        .setColor('#e67e22');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('s_join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('s_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('s_lock').setLabel('Post IDP').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('s_result').setLabel('Results').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('s_end').setLabel('End Match').setStyle(ButtonStyle.Secondary)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newScrim.message = msg;
    activeScrims.set(msg.id, newScrim);
    sendLog(message.guild, 'Scrim Created', `Scrim #${mid} started by ${message.author.tag}`, '#e67e22');
  }

  // 🛠️ IDP TOOL
  if (cmd === 'idp') {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tool_idp').setLabel('Launch ID/Pass Tool').setStyle(ButtonStyle.Primary));
    message.reply({ content: 'Use the button below to send room details manually:', components: [row] });
  }

  if (cmd === 'help') {
      const embed = new EmbedBuilder().setTitle('🤖 Saffron Master Control').setColor('White').addFields(
          { name: '🎮 Scrims', value: '`!createscrim`, `!history`, `!match <id>`' },
          { name: '🏆 Tournaments', value: '`!createtourney`' },
          { name: '🛠️ Utility', value: '`!idp`, `!announce`' }
      );
      message.channel.send({ embeds: [embed] });
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
                  if (scrim.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ You are already registered for this scrim!', ephemeral: true });
                  const m = new ModalBuilder().setCustomId(`smod_j_${interaction.message.id}`).setTitle('Scrim Registration');
                  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
                  return interaction.showModal(m);
              }
              if (interaction.customId === 's_leave') {
                  scrim.teams = scrim.teams.filter(t => t.userId !== interaction.user.id);
                  updateScrimEmbed(scrim);
                  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                  if (member) await member.roles.remove(SCRIM_ROLE_ID).catch(() => {});
                  return interaction.reply({ content: '✅ You left the scrim.', ephemeral: true });
              }
              if (['s_lock', 's_result', 's_end'].includes(interaction.customId) && !isStaff) return interaction.reply({ content: '❌ Only staff can use this action.', ephemeral: true });
              
              if (interaction.customId === 's_lock') {
                const m = new ModalBuilder().setCustomId(`smod_l_${interaction.message.id}`).setTitle('Post Room Details');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Room Password').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Target Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return interaction.showModal(m);
              }
              if (interaction.customId === 's_result') {
                  const m = new ModalBuilder().setCustomId(`smod_r_${interaction.message.id}`).setTitle('Submit Results');
                  m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tn').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pos').setLabel('Position').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kl').setLabel('Kills').setStyle(TextInputStyle.Short).setRequired(true))
                  );
                  return interaction.showModal(m);
              }
              if (interaction.customId === 's_end') {
                  await interaction.reply({ content: '⏳ Match ended. Archiving data...', ephemeral: true });
                  await Match.create({ matchId: scrim.matchId, host: interaction.user.tag, teams: scrim.teams, results: scrim.results });
                  sendLog(interaction.guild, 'Scrim Ended', `Scrim Match #${scrim.matchId} finalized and saved to DB.`, 'Grey');
                  activeScrims.delete(interaction.message.id);
                  return interaction.message.delete().catch(()=>{});
              }
          }

          // --- TOURNEY BUTTONS ---
          if (tourney) {
              if (interaction.customId === 't_join') {
                  if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
                  const m = new ModalBuilder().setCustomId(`tmod_j_${interaction.message.id}`).setTitle('Team Entry');
                  m.addComponents(
                      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tn').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)),
                      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tp').setLabel('Player Tags').setStyle(TextInputStyle.Paragraph).setPlaceholder('@p1 @p2 @p3 @p4').setRequired(true))
                  );
                  return interaction.showModal(m);
              }
              if (interaction.customId === 't_leave') {
                  const idx = tourney.teams.findIndex(t => t.userId === interaction.user.id);
                  if (idx === -1) return interaction.reply({ content: '❌ Not registered!', ephemeral: true });
                  tourney.teams.splice(idx, 1);
                  await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots Filled', value: `\`${tourney.teams.length} / 100\`` })] });
                  return interaction.reply({ content: '✅ Removed from tournament.', ephemeral: true });
              }
              if (interaction.customId === 't_close' && isStaff) {
                  await interaction.reply({ content: '⏳ Closing registration and shuffling...' });
                  const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
                  const rMap = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
                  const gs = { A: [], B: [], C: [], D: [] };
                  const ns = ['A', 'B', 'C', 'D'];

                  shuffled.forEach((t, i) => {
                      t.group = ns[i % 4];
                      gs[t.group].push(`• ${t.name}`);
                  });

                  const resEmbed = new EmbedBuilder()
                      .setTitle(`🏆 TOURNAMENT #${tourney.tourneyId} - GROUPS`)
                      .setColor('Gold')
                      .addFields(
                          { name: '📘 Group A', value: gs.A.join('\n') || 'None', inline: true },
                          { name: '📕 Group B', value: gs.B.join('\n') || 'None', inline: true },
                          { name: '\u200B', value: '\u200B' },
                          { name: '📗 Group C', value: gs.C.join('\n') || 'None', inline: true },
                          { name: '📒 Group D', value: gs.D.join('\n') || 'None', inline: true }
                      );

                  await interaction.channel.send({ content: `<@&${HOST_ROLE_ID}> Groups ready!`, embeds: [resEmbed] });
                  for (const team of shuffled) {
                      const m = await interaction.guild.members.fetch(team.userId).catch(() => null);
                      if (m && rMap[team.group]) await m.roles.add(rMap[team.group]).catch(() => {});
                  }
                  await Tourney.create({ tourneyId: tourney.tourneyId, teams: shuffled, status: 'grouped' });
                  activeTourneys.delete(interaction.message.id);
                  return interaction.editReply('✅ Registration closed successfully.');
              }
          }

          if (interaction.customId === 'tool_idp' && isStaff) {
              const m = new ModalBuilder().setCustomId('tool_modal_idp').setTitle('Manual ID/Pass');
              m.addComponents(
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('ID').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Pass').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
              );
              return interaction.showModal(m);
          }
      }

      if (interaction.isModalSubmit()) {
          // --- SCRIM MODAL HANDLERS ---
          if (interaction.customId.startsWith('smod_j_')) {
              const name = interaction.fields.getTextInputValue('n');
              scrim.teams.push({ name, userId: interaction.user.id });
              const m = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
              if (m) await m.roles.add(SCRIM_ROLE_ID).catch(() => {});
              updateScrimEmbed(scrim);
              return interaction.reply({ content: `✅ Joined as **${name}**`, ephemeral: true });
          }

          if (interaction.customId.startsWith('smod_l_') || interaction.customId === 'tool_modal_idp') {
              const rid = interaction.fields.getTextInputValue('id');
              const rpw = interaction.fields.getTextInputValue('pw');
              const chid = interaction.fields.getTextInputValue('ch');
              const ch = await interaction.guild.channels.fetch(chid).catch(() => null);
              if (!ch) return interaction.reply({ content: '❌ Invalid Channel ID!', ephemeral: true });

              const emb = new EmbedBuilder().setTitle('🏠 ROOM DETAILS').setColor('Green').addFields({ name: 'ID', value: `\`${rid}\`` }, { name: 'Pass', value: `\`${rpw}\`` });
              await ch.send({ content: `<@&${SCRIM_ROLE_ID}>`, embeds: [emb] });
              return interaction.reply({ content: '✅ ID/Pass Distributed!', ephemeral: true });
          }

          // --- TOURNEY MODAL HANDLERS ---
          if (interaction.customId.startsWith('tmod_j_')) {
              const name = interaction.fields.getTextInputValue('tn');
              const tags = interaction.fields.getTextInputValue('tp');
              tourney.teams.push({ name, userId: interaction.user.id });
              await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots Filled', value: `\`${tourney.teams.length} / 100\`` })] });

              const logCh = await interaction.guild.channels.fetch(REG_LOG_CHANNEL_ID).catch(() => null);
              if (logCh) {
                  const emb = new EmbedBuilder().setTitle(`📝 REGISTRATION: #${tourney.tourneyId}`).addFields({ name: 'Team', value: name }, { name: 'Leader', value: `<@${interaction.user.id}>` }, { name: 'Players', value: tags }).setColor('Purple');
                  await logCh.send({ embeds: [emb] });
              }
              return interaction.reply({ content: '✅ Registered successfully!', ephemeral: true });
          }

          if (interaction.customId.startsWith('smod_r_')) {
              const team = interaction.fields.getTextInputValue('tn');
              scrim.results.push({ team, position: interaction.fields.getTextInputValue('pos'), kills: interaction.fields.getTextInputValue('kl') });
              return interaction.reply({ content: `✅ Result saved for ${team}`, ephemeral: true });
          }
      }
    } catch (e) { console.error('⚠️ Interaction Failure:', e); }
});

client.login(process.env.DISCORD_TOKEN);
