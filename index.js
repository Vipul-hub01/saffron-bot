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
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const mongoose = require('mongoose');

// ==========================================
// 🛡️ SYSTEM ERROR & CRASH LOGGING
// ==========================================
process.on('unhandledRejection', (reason) => {
    console.error('❌ GLOBAL REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('❌ GLOBAL EXCEPTION:', err);
});

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

// 🔢 GLOBAL COUNTERS
let matchCounter = 0;
let tourneyCounter = 0;

// ==========================================
// ⚙️ SETTINGS & IDS (CRITICAL)
// ==========================================
const SCRIM_ROLE_ID = "1488611595318988850";
const HOST_ROLE_ID = "1488613066470981673";
const LOG_CHANNEL_ID = "1489298280960622805"; 
const REG_LOG_CHANNEL_ID = "1489298280960622805"; 

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
    console.log(`✅ DATABASE SYNC -> Scrims: ${matchCounter}, Tourneys: ${tourneyCounter}`);
  } catch (err) { console.error('⚠️ Counter Sync Failed'); }
}

async function connectDB() {
  try { 
    await mongoose.connect(process.env.MONGODB_URI); 
    console.log('✅ Connected to MongoDB'); 
    await loadCounters();
  } catch (err) { console.error('❌ DB CONNECTION ERROR:', err.message); }
}

// --- HELPER: LOGGING SYSTEM ---
async function sendLog(guild, title, description, color = '#3498db') {
    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logChannel) return;
      const logEmbed = new EmbedBuilder()
          .setTitle(`📜 LOG: ${title}`)
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
            { name: '📋 Registered Teams', value: scrim.teams.map((t, i) => `**${i + 1}.** ${t.name}`).join('\n') || '*Waiting for teams...*' }
        )
        .setFooter({ text: 'Saffron Scrims' })
        .setTimestamp();
    scrim.message.edit({ embeds: [embed] }).catch(() => {});
}

