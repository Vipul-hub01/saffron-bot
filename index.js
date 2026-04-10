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
const tourneySchema = new mongoose.Schema({
  tourneyId: Number, hostId: String, hostName: String, maxTeams: { type: Number, default: 100 }, teams: Array, status: { type: String, default: 'registering' }, createdAt: { type: Date, default: Date.now }
});
const Tourney = mongoose.model('Tourney', tourneySchema);

// 🔢 COUNTERS
let tourneyCounter = 0;

async function loadCounters() {
  try {
    const lastTourney = await Tourney.findOne().sort({ tourneyId: -1 });
    tourneyCounter = (lastTourney && !isNaN(lastTourney.tourneyId)) ? lastTourney.tourneyId : 0;
    console.log(`✅ DATABASE SYNC -> Tourneys: ${tourneyCounter}`);
  } catch (err) {
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

// ⚙️ ROLE IDS (Ensure these are correct!)
const HOST_ROLE_ID = "1488613066470981673";
const ROLE_GROUP_A = "1492126223298596864";
const ROLE_GROUP_B = "1492126277199728741";
const ROLE_GROUP_C = "1492126324930641950";
const ROLE_GROUP_D = "1492126364218953831";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const activeTourneys = new Map();

client.once('ready', () => { connectDB(); console.log(`✅ Saffron Bot Live!`); });

// 🎮 COMMANDS
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
    const newTourney = { tourneyId: tid, hostId: message.author.id, hostName: message.author.username, teams: [], maxTeams: 100, status: 'registering', message: null };
    
    const embed = new EmbedBuilder()
        .setTitle(`🏆 TOURNAMENT REGISTRATION #${tid}`)
        .setDescription('**Welcome to Saffron Tournaments!**\n\nClick the button below to register your team. If you need to cancel, use the Leave button.')
        .addFields({ name: '📊 Slots Filled', value: `\`0 / 100\``, inline: true })
        .setColor('#7d5ba6')
        .setFooter({ text: 'Saffron Scrims Bot • Registration Phase' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('t_join').setLabel('Register').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('t_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('t_close').setLabel('Close & Group').setStyle(ButtonStyle.Danger)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    newTourney.message = msg;
    activeTourneys.set(msg.id, newTourney);
  }
});

// ⚡ INTERACTION HANDLER
client.on('interactionCreate', async (interaction) => {
    try {
      const tourney = activeTourneys.get(interaction.message.id);
      if (!tourney && interaction.isButton()) return interaction.reply({ content: '❌ Tournament session expired.', ephemeral: true });

      // REGISTER
      if (interaction.customId === 't_join') {
          if (tourney.teams.some(t => t.userId === interaction.user.id)) return interaction.reply({ content: '❌ You are already in!', ephemeral: true });
          const modal = new ModalBuilder().setCustomId(`tmod_${interaction.message.id}`).setTitle('Team Registration');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('n').setLabel('Your Team Name').setStyle(TextInputStyle.Short).setPlaceholder('Enter name here...').setRequired(true)));
          return interaction.showModal(modal);
      }

      // LEAVE
      if (interaction.customId === 't_leave') {
          const idx = tourney.teams.findIndex(t => t.userId === interaction.user.id);
          if (idx === -1) return interaction.reply({ content: '❌ You are not registered!', ephemeral: true });
          tourney.teams.splice(idx, 1);
          const emb = EmbedBuilder.from(interaction.message.embeds[0]).setFields({ name: '📊 Slots Filled', value: `\`${tourney.teams.length} / 100\``, inline: true });
          await interaction.message.edit({ embeds: [emb] });
          return interaction.reply({ content: '✅ You have left the tournament.', ephemeral: true });
      }

      // CLOSE & GROUP
      if (interaction.customId === 't_close') {
          const isStaff = interaction.member.permissions.has('Administrator') || interaction.member.roles.cache.has(HOST_ROLE_ID);
          if (!isStaff) return interaction.reply({ content: '❌ Only Staff can close tournaments.', ephemeral: true });
          if (tourney.teams.length === 0) return interaction.reply({ content: '❌ Cannot close an empty tournament!', ephemeral: true });
          
          await interaction.reply({ content: '⏳ **Closing registration and shuffling teams...**' });

          const shuffled = [...tourney.teams].sort(() => Math.random() - 0.5);
          const roleMap = { A: ROLE_GROUP_A, B: ROLE_GROUP_B, C: ROLE_GROUP_C, D: ROLE_GROUP_D };
          const groups = { A: [], B: [], C: [], D: [] };
          const groupNames = ['A', 'B', 'C', 'D'];

          // Divide and Store
          for (let i = 0; i < shuffled.length; i++) {
              const letter = groupNames[i % 4];
              shuffled[i].group = letter;
              groups[letter].push(`• ${shuffled[i].name}`);
          }

          // Build Final Embed
          const resEmbed = new EmbedBuilder()
              .setTitle(`🏆 TOURNAMENT #${tourney.tourneyId} - FINAL GROUPS`)
              .setDescription('Teams have been randomly shuffled into 4 groups. Roles are being assigned now!')
              .setColor('#FFD700')
              .addFields(
                  { name: '📘 Group A', value: groups.A.join('\n') || '*Empty*', inline: true },
                  { name: '📕 Group B', value: groups.B.join('\n') || '*Empty*', inline: true },
                  { name: '\u200B', value: '\u200B' }, // Spacer
                  { name: '📗 Group C', value: groups.C.join('\n') || '*Empty*', inline: true },
                  { name: '📒 Group D', value: groups.D.join('\n') || '*Empty*', inline: true }
              )
              .setFooter({ text: 'Saffron Esports • Good luck to all teams!' })
              .setTimestamp();

          await interaction.channel.send({ embeds: [resEmbed] });
          await interaction.message.edit({ components: [] });

          // Background Role Distribution
          for (const team of shuffled) {
              try {
                  const targetRole = roleMap[team.group];
                  const member = await interaction.guild.members.fetch(team.userId).catch(() => null);
                  if (member && targetRole) await member.roles.add(targetRole);
              } catch (e) { console.error(`Role Error: ${e.message}`); }
          }

          activeTourneys.delete(interaction.message.id);
          return interaction.editReply('✅ **Success! Groups generated and roles assigned.**');
      }

      // MODAL SUBMISSION
      if (interaction.isModalSubmit() && interaction.customId.startsWith('tmod_')) {
          const name = interaction.fields.getTextInputValue('n');
          tourney.teams.push({ name, userId: interaction.user.id });
          const emb = EmbedBuilder.from(tourney.message.embeds[0]).setFields({ name: '📊 Slots Filled', value: `\`${tourney.teams.length} / 100\``, inline: true });
          await tourney.message.edit({ embeds: [emb] });
          return interaction.reply({ content: `✅ Registered successfully as **${name}**`, ephemeral: true });
      }
    } catch (e) { console.error(e); }
});

client.login(process.env.DISCORD_TOKEN);
