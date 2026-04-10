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

// 🗄️ DATABASE
const matchSchema = new mongoose.Schema({
  matchId: Number,
  host: String,
  teams: Array,
  results: Array,
  createdAt: { type: Date, default: Date.now }
});
const Match = mongoose.model('Match', matchSchema);

let matchCounter = 0;

async function loadMatchCounter() {
  const last = await Match.findOne().sort({ matchId: -1 });
  if (last) matchCounter = last.matchId;
}

async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB Connected");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ⚙️ CONFIG
const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";

let currentScrim = null;

// 🔥 READY
client.once('clientReady', async () => {
  await connectDB();
  await loadMatchCounter();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= COMMANDS =================

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).split(/ +/);
  const cmd = args.shift().toLowerCase();

  // 🎮 CREATE SCRIM
  if (cmd === 'createscrim') {

    matchCounter++;

    currentScrim = {
      matchId: matchCounter,
      teams: [],
      maxSlots: 25,
      groups: { A: [], B: [], C: [], D: [] },
      leftPlayers: [],
      hostId: message.author.id,
      hostName: message.author.username,
      locked: false,
      roomId: null,
      password: null,
      results: []
    };

    const embed = new EmbedBuilder()
      .setTitle(`🔥 MATCH #${currentScrim.matchId}`)
      .addFields(
        { name: "👑 Host", value: currentScrim.hostName },
        { name: "🎮 Slots", value: "0/25" },
        { name: "📋 Teams", value: "No teams yet" }
      )
      .setColor("Orange");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join').setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('End').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('result').setLabel('Result').setStyle(ButtonStyle.Success)
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    currentScrim.message = msg;
  }

  // 🏆 GROUPS
  if (cmd === 'groups') {
    if (!currentScrim) return message.reply('❌ No scrim');

    distributeGroups();

    const embed = new EmbedBuilder()
      .setTitle("🏆 Groups")
      .setColor("Gold")
      .addFields(
        { name: "A", value: list(currentScrim.groups.A) },
        { name: "B", value: list(currentScrim.groups.B) },
        { name: "C", value: list(currentScrim.groups.C) },
        { name: "D", value: list(currentScrim.groups.D) }
      );

    message.channel.send({ embeds: [embed] });
  }

  // 🏠 IDP
  if (cmd === 'idp') {
    const g = args[0]?.toUpperCase();
    if (!['A','B','C','D'].includes(g)) return;

    const embed = new EmbedBuilder()
      .setTitle(`Room - Group ${g}`)
      .addFields(
        { name: "Room ID", value: currentScrim.roomId || "Not set" },
        { name: "Password", value: currentScrim.password || "Not set" }
      );

    message.channel.send({ embeds: [embed] });
  }

  // 📢 ANNOUNCE BUTTON
  if (cmd === 'announce') {
    const btn = new ButtonBuilder()
      .setCustomId('announce_btn')
      .setLabel('Create Announcement')
      .setStyle(ButtonStyle.Primary);

    message.reply({ components: [new ActionRowBuilder().addComponents(btn)] });
  }
});

// ================= INTERACTIONS =================

