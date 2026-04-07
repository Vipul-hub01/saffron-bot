require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const mongoose = require('mongoose');

// 🗄️ MONGOOSE MATCH MODEL
const matchSchema = new mongoose.Schema({
  matchId: Number,
  host: String,
  teams: Array,
  results: Array,
  createdAt: { type: Date, default: Date.now }
});
const Match = mongoose.model('Match', matchSchema);

// 🔢 MATCH COUNTER
let matchCounter = 0;

async function loadMatchCounter() {
  const lastMatch = await Match.findOne().sort({ matchId: -1 });
  if (lastMatch) matchCounter = lastMatch.matchId;
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('⚠️ MongoDB connection failed:', err.message);
  }
}

// ✅ CLIENT WITH INTENTS & PARTIALS
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ✅ YOUR ROLE & LOG CHANNEL
const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";

let currentScrim = null;

client.once('ready', async () => {
  await connectDB();
  await loadMatchCounter();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// 🔄 UPDATE EMBED FUNCTION
function updateEmbed() {
  if (!currentScrim || !currentScrim.message) return;

  const embed = new EmbedBuilder()
    .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
    .setColor('Orange')
    .addFields(
      { name: '👑 Host', value: currentScrim.hostName },
      { name: '🎮 Slots', value: `${currentScrim.teams.length}/25` },
      {
        name: '📋 Teams',
        value: currentScrim.teams.length
          ? currentScrim.teams.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
          : 'No teams yet'
      }
    );

  currentScrim.message.edit({ embeds: [embed] }).catch(() => {});
}

// 🔘 INTERACTION HANDLER (Buttons + Modals + Slash Commands)
client.on('interactionCreate', async (interaction) => {
  try {
    // ---------------------
    // SLASH COMMANDS
    // ---------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      await interaction.deferReply({ ephemeral: true });

      if (commandName === 'createscrim') {
        matchCounter++;
        currentScrim = {
          matchId: matchCounter,
          teams: [],
          maxSlots: 25,
          hostId: interaction.user.id,
          hostName: interaction.user.username,
          locked: false,
          roomId: null,
          password: null,
          results: []
        };

        const embed = new EmbedBuilder()
          .setTitle(`🔥 SAFFRON SCRIM BOT - MATCH #${currentScrim.matchId}`)
          .setDescription('Click buttons below to join or leave the scrim')
          .addFields(
            { name: '👑 Host', value: currentScrim.hostName },
            { name: '🎮 Slots', value: '0/25' },
            { name: '📋 Teams', value: 'No teams yet' }
          )
          .setColor('Orange');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('end').setLabel('End Scrim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('result').setLabel('Submit Result').setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
        currentScrim.message = msg;

        return interaction.editReply('✅ Scrim created!');
      }

      if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('📖 SAFFRON SCRIMS BOT - HELP')
          .setColor('Orange')
          .setDescription('Here are all available commands:')
          .addFields(
            {
              name: '🎮 Scrim Commands',
              value: '`/createscrim` → Create a new scrim\n`/results` → Show current scrim results'
            },
            {
              name: '📊 Match Commands',
              value: '`/history` → View last 10 matches\n`/match <id>` → View match details\n`/deletematch <id>` → Delete a match'
            },
            {
              name: '📢 Utility',
              value: '`/announce` → Send announcement\n`/help` → Show this help menu'
            },
            {
              name: '⚡ Interactive Buttons',
              value: 'Join / Leave / Lock / End / Submit Results (Use buttons in scrim message)'
            }
          )
          .setFooter({ text: '🔥 Saffron Scrims Bot | Automated Scrims System' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (commandName === 'results') {
        if (!currentScrim || !currentScrim.results || currentScrim.results.length === 0)
          return interaction.editReply('❌ No results submitted yet!');

        const sorted = [...currentScrim.results].sort((a, b) => b.points - a.points);
        const resultText = sorted.map((r, i) =>
          `${i + 1}. ${r.team} | ${r.points} pts (Pos: ${r.position} | ${r.kills} K)`
        ).join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`🏆 SCRIM RESULTS - MATCH #${currentScrim.matchId}`)
          .setDescription(resultText)
          .setColor('Gold');

        return interaction.editReply({ embeds: [embed] });
      }

      // Add other slash commands like history, match, deletematch, announce here...
    }

    // ---------------------
    // BUTTON HANDLER
    // ---------------------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // JOIN BUTTON
      if (id === 'join') {
        if (!currentScrim) return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
        if (currentScrim.locked) return interaction.reply({ content: '❌ Scrim is locked!', ephemeral: true });
        if (currentScrim.teams.find(t => t.userId === interaction.user.id)) {
          return interaction.reply({ content: '❌ You already joined!', ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('team_modal').setTitle('Enter Team Name');
        const input = new TextInputBuilder().setCustomId('team_name').setLabel('Your Team Name').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // LEAVE BUTTON
      if (id === 'leave') {
        if (!currentScrim) return interaction.reply({ content: '❌ No active scrim!', ephemeral: true });
        currentScrim.teams = currentScrim.teams.filter(t => t.userId !== interaction.user.id);

        try {
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.remove(SCRIM_ROLE_ID);
        } catch {}

        updateEmbed();
        return interaction.reply({ content: '❌ You left the scrim', ephemeral: true });
      }

      // LOCK, END, RESULT, ANNOUNCE buttons — handle similarly with deferUpdate() or reply
      // (You can reuse your modal logic from original file here)
    }

    // ---------------------
    // MODAL SUBMIT HANDLER
    // ---------------------
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id === 'team_modal') {
        const teamName = interaction.fields.getTextInputValue('team_name');
        if (currentScrim.teams.length >= currentScrim.maxSlots)
          return interaction.reply({ content: '❌ Slots full!', ephemeral: true });

        currentScrim.teams.push({ name: teamName, userId: interaction.user.id });

        // Assign role
        try {
          const member = interaction.guild.members.cache.get(interaction.user.id);
          if (member && !member.roles.cache.has(SCRIM_ROLE_ID)) await member.roles.add(SCRIM_ROLE_ID);
        } catch {}

        updateEmbed();
        return interaction.reply({ content: `✅ **${teamName}** joined the scrim!`, ephemeral: true });
      }

      // Add other modals like announce_modal, end_modal, result_modal, room_modal...
    }

  } catch (err) {
    if (err.code === 10062) {
      console.warn('⚠️ Interaction expired (ignored):', err.message);
    } else {
      console.error('⚠️ Interaction error:', err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
