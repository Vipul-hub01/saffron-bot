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
    sendLog(message.guild, 'Tournament Started', `🏆 Registration opened for **Tournament #${tourneyId}**`, 'Purple');
  }

  // 🎮 CREATE SCRIM
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

  // 🛠️ UTILITY COMMANDS
  if (cmd === 'idp') {
    const button = new ButtonBuilder().setCustomId('open_idp').setLabel('Enter ID & Password').setStyle(ButtonStyle.Success);
    return message.reply({ content: 'Click to open ID/Pass form:', components: [new ActionRowBuilder().addComponents(button)] });
  }

  if (cmd === 'help') {
    const helpEmbed = new EmbedBuilder().setTitle('🤖 Saffron Bot Admin').setColor('Blurple').addFields(
        { name: 'Tournament', value: '`!createtourney`' },
        { name: 'Scrims', value: '`!createscrim`, `!history`, `!match <id>`' },
        { name: 'Utility', value: '`!idp`, `!announce`' }
    );
    message.channel.send({ embeds: [helpEmbed] });
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
          const scrim = activeScrims.get(interaction.message.id);
  
          // JOIN TOURNAMENT
          if (interaction.customId === 'tourney_join' && tourney) {
              if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already registered!', ephemeral: true });
              const modal = new ModalBuilder().setCustomId(`tmodal_${interaction.message.id}`).setTitle(`Register Team`);
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
              return interaction.showModal(modal);
          }
  
          // CLOSE TOURNAMENT (OPTIMIZED)
    if (interaction.customId === 'tourney_close' && tourney) {
        if (!isStaff) return interaction.reply({ content: '❌ Staff Only!', ephemeral: true });
        if (tourney.teams.length === 0) return interaction.reply({ content: '❌ No teams joined.', ephemeral: true });

        // 1. Immediate acknowledgement
        await interaction.reply({ content: '⏳ Shuffling teams and generating groups... please wait.', ephemeral: false });

        const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
        const groupNames = ['A', 'B', 'C', 'D'];
        const roleMapping = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
        const groupLists = { A: [], B: [], C: [], D: [] };

        // 2. Map teams to groups
        for (let i = 0; i < shuffled.length; i++) {
            const groupLetter = groupNames[i % 4];
            shuffled[i].group = groupLetter;
            groupLists[groupLetter].push(shuffled[i].name);
        }

        // 3. Create Result Embed
        const finalEmbed = new EmbedBuilder()
            .setTitle(`🏆 GROUPS FOR TOURNAMENT #${tourney.tourneyId}`)
            .setColor('Gold')
            .addFields(
                { name: '📘 Group A', value: groupLists.A.join('\n') || 'None', inline: true },
                { name: '📕 Group B', value: groupLists.B.join('\n') || 'None', inline: true },
                { name: '\u200B', value: '\u200B' },
                { name: '📗 Group C', value: groupLists.C.join('\n') || 'None', inline: true },
                { name: '📒 Group D', value: groupLists.D.join('\n') || 'None', inline: true }
            )
            .setTimestamp();

        // 4. Send the groups to the channel immediately
        await interaction.channel.send({ embeds: [finalEmbed] });

        // 5. Update the original panel to remove buttons
        if (tourney.message) await tourney.message.edit({ components: [] }).catch(() => {});

        // 6. Finalize the interaction so the "loading" stops
        await interaction.editReply({ content: `✅ Tournament #${tourney.tourneyId} Closed Successfully!` });

        // 7. BACKGROUND ROLE ASSIGNMENT (This happens after the message is sent)
        for (const team of shuffled) {
            const groupRole = roleMapping[team.group];
            if (groupRole) {
                const member = await interaction.guild.members.fetch(team.userId).catch(() => null);
                if (member) {
                    await member.roles.add(groupRole).catch(err => console.log(`Could not add role to ${team.name}: ${err.message}`));
                }
            }
        }

        // 8. Save to DB and cleanup
        await Tourney.create({ 
            tourneyId: tourney.tourneyId, 
            hostId: tourney.hostId, 
            hostName: tourney.hostName, 
            teams: shuffled, 
            status: 'grouped' 
        });
        activeTourneys.delete(interaction.message.id);
        return;
    }

          // (Join Scrim Logic)
          if (interaction.customId === 'join' && scrim) {
            if (scrim.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ Already in!', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`team_modal_${interaction.message.id}`).setTitle(`Join Scrim`);
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Team Name').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
          }
      }
  
      if (interaction.isModalSubmit()) {
          // SUBMIT TOURNAMENT MODAL
          if (interaction.customId.startsWith('tmodal_')) {
              const msgId = interaction.customId.split('_')[1];
              const tourney = activeTourneys.get(msgId);
              if (!tourney) return interaction.reply({ content: '❌ Expired.', ephemeral: true });
  
              const teamName = interaction.fields.getTextInputValue('t_name');
              tourney.teams.push({ name: teamName, userId: interaction.user.id });
  
              const updatedEmbed = EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Registered Teams', value: `${tourney.teams.length}/${tourney.maxTeams}` });
              await tourney.message.edit({ embeds: [updatedEmbed] });
              return interaction.reply({ content: `✅ Registered **${teamName}**!`, ephemeral: true });
          }

          // SUBMIT SCRIM MODAL
          if (interaction.customId.startsWith('team_modal_')) {
            const msgId = interaction.customId.split('_')[2];
            const scrim = activeScrims.get(msgId);
            if (!scrim) return interaction.reply({ content: '❌ Expired.', ephemeral: true });

            const teamName = interaction.fields.getTextInputValue('team_name');
            scrim.teams.push({ name: teamName, userId: interaction.user.id });
            
            const member = interaction.guild.members.cache.get(interaction.user.id);
            if (member) await member.roles.add(SCRIM_ROLE_ID).catch(()=>{});

            updateEmbed(scrim);
            return interaction.reply({ content: `✅ Scrim Join Success!`, ephemeral: true });
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