client.on('interactionCreate', async (interaction) => {
  try {

    // 🔥 FIX INTERACTION FAIL
    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });
    }

    if (!currentScrim && interaction.customId !== 'announce_btn') {
      return interaction.editReply({ content: "❌ No active scrim" });
    }

    // 📢 ANNOUNCE BUTTON
    if (interaction.customId === 'announce_btn') {
      const modal = new ModalBuilder()
        .setCustomId('announce_modal')
        .setTitle('Announcement');

      const msg = new TextInputBuilder()
        .setCustomId('msg')
        .setLabel('Message')
        .setStyle(TextInputStyle.Paragraph);

      const ch = new TextInputBuilder()
        .setCustomId('ch')
        .setLabel('Channel ID')
        .setStyle(TextInputStyle.Short);

      modal.addComponents(
        new ActionRowBuilder().addComponents(msg),
        new ActionRowBuilder().addComponents(ch)
      );

      return interaction.showModal(modal);
    }

    // 📢 ANNOUNCE SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'announce_modal') {
      const msg = interaction.fields.getTextInputValue('msg');
      const ch = interaction.fields.getTextInputValue('ch');

      const channel = interaction.guild.channels.cache.get(ch);
      if (!channel) return interaction.reply({ content: "❌ Invalid", ephemeral: true });

      const embed = new EmbedBuilder().setDescription(msg).setColor("Orange");
      await channel.send({ embeds: [embed] });

      return interaction.reply({ content: "✅ Sent", ephemeral: true });
    }

    // JOIN
    if (interaction.customId === 'join') {
      const modal = new ModalBuilder()
        .setCustomId('team_modal')
        .setTitle('Team Name');

      const input = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Team')
        .setStyle(TextInputStyle.Short);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // LEAVE
    if (interaction.customId === 'leave') {
      currentScrim.teams = currentScrim.teams.filter(t => t.userId !== interaction.user.id);
      currentScrim.leftPlayers.push(interaction.user.id);
      updateEmbed();
      return interaction.editReply({ content: "Left" });
    }

    // LOCK
    if (interaction.customId === 'lock') {
      if (interaction.user.id !== currentScrim.hostId)
        return interaction.editReply({ content: "❌ Only host" });

      const modal = new ModalBuilder()
        .setCustomId('room_modal')
        .setTitle('Room');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('room').setLabel('Room ID').setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('pass').setLabel('Pass').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // RESULT BUTTON
    if (interaction.customId === 'result') {
      const modal = new ModalBuilder().setCustomId('res_modal').setTitle('Result');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('team').setLabel('Team').setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('pos').setLabel('Position').setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('kill').setLabel('Kills').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // TEAM SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'team_modal') {
      const name = interaction.fields.getTextInputValue('name');

      if (currentScrim.teams.some(t => t.userId === interaction.user.id))
        return interaction.reply({ content: "❌ Already joined", ephemeral: true });

      currentScrim.teams.push({ name, userId: interaction.user.id });

      updateEmbed();
      return interaction.reply({ content: "✅ Joined", ephemeral: true });
    }

    // ROOM SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'room_modal') {
      currentScrim.roomId = interaction.fields.getTextInputValue('room');
      currentScrim.password = interaction.fields.getTextInputValue('pass');
      currentScrim.locked = true;

      return interaction.reply({ content: "✅ Locked", ephemeral: true });
    }

    // RESULT SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'res_modal') {
      const team = interaction.fields.getTextInputValue('team');
      const pos = parseInt(interaction.fields.getTextInputValue('pos'));
      const kills = parseInt(interaction.fields.getTextInputValue('kill'));

      let pts = kills + (pos === 1 ? 15 : pos === 2 ? 12 : pos === 3 ? 10 : 5);

      const existing = currentScrim.results.find(r => r.team === team);

      if (existing) {
        existing.points = pts;
      } else {
        currentScrim.results.push({ team, points: pts });
      }

      return interaction.reply({ content: "✅ Result saved", ephemeral: true });
    }

  } catch (err) {
    console.error(err);
  }
});

// ================= HELPERS =================

function list(arr) {
  return arr.length ? arr.map(x => x.name).join('\n') : "Empty";
}

function distributeGroups() {
  const g = { A: [], B: [], C: [], D: [] };
  currentScrim.teams.forEach((t, i) => {
    const key = ['A','B','C','D'][i % 4];
    g[key].push(t);
  });
  currentScrim.groups = g;
}

async function updateEmbed() {
  if (!currentScrim?.message) return;

  const embed = new EmbedBuilder()
    .setTitle(`🔥 MATCH #${currentScrim.matchId}`)
    .addFields(
      { name: "👑 Host", value: currentScrim.hostName },
      { name: "🎮 Slots", value: `${currentScrim.teams.length}/25` },
      { name: "📋 Teams", value: list(currentScrim.teams) }
    );

  try {
    await currentScrim.message.edit({ embeds: [embed] });
  } catch {}
}

client.login(process.env.DISCORD_TOKEN);