client.once('ready', () => { connectDB(); console.log(`🚀 Saffron Bot Live as ${client.user.tag}`); });

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
    
    const embed = new EmbedBuilder()
        .setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`)
        .setDescription('Click **Register Team** to enter. Leaders must tag players in the form.')
        .addFields({ name: '📊 Slots Filled', value: `\`0 / 100\`` })
        .setColor('#7d5ba6')
        .setFooter({ text: 'Saffron Esports Management' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register Team').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close & Group').setStyle(ButtonStyle.Danger)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    nt.message = msg;
    activeTourneys.set(msg.id, nt);
    sendLog(message.guild, 'Tournament Created', `Tournament #${tid} started by ${message.author.tag}`, '#7d5ba6');
  }

  if (cmd === 'createscrim') {
    matchCounter++;
    const mid = matchCounter;
    const newScrim = { matchId: mid, hostId: message.author.id, teams: [], results: [], message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🔥 SCRIM MATCH #${mid}`)
        .setDescription('Click Join to enter. Staff will post ID/Pass when slots are full.')
        .addFields({ name: '🎮 Slots', value: '`0 / 25`' }, { name: '📋 Teams', value: '*Empty*' })
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

  if (cmd === 'idp') {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tool_idp').setLabel('Manual IDP Tool').setStyle(ButtonStyle.Primary));
    message.reply({ content: 'Launch the ID/Pass tool:', components: [row] });
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

      // --- BUTTON INTERACTIONS ---
      if (interaction.isButton()) {
          // SCRIM BUTTONS
          if (scrim) {
              if (interaction.customId === 's_join') {
                  if (scrim.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
                  const m = new ModalBuilder().setCustomId(`smod_j_${interaction.message.id}`).setTitle('Scrim Entry');
                  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
                  return interaction.showModal(m);
              }
              if (interaction.customId === 's_leave') {
                  const team = scrim.teams.find(t => t.userId === interaction.user.id);
                  if (!team) return interaction.reply({ content: '❌ Not in scrim!', ephemeral: true });
                  scrim.teams = scrim.teams.filter(t => t.userId !== interaction.user.id);
                  updateScrimEmbed(scrim);
                  sendLog(interaction.guild, 'Scrim Leave', `${interaction.user.tag} left Scrim #${scrim.matchId}`, 'Orange');
                  return interaction.reply({ content: '✅ You left the scrim.', ephemeral: true });
              }
              if (['s_lock', 's_result', 's_end'].includes(interaction.customId) && !isStaff) return interaction.reply({ content: '❌ Staff Only', ephemeral: true });
              
              if (interaction.customId === 's_lock') {
                const m = new ModalBuilder().setCustomId(`smod_l_${interaction.message.id}`).setTitle('Distribute IDP');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return interaction.showModal(m);
              }
              if (interaction.customId === 's_result') {
                  if (scrim.teams.length === 0) return interaction.reply({ content: '❌ No teams to record!', ephemeral: true });
                  const menu = new StringSelectMenuBuilder().setCustomId(`s_select_${interaction.message.id}`).setPlaceholder('Select Team');
                  scrim.teams.forEach(t => menu.addOptions({ label: t.name, value: t.userId }));
                  return interaction.reply({ content: 'Record results for:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
              }
              if (interaction.customId === 's_end') {
                  await interaction.reply({ content: '⏳ Archiving...', ephemeral: true });
                  await Match.create({ matchId: scrim.matchId, host: interaction.user.tag, teams: scrim.teams, results: scrim.results });
                  sendLog(interaction.guild, 'Scrim Saved', `Match #${scrim.matchId} finalized.`, 'Grey');
                  activeScrims.delete(interaction.message.id);
                  return interaction.message.delete().catch(()=>{});
              }
          }

          // TOURNEY BUTTONS
          if (tourney) {
              if (interaction.customId === 't_join') {
                  if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
                  const m = new ModalBuilder().setCustomId(`tmod_j_${interaction.message.id}`).setTitle('Tournament Entry');
                  m.addComponents(
                      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tn').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)),
                      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tp').setLabel('Teammates (Tag them)').setStyle(TextInputStyle.Paragraph).setRequired(true))
                  );
                  return interaction.showModal(m);
              }
              if (interaction.customId === 't_leave') {
                  const idx = tourney.teams.findIndex(t => t.userId === interaction.user.id);
                  if (idx === -1) return interaction.reply({ content: '❌ Not in!', ephemeral: true });
                  tourney.teams.splice(idx, 1);
                  await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots Filled', value: `\`${tourney.teams.length} / 100\`` })] });
                  return interaction.reply({ content: '✅ Left tournament.', ephemeral: true });
              }
              if (interaction.customId === 't_close' && isStaff) {
                  await interaction.reply({ content: '⏳ Grouping...' });
                  const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
                  const rMap = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
                  const gs = { A: [], B: [], C: [], D: [] };
                  const ns = ['A', 'B', 'C', 'D'];

                  shuffled.forEach((t, i) => {
                      t.group = ns[i % 4];
                      gs[t.group].push(`• ${t.name}`);
                  });

                  const resEmbed = new EmbedBuilder().setTitle(`🏆 GROUPS FOR #${tourney.tourneyId}`).setColor('Gold').addFields(
                      { name: 'Group A', value: gs.A.join('\n') || 'None', inline: true },
                      { name: 'Group B', value: gs.B.join('\n') || 'None', inline: true },
                      { name: 'Group C', value: gs.C.join('\n') || 'None', inline: true },
                      { name: 'Group D', value: gs.D.join('\n') || 'None', inline: true }
                  );
                  await interaction.channel.send({ content: `<@&${HOST_ROLE_ID}> Groups ready!`, embeds: [resEmbed] });
                  for (const team of shuffled) {
                      const mem = await interaction.guild.members.fetch(team.userId).catch(() => null);
                      if (mem && rMap[team.group]) await mem.roles.add(rMap[team.group]).catch(() => {});
                  }
                  activeTourneys.delete(interaction.message.id);
                  return interaction.editReply('✅ Registration closed.');
              }
          }

          if (interaction.customId === 'tool_idp' && isStaff) {
              const m = new ModalBuilder().setCustomId('tool_modal_idp').setTitle('Manual IDP');
              m.addComponents(
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('ID').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pw').setLabel('Pass').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true))
              );
              return interaction.showModal(m);
          }
      }

      // --- DROPDOWN SELECTION HANDLER ---
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('s_select_')) {
          const msgId = interaction.customId.split('_')[2];
          const uid = interaction.values[0];
          const s = activeScrims.get(msgId);
          const tName = s.teams.find(t => t.userId === uid).name;
          const m = new ModalBuilder().setCustomId(`smod_r_${msgId}_${uid}`).setTitle(`Results: ${tName}`);
          m.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pos').setLabel('Position').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kl').setLabel('Kills').setStyle(TextInputStyle.Short).setRequired(true))
          );
          return interaction.showModal(m);
      }

      // --- MODAL SUBMISSIONS ---
      if (interaction.isModalSubmit()) {
          // SCRIM JOIN
          if (interaction.customId.startsWith('smod_j_')) {
              const n = interaction.fields.getTextInputValue('n');
              scrim.teams.push({ name: n, userId: interaction.user.id });
              const mem = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
              if (mem) await mem.roles.add(SCRIM_ROLE_ID).catch(() => {});
              updateScrimEmbed(scrim);
              sendLog(interaction.guild, 'Scrim Entry', `${interaction.user.tag} joined Match #${scrim.matchId} as ${n}`, 'Green');
              return interaction.reply({ content: `✅ Joined as ${n}`, ephemeral: true });
          }
          // IDP + SLOT LIST
          if (interaction.customId.startsWith('smod_l_') || interaction.customId === 'tool_modal_idp') {
              const rid = interaction.fields.getTextInputValue('id');
              const rpw = interaction.fields.getTextInputValue('pw');
              const ch = await interaction.guild.channels.fetch(interaction.fields.getTextInputValue('ch')).catch(() => null);
              if (!ch) return interaction.reply({ content: '❌ Channel Error', ephemeral: true });

              const slots = (scrim && scrim.teams.length > 0) ? scrim.teams.map((t, i) => `**Slot ${i + 1}:** ${t.name}`).join('\n') : 'No teams listed';
              const emb = new EmbedBuilder().setTitle('🏠 ROOM & SLOT LIST').setColor('Green')
                  .addFields({ name: 'ID', value: `\`${rid}\``, inline: true }, { name: 'Pass', value: `\`${rpw}\``, inline: true }, { name: '📋 Slots', value: slots });
              await ch.send({ content: `<@&${SCRIM_ROLE_ID}>`, embeds: [emb] });
              return interaction.reply({ content: '✅ IDP & Slots Sent!', ephemeral: true });
          }
          // TOURNEY JOIN + LOGGING
          if (interaction.customId.startsWith('tmod_j_')) {
              const tn = interaction.fields.getTextInputValue('tn');
              const tp = interaction.fields.getTextInputValue('tp');
              tourney.teams.push({ name: tn, userId: interaction.user.id });
              await tourney.message.edit({ embeds: [EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots Filled', value: `\`${tourney.teams.length} / 100\`` })] });
              const log = await interaction.guild.channels.fetch(REG_LOG_CHANNEL_ID).catch(() => null);
              if (log) {
                  const emb = new EmbedBuilder().setTitle('📝 NEW REGISTRATION').addFields({ name: 'Team', value: tn }, { name: 'Leader', value: `<@${interaction.user.id}>` }, { name: 'Players', value: tp }).setColor('Purple').setTimestamp();
                  await log.send({ embeds: [emb] });
              }
              return interaction.reply({ content: `✅ Registered **${tn}**!`, ephemeral: true });
          }
          // RESULT RECORDING
          if (interaction.customId.startsWith('smod_r_')) {
              const mid = interaction.customId.split('_')[2];
              const uid = interaction.customId.split('_')[3];
              const sData = activeScrims.get(mid);
              const teamName = sData.teams.find(t => t.userId === uid).name;
              sData.results.push({ team: teamName, position: interaction.fields.getTextInputValue('pos'), kills: interaction.fields.getTextInputValue('kl') });
              return interaction.reply({ content: `✅ Result saved for **${teamName}**`, ephemeral: true });
          }
      }
    } catch (e) { console.error('Interaction Error:', e); }
});

client.login(process.env.DISCORD_TOKEN);
