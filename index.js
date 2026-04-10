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

// ================= DB =================
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

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const SCRIM_ROLE_ID = "1488611595318988850";
const LOG_CHANNEL_ID = "1489298280960622805";

let currentScrim = null;

// ================= READY =================
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

  // CREATE SCRIM
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
      .setTitle(`🔥 MATCH #${matchCounter}`)
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

  // GROUPS
  if (cmd === 'groups') {
    if (!currentScrim) return;
    distributeGroups();

    const embed = new EmbedBuilder()
      .setTitle("🏆 Groups")
      .addFields(
        { name: "A", value: list(currentScrim.groups.A) },
        { name: "B", value: list(currentScrim.groups.B) },
        { name: "C", value: list(currentScrim.groups.C) },
        { name: "D", value: list(currentScrim.groups.D) }
      );

    message.channel.send({ embeds: [embed] });
  }

  // IDP
  if (cmd === 'idp') {
    const g = args[0]?.toUpperCase();
    if (!['A','B','C','D'].includes(g)) return;

    const embed = new EmbedBuilder()
      .setTitle(`🏠 Group ${g}`)
      .addFields(
        { name: "Room ID", value: currentScrim.roomId || "Not set" },
        { name: "Password", value: currentScrim.password || "Not set" }
      );

    message.channel.send({ embeds: [embed] });
  }

  // ANNOUNCE
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

    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });
    }

    if (!currentScrim && interaction.customId !== 'announce_btn') {
      return interaction.editReply({ content: "❌ No active scrim" });
    }

    // ANNOUNCE
    if (interaction.customId === 'announce_btn') {
      const modal = new ModalBuilder().setCustomId('announce_modal').setTitle('Announcement');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('msg').setLabel('Message').setStyle(TextInputStyle.Paragraph)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'announce_modal') {
      const msg = interaction.fields.getTextInputValue('msg');
      const ch = interaction.fields.getTextInputValue('ch');
      const channel = interaction.guild.channels.cache.get(ch);

      if (!channel) return interaction.reply({ content: "❌ Invalid", ephemeral: true });

      await channel.send({ embeds: [new EmbedBuilder().setDescription(msg).setColor("Orange")] });
      return interaction.reply({ content: "✅ Sent", ephemeral: true });
    }

    // JOIN
    if (interaction.customId === 'join') {
      const modal = new ModalBuilder().setCustomId('team_modal').setTitle('Team');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('Team Name').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // LEAVE
    if (interaction.customId === 'leave') {
      currentScrim.teams = currentScrim.teams.filter(t => t.userId !== interaction.user.id);
      currentScrim.leftPlayers.push(interaction.user.id);

      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(SCRIM_ROLE_ID)) {
        await member.roles.remove(SCRIM_ROLE_ID);
      }

      updateEmbed();
      return interaction.editReply({ content: "❌ Left scrim" });
    }

    // LOCK
    if (interaction.customId === 'lock') {
      if (interaction.user.id !== currentScrim.hostId)
        return interaction.editReply({ content: "❌ Only host" });

      const modal = new ModalBuilder().setCustomId('room_modal').setTitle('Room');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('room').setLabel('Room ID').setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('pass').setLabel('Password').setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('ch').setLabel('Channel ID').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // ROOM SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'room_modal') {
      const room = interaction.fields.getTextInputValue('room');
      const pass = interaction.fields.getTextInputValue('pass');
      const ch = interaction.fields.getTextInputValue('ch');

      const channel = interaction.guild.channels.cache.get(ch);

      currentScrim.locked = true;
      currentScrim.roomId = room;
      currentScrim.password = pass;

      const msg = await channel.send({
        content: `<@&${SCRIM_ROLE_ID}>`,
        embeds: [new EmbedBuilder()
          .setTitle("🏠 ROOM DETAILS")
          .addFields(
            { name: "Room", value: room },
            { name: "Pass", value: pass }
          )]
      });

      currentScrim.roomMessage = msg;

      // TIMER
      let t = 300;
      const timerMsg = await channel.send("⏱️ Starting in 5:00");

      const interval = setInterval(async () => {
        t -= 30;
        if (t <= 0) {
          clearInterval(interval);
          return channel.send("🚀 Match Started!");
        }
        await timerMsg.edit(`⏱️ ${Math.floor(t/60)}:${(t%60).toString().padStart(2,'0')}`);
      }, 30000);

      currentScrim.timerInterval = interval;

      updateEmbed();
      return interaction.reply({ content: "✅ Locked", ephemeral: true });
    }

    // END SCRIM
    if (interaction.customId === 'end') {
      if (interaction.user.id !== currentScrim.hostId)
        return interaction.editReply({ content: "❌ Only host" });

      const modal = new ModalBuilder().setCustomId('end_modal').setTitle('End');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('ch').setLabel('Result Channel ID').setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'end_modal') {
      const ch = interaction.fields.getTextInputValue('ch');
      const channel = interaction.guild.channels.cache.get(ch);

      const sorted = [...currentScrim.results].sort((a,b)=>b.points-a.points);
      const text = sorted.map((r,i)=>`${i+1}. ${r.team} | ${r.points}`).join('\n');

      await channel.send({
        embeds: [new EmbedBuilder().setTitle("🏆 RESULTS").setDescription(text)]
      });

      // LOG
      const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle(`📋 MATCH #${currentScrim.matchId}`)
            .setDescription(list(currentScrim.teams))]
        });
      }

      // REMOVE ROLES
      for (const t of currentScrim.teams) {
        const m = await interaction.guild.members.fetch(t.userId);
        if (m.roles.cache.has(SCRIM_ROLE_ID)) {
          await m.roles.remove(SCRIM_ROLE_ID);
        }
      }

      // SAVE
      await Match.create(currentScrim);

      currentScrim = null;

      return interaction.reply({ content: "✅ Scrim Ended", ephemeral: true });
    }

    // RESULT
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

    if (interaction.isModalSubmit() && interaction.customId === 'res_modal') {
      const team = interaction.fields.getTextInputValue('team');
      const pos = parseInt(interaction.fields.getTextInputValue('pos'));
      const kills = parseInt(interaction.fields.getTextInputValue('kill'));

      let pts = kills + (pos===1?15:pos===2?12:pos===3?10:5);

      const existing = currentScrim.results.find(r=>r.team===team);
      if (existing) existing.points = pts;
      else currentScrim.results.push({ team, points: pts });

      return interaction.reply({ content: "✅ Result Saved", ephemeral: true });
    }

    // TEAM JOIN
    if (interaction.isModalSubmit() && interaction.customId === 'team_modal') {
      const name = interaction.fields.getTextInputValue('name');

      if (currentScrim.teams.some(t=>t.userId===interaction.user.id))
        return interaction.reply({ content:"❌ Already joined", ephemeral:true });

      currentScrim.teams.push({ name, userId: interaction.user.id });

      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(SCRIM_ROLE_ID);

      updateEmbed();
      return interaction.reply({ content:"✅ Joined", ephemeral:true });
    }

  } catch (err) {
    console.error(err);
  }
});

// ================= HELPERS =================
function list(arr) {
  return arr.length ? arr.map(x=>x.name).join('\n') : "Empty";
}

function distributeGroups() {
  const g = {A:[],B:[],C:[],D:[]};
  currentScrim.teams.forEach((t,i)=>{
    g[['A','B','C','D'][i%4]].push(t);
  });
  currentScrim.groups = g;
}

async function updateEmbed() {
  if (!currentScrim?.message) return;

  const embed = new EmbedBuilder()
    .setTitle(`🔥 MATCH #${currentScrim.matchId}`)
    .addFields(
      { name:"👑 Host", value:currentScrim.hostName },
      { name:"🎮 Slots", value:`${currentScrim.teams.length}/25` },
      { name:"📋 Teams", value:list(currentScrim.teams) }
    );

  await currentScrim.message.edit({ embeds:[embed] });
}

client.login(process.env.DISCORD_TOKEN);
