"use strict";

require("dotenv").config();
const { Telegraf, Markup, session } = require("telegraf");
const { ensureDataFiles, readJson, writeJson } = require("./storage");

const http = require("http");

const PORT = process.env.PORT || 9001;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running");
  })
  .listen(PORT, () => {
    console.log(`HTTP server running on port ${PORT}`);
  });

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map((id) => Number(id))
  .filter((id) => Number.isFinite(id));

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map((id) => Number(id))
  .filter((id) => Number.isFinite(id));

const EFFECTIVE_SUPER_ADMIN_IDS = SUPER_ADMIN_IDS.length
  ? SUPER_ADMIN_IDS
  : ADMIN_IDS;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing. Set it in .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
// Fallback: ensure ctx.session exists even if session middleware fails.
const fallbackSessions = new Map();
bot.use(async (ctx, next) => {
  if (ctx.session !== undefined) {
    return next();
  }
  const key =
    (ctx.from && String(ctx.from.id)) ||
    (ctx.chat && String(ctx.chat.id)) ||
    null;
  if (!key) {
    ctx.session = {};
    return next();
  }
  ctx.session = fallbackSessions.get(key) || {};
  try {
    return await next();
  } finally {
    fallbackSessions.set(key, ctx.session);
  }
});

const MAIN_MENU = Markup.keyboard([
  ["📝 Testlar"],
  ["📊 Urinishlarim", "ℹ️ Bot haqida"],
]).resize();

const ADMIN_MENU = Markup.keyboard([
  ["📣 Xabar yuborish"],
  ["🧩 Test yaratish", "📚 Testlar"],
  ["📊 Natijalar", "📡 Kanallar"],
  ["👥 Foydalanuvchilar"],
  ["⬅️ Orqaga"],
]).resize();

const SUPER_ADMIN_MENU = Markup.keyboard([
  ["📣 Xabar yuborish"],
  ["🧩 Test yaratish", "📚 Testlar"],
  ["📊 Natijalar", "📡 Kanallar"],
  ["👥 Foydalanuvchilar"],
  ["👑 Adminlar"],
  ["⬅️ Orqaga"],
]).resize();

function isSuperAdmin(id) {
  return EFFECTIVE_SUPER_ADMIN_IDS.includes(id);
}

function isAdmin(id) {
  return isSuperAdmin(id) || ADMIN_IDS.includes(id) || dynamicAdmins.has(id);
}

function formatDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUsersData() {
  return readJson("users");
}

async function saveUsersData(data) {
  return writeJson("users", data);
}

async function getChannelsData() {
  return readJson("channels");
}

async function saveChannelsData(data) {
  return writeJson("channels", data);
}

async function getTestsData() {
  return readJson("tests");
}

async function saveTestsData(data) {
  return writeJson("tests", data);
}

async function getResultsData() {
  return readJson("results");
}

async function saveResultsData(data) {
  return writeJson("results", data);
}

async function getAdminsData() {
  return readJson("admins");
}

async function saveAdminsData(data) {
  return writeJson("admins", data);
}

let dynamicAdmins = new Set();

async function loadDynamicAdmins() {
  const data = await getAdminsData();
  const list = Array.isArray(data.admins) ? data.admins : [];
  dynamicAdmins = new Set(
    list.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
  );
}

async function saveDynamicAdmins() {
  return saveAdminsData({ admins: [...dynamicAdmins] });
}

async function getAttemptedTestIds(userId) {
  const resultsData = await getResultsData();
  const attempted = new Set();
  for (const r of resultsData.results) {
    if (r.user_id === userId) attempted.add(r.test_id);
  }
  return attempted;
}

async function ensureUser(ctx) {
  if (!ctx.from) return null;
  const data = await getUsersData();
  const fullName = [ctx.from.first_name, ctx.from.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  let user = data.users.find((u) => u.id === ctx.from.id);
  if (!user) {
    user = {
      id: ctx.from.id,
      username: ctx.from.username || "",
      full_name: fullName || "",
      joined_date: formatDate(),
      tests_worked: 0,
    };
    data.users.push(user);
  } else {
    if (ctx.from.username) user.username = ctx.from.username;
    if (fullName) user.full_name = fullName;
  }

  await saveUsersData(data);
  return user;
}

async function incrementTestsWorked(userId) {
  const data = await getUsersData();
  const user = data.users.find((u) => u.id === userId);
  if (user) {
    user.tests_worked = Number(user.tests_worked || 0) + 1;
    await saveUsersData(data);
  }
  return user || null;
}

async function getActiveChannels() {
  const data = await getChannelsData();
  return data.channels.filter((c) => c.status === "active");
}

function formatChannelsList(channels) {
  if (!channels.length) return "";
  return channels
    .map((c, i) => {
      const label = c.username ? ` (${c.username})` : "";
      return `${i + 1}. ${c.name}${label}`;
    })
    .join("\n");
}

function buildChannelsKeyboard(channels) {
  const rows = [];
  for (const channel of channels) {
    if (channel.username) {
      const username = channel.username.startsWith("@")
        ? channel.username.slice(1)
        : channel.username;
      rows.push([Markup.button.url(channel.name, `https://t.me/${username}`)]);
    }
  }
  rows.push([Markup.button.callback("✅ Tekshirish", "check_channels")]);
  return Markup.inlineKeyboard(rows);
}

async function checkAllChannels(ctx) {
  const channels = await getActiveChannels();
  if (!channels.length) return true;
  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
      const ok = ["creator", "administrator", "member"].includes(member.status);
      if (!ok) return false;
    } catch (err) {
      console.error("Channel check failed:", channel, err);
      return false;
    }
  }
  return true;
}

async function showJoinPrompt(ctx) {
  const channels = await getActiveChannels();
  if (!channels.length) {
    return showMainMenu(ctx);
  }
  const text = [
    "Akademik viktorinada ishtirok etish uchun quyidagi kanallarga obuna bo'ling",
    "",
    formatChannelsList(channels),
    "",
    "✅ A'zo bo'lgach, \"✅ Tekshirish\" tugmasini bosing.",
  ].join("\n");
  return ctx.reply(text, buildChannelsKeyboard(channels));
}

async function ensureJoined(ctx) {
  const ok = await checkAllChannels(ctx);
  if (!ok) {
    const channels = await getActiveChannels();
    await ctx.reply(
      "⛔ Kirish cheklangan\n\nBotdan foydalanish uchun barcha kanallarga a'zo bo'lishingiz kerak.",
      buildChannelsKeyboard(channels),
    );
  }
  return ok;
}

async function showMainMenu(ctx) {
  return ctx.reply("🏠 Asosiy menyu", MAIN_MENU);
}

async function showAdminMenu(ctx) {
  const menu = isSuperAdmin(ctx.from.id) ? SUPER_ADMIN_MENU : ADMIN_MENU;
  return ctx.reply("🛠️ Admin panel", menu);
}

function chunkButtons(buttons, size) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += size) {
    rows.push(buttons.slice(i, i + size));
  }
  return rows;
}

function optionLabel(index) {
  if (index >= 0 && index < 26) {
    return String.fromCharCode(65 + index);
  }
  return String(index + 1);
}

function formatTestStatus(status) {
  return status === "open" ? "✅ Ochiq" : "❌ Yopiq";
}

function formatChannelStatus(status) {
  return status === "active" ? "✅ Faol" : "⛔ O'chirilgan";
}

function parseAdminId(text) {
  const id = Number(String(text).trim());
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function buildAdminLists() {
  const superSet = new Set(EFFECTIVE_SUPER_ADMIN_IDS);
  const staticSet = new Set(ADMIN_IDS);
  const superIds = [...superSet].sort((a, b) => a - b);
  const staticIds = [...staticSet]
    .filter((id) => !superSet.has(id))
    .sort((a, b) => a - b);
  const dynamicIds = [...dynamicAdmins]
    .filter((id) => !superSet.has(id) && !staticSet.has(id))
    .sort((a, b) => a - b);

  return { superIds, staticIds, dynamicIds };
}

async function sendTestChoices(ctx, tests) {
  const rows = tests.map((t) => [
    Markup.button.callback(`${t.title}`, `start_test:${t.id}`),
  ]);
  return ctx.reply(
    `🧩 Testni tanlang\n\nMavjud testlar: ${tests.length}`,
    Markup.inlineKeyboard(rows),
  );
}

async function sendQuestion(ctx, test, index) {
  const q = test.questions[index];
  const buttons = q.options.map((_, i) =>
    Markup.button.callback(`${optionLabel(i)}`, `ans:${test.id}:${index}:${i}`),
  );
  const optionsText = q.options
    .map((opt, i) => `${optionLabel(i)}. ${opt}`)
    .join("\n");
  const text = [
    `🧩 Test: ${test.title}`,
    `❓ Savol ${index + 1}/${test.questions.length}`,
    "",
    `${q.question}`,
    "",
    "Variantlar:",
    optionsText,
  ].join("\n");
  return ctx.reply(text, Markup.inlineKeyboard(chunkButtons(buttons, 3)));
}

async function startTest(ctx, test) {
  if (ctx.session.test) {
    return ctx.reply("⚠️ Sizda faol test bor. Avval uni yakunlang.");
  }
  ctx.session.test = { testId: test.id, index: 0, correct: 0 };
  await sendQuestion(ctx, test, 0);
}

async function notifyAdmins(text) {
  if (!ADMIN_IDS.length) return;
  for (const adminId of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, text);
    } catch (err) {
      console.error("Admin notify failed:", err);
    }
  }
}

async function finishTest(ctx, test, correct) {
  const total = test.questions.length;
  const wrong = total - correct;
  const percentage = total ? Math.round((correct / total) * 100) : 0;

  const user = await ensureUser(ctx);
  await incrementTestsWorked(ctx.from.id);

  const resultsData = await getResultsData();
  resultsData.results.push({
    user_id: ctx.from.id,
    username: user?.username || "",
    full_name: user?.full_name || "",
    test_id: test.id,
    correct,
    wrong,
    percentage,
    date: formatDate(),
  });
  await saveResultsData(resultsData);
}

async function sendResultsSummary(ctx) {
  const resultsData = await getResultsData();
  if (!resultsData.results.length) {
    return ctx.reply("ℹ️ Natijalar hali yo'q.");
  }

  const usersData = await getUsersData();
  const testsData = await getTestsData();
  const userMap = new Map(usersData.users.map((u) => [u.id, u]));
  const testMap = new Map(testsData.tests.map((t) => [t.id, t]));

  const grouped = new Map();
  for (const r of resultsData.results) {
    if (!grouped.has(r.test_id)) grouped.set(r.test_id, []);
    grouped.get(r.test_id).push(r);
  }

  const groups = [...grouped.entries()]
    .map(([testId, list]) => {
      const test = testMap.get(testId);
      const title = test ? test.title : `Test #${testId}`;
      const lastDate =
        list
          .map((r) => r.date || "")
          .sort((a, b) => String(b).localeCompare(String(a)))[0] || "";
      return { testId, title, list, lastDate };
    })
    .sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));

  await ctx.reply(
    `📊 Natijalar (testlar bo'yicha)\n\nJami testlar: ${groups.length}`,
  );

  for (const group of groups) {
    const results = [...group.list].sort((a, b) => {
      const byPercent = Number(b.percentage || 0) - Number(a.percentage || 0);
      if (byPercent !== 0) return byPercent;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });

    const header = [
      `📝 Test: ${group.title} #${group.testId}`,
      `📌 Natijalar: ${results.length}`,
    ].join("\n");

    const lines = results.map((r, i) => {
      const user = userMap.get(r.user_id);
      const usernameLine = r.username ? `@${r.username}` : "—";
      const fullNameLine = r.full_name || (user ? user.full_name : "") || "—";
      const dateLine = r.date || "—";
      return [
        `${i + 1}. 👤 ${usernameLine} | 📛 ${fullNameLine}`,
        `   ✅ To'g'ri: ${r.correct}  ❌ Noto'g'ri: ${r.wrong}  📊 Foiz: ${r.percentage}%  📅 Sana: ${dateLine}`,
      ].join("\n");
    });

    const text = [header, "", ...lines].join("\n");
    await sendLongText(ctx, text);
  }
}

async function sendLongText(ctx, text) {
  const max = 3500;
  if (text.length <= max) {
    return ctx.reply(text);
  }
  const parts = [];
  let current = "";
  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > max) {
      if (current) parts.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  for (const part of parts) {
    await ctx.reply(part);
  }
}

async function sendUsersList(ctx) {
  const usersData = await getUsersData();
  if (!usersData.users.length) {
    return ctx.reply("ℹ️ Hali foydalanuvchilar yo'q.");
  }

  const users = [...usersData.users].sort((a, b) =>
    (a.joined_date || "").localeCompare(b.joined_date || ""),
  );
  const lines = users.map((u, i) => {
    const username = u.username ? `@${u.username}` : "—";
    const fullName = u.full_name || "—";
    const joined = u.joined_date || "—";
    const worked = Number(u.tests_worked || 0);
    return [
      `${i + 1}. ${fullName}`,
      `   👤 Username: ${username}`,
      `   🆔 ID: ${u.id}`,
      `   📅 Qo'shilgan: ${joined}`,
      `   📝 Urinishlar: ${worked}`,
    ].join("\n");
  });

  const chunkSize = 15;
  await ctx.reply(`👥 Foydalanuvchilar\n\nJami: ${users.length}`);
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize).join("\n\n");
    await ctx.reply(chunk);
  }
}

async function sendChannelsList(ctx) {
  const channelsData = await getChannelsData();
  const channels = Array.isArray(channelsData.channels)
    ? channelsData.channels
    : [];

  if (!channels.length) {
    return ctx.reply("ℹ️ Hali kanallar qo'shilmagan.");
  }

  const activeCount = channels.filter((c) => c.status === "active").length;
  const inactiveCount = channels.length - activeCount;

  const lines = [];
  lines.push("📡 Kanallar ro'yxati");
  lines.push(`Jami: ${channels.length}`);
  lines.push(`Faol: ${activeCount}`);
  lines.push(`O'chirilgan: ${inactiveCount}`);
  lines.push("");

  channels.forEach((c, i) => {
    const username = c.username ? c.username : "—";
    const name = c.name || "—";
    const status = formatChannelStatus(c.status);
    lines.push(
      [
        `${i + 1}. ${name}`,
        `   👤 Username: ${username}`,
        `   🆔 ID: ${c.id}`,
        `   🔔 Holat: ${status}`,
      ].join("\n"),
    );
    lines.push("");
  });

  await sendLongText(ctx, lines.join("\n"));
}

async function sendAdminList(ctx) {
  const usersData = await getUsersData();
  const userMap = new Map(usersData.users.map((u) => [u.id, u]));
  const { superIds, staticIds, dynamicIds } = buildAdminLists();
  const totalAdmins = superIds.length + staticIds.length + dynamicIds.length;

  const formatAdminLine = (id, index) => {
    const user = userMap.get(id);
    const username = user?.username ? `@${user.username}` : "—";
    const fullName = user?.full_name || "—";
    const joined = user?.joined_date || "—";
    const worked = Number(user?.tests_worked || 0);
    return [
      `${index}. 🆔 ${id}`,
      `   👤 Username: ${username}`,
      `   📛 F.I.O: ${fullName}`,
      `   📅 Qo'shilgan: ${joined}`,
      `   📝 Urinishlar: ${worked}`,
    ].join("\n");
  };

  const lines = [];
  lines.push("👑 Adminlar");
  lines.push(`Jami: ${totalAdmins}`);
  lines.push(`Super adminlar: ${superIds.length}`);
  lines.push(`Oddiy adminlar: ${staticIds.length + dynamicIds.length}`);
  lines.push("");

  if (superIds.length) {
    lines.push("👑 Super adminlar:");
    superIds.forEach((id, i) => {
      lines.push(formatAdminLine(id, i + 1));
    });
    lines.push("");
  }

  if (staticIds.length) {
    lines.push("🔒 Oddiy adminlar (.env):");
    staticIds.forEach((id, i) => {
      lines.push(formatAdminLine(id, i + 1));
    });
    lines.push("");
  }

  if (dynamicIds.length) {
    lines.push("🛡️ Oddiy adminlar (bot orqali):");
    dynamicIds.forEach((id, i) => {
      lines.push(formatAdminLine(id, i + 1));
    });
    lines.push("");
  }

  if (!staticIds.length && !dynamicIds.length) {
    lines.push("Oddiy adminlar yo'q.");
  }

  await sendLongText(ctx, lines.join("\n"));
}

async function sendTestList(ctx) {
  const testsData = await getTestsData();
  if (!testsData.tests.length) {
    return ctx.reply("ℹ️ Hali testlar yo'q.");
  }

  await ctx.reply(`📚 Testlar ro'yxati\n\nJami: ${testsData.tests.length}`);

  for (const test of testsData.tests) {
    const text = [
      `#${test.id} ${test.title}`,
      `Holat: ${formatTestStatus(test.status)}`,
      `Savollar: ${test.questions.length}`,
    ].join("\n");

    const rows = [
      [
        Markup.button.callback(
          test.status === "open" ? "🔒 Yopish" : "🔓 Ochish",
          `test_toggle:${test.id}`,
        ),
      ],
      [
        Markup.button.callback("✏️ Tahrirlash", `test_edit:${test.id}`),
        Markup.button.callback("🗑️ O'chirish", `test_delete:${test.id}`),
      ],
    ];

    if (isSuperAdmin(ctx.from.id)) {
      rows.push([
        Markup.button.callback("✅ Javoblar", `test_answers:${test.id}`),
      ]);
    }

    const keyboard = Markup.inlineKeyboard(rows);

    await ctx.reply(text, keyboard);
  }
}

async function handleAdminMessage(ctx) {
  const admin = ctx.session.admin;
  if (!admin) return false;

  if (
    ctx.message &&
    ctx.message.text &&
    ctx.message.text.trim().startsWith("/")
  ) {
    return false;
  }

  if (admin.mode === "broadcast") {
    const usersData = await getUsersData();
    let ok = 0;
    let fail = 0;

    for (const user of usersData.users) {
      try {
        await ctx.telegram.copyMessage(
          user.id,
          ctx.chat.id,
          ctx.message.message_id,
        );
        ok += 1;
      } catch (err) {
        fail += 1;
      }
      await sleep(25);
    }

    ctx.session.admin = null;
    await ctx.reply(`✅ Xabar yuborildi.\nYetkazildi: ${ok}\nXatolar: ${fail}`);
    await showAdminMenu(ctx);
    return true;
  }

  if (!ctx.message || !ctx.message.text) {
    await ctx.reply("⚠️ Iltimos, matn yuboring.");
    return true;
  }

  const text = ctx.message.text.trim();

  if (admin.mode === "create_test_title") {
    if (!text) {
      await ctx.reply("🧩 Test yaratish (1/5)\n\nTest nomini kiriting.");
      return true;
    }
    admin.newTest.title = text;
    admin.mode = "create_test_count";
    await ctx.reply(
      "🧩 Test yaratish (2/5)\n\nSavollar sonini kiriting (1-100).",
    );
    return true;
  }

  if (admin.mode === "create_test_count") {
    const count = Number(text);
    if (!Number.isInteger(count) || count <= 0 || count > 100) {
      await ctx.reply("⚠️ Iltimos, 1 dan 100 gacha bo'lgan son kiriting.");
      return true;
    }
    admin.newTest.totalQuestions = count;
    admin.mode = "create_test_question";
    await ctx.reply(
      `🧩 Test yaratish (3/5)\n\nSavol 1/${count} matnini kiriting.`,
    );
    return true;
  }

  if (admin.mode === "create_test_question") {
    admin.currentQuestion = { question: text };
    admin.mode = "create_test_options";
    await ctx.reply(
      `🧩 Test yaratish (4/5)\n\nSavol ${admin.newTest.questions.length + 1}/${admin.newTest.totalQuestions} uchun variantlarni '|' bilan ajrating (masalan: A|B|C|D).`,
    );
    return true;
  }

  if (admin.mode === "create_test_options") {
    const options = text
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length < 2) {
      await ctx.reply("⚠️ Kamida 2 ta variant kiriting.");
      return true;
    }
    admin.currentQuestion.options = options;
    admin.mode = "create_test_correct";
    await ctx.reply(
      `🧩 Test yaratish (5/5)\n\nSavol ${admin.newTest.questions.length + 1}/${admin.newTest.totalQuestions} uchun to'g'ri javob raqamini kiriting (1-${options.length}).`,
    );
    return true;
  }

  if (admin.mode === "create_test_correct") {
    const index = Number(text);
    const total = admin.currentQuestion.options.length;
    if (!Number.isInteger(index) || index < 1 || index > total) {
      await ctx.reply(`⚠️ Iltimos, 1 dan ${total} gacha son kiriting.`);
      return true;
    }

    admin.currentQuestion.correct_answer = index - 1;
    admin.newTest.questions.push(admin.currentQuestion);
    admin.currentQuestion = null;

    if (admin.newTest.questions.length >= admin.newTest.totalQuestions) {
      admin.mode = "create_test_status";
      await ctx.reply(
        "🧩 Test holati\n\nTestni ochiq yoki yopiq qiling:",
        Markup.inlineKeyboard([
          [Markup.button.callback("Ochiq ✅", "test_status:open")],
          [Markup.button.callback("Yopiq ❌", "test_status:closed")],
        ]),
      );
      return true;
    }

    admin.mode = "create_test_question";
    const nextNum = admin.newTest.questions.length + 1;
    await ctx.reply(
      `🧩 Test yaratish (3/5)\n\nSavol ${nextNum}/${admin.newTest.totalQuestions} matnini kiriting.`,
    );
    return true;
  }

  if (admin.mode === "edit_test_title") {
    const testsData = await getTestsData();
    const test = testsData.tests.find((t) => t.id === admin.testId);
    if (!test) {
      ctx.session.admin = null;
      await ctx.reply("⚠️ Test topilmadi.");
      return true;
    }
    test.title = text;
    await saveTestsData(testsData);
    ctx.session.admin = null;
    await ctx.reply("✅ Test nomi yangilandi.");
    await showAdminMenu(ctx);
    return true;
  }

  if (admin.mode === "add_admin") {
    if (!isSuperAdmin(ctx.from.id)) {
      ctx.session.admin = null;
      await ctx.reply("⛔ Ruxsat yo'q.");
      return true;
    }
    const id = parseAdminId(text);
    if (!id) {
      await ctx.reply("⚠️ Admin ID raqamini kiriting (faqat raqam).");
      return true;
    }
    if (isSuperAdmin(id)) {
      await ctx.reply("ℹ️ Bu foydalanuvchi super admin.");
      return true;
    }
    if (isAdmin(id)) {
      await ctx.reply("ℹ️ Bu foydalanuvchi allaqachon admin.");
      return true;
    }
    dynamicAdmins.add(id);
    await saveDynamicAdmins();
    ctx.session.admin = null;
    await ctx.reply(`✅ Admin qo'shildi: ${id}`);
    await showAdminMenu(ctx);
    return true;
  }

  if (admin.mode === "remove_admin") {
    if (!isSuperAdmin(ctx.from.id)) {
      ctx.session.admin = null;
      await ctx.reply("⛔ Ruxsat yo'q.");
      return true;
    }
    const id = parseAdminId(text);
    if (!id) {
      await ctx.reply("⚠️ Admin ID raqamini kiriting (faqat raqam).");
      return true;
    }
    if (isSuperAdmin(id)) {
      await ctx.reply("⚠️ Super adminni olib tashlab bo'lmaydi.");
      return true;
    }
    if (ADMIN_IDS.includes(id)) {
      await ctx.reply(
        "⚠️ Bu admin .env orqali belgilangan, olib tashlab bo'lmaydi.",
      );
      return true;
    }
    if (!dynamicAdmins.has(id)) {
      await ctx.reply("ℹ️ Bu foydalanuvchi admin emas.");
      return true;
    }
    dynamicAdmins.delete(id);
    await saveDynamicAdmins();
    ctx.session.admin = null;
    await ctx.reply(`✅ Admin olib tashlandi: ${id}`);
    await showAdminMenu(ctx);
    return true;
  }

  if (admin.mode === "add_channel") {
    const input = text;
    if (!input.startsWith("@") && !/^-?\d+$/.test(input)) {
      await ctx.reply(
        "⚠️ Kanal username yoki ID kiriting (masalan: @kanal yoki -100123...).",
      );
      return true;
    }

    try {
      const chat = await ctx.telegram.getChat(input);
      if (chat.type !== "channel") {
        await ctx.reply("⚠️ Bu kanal emas. Iltimos, kanal kiriting.");
        return true;
      }

      const channelsData = await getChannelsData();
      const existing = channelsData.channels.find(
        (c) =>
          c.id === chat.id ||
          (chat.username && c.username === `@${chat.username}`),
      );

      if (existing) {
        existing.name = chat.title || existing.name;
        existing.username = chat.username
          ? `@${chat.username}`
          : existing.username;
        existing.status = "active";
      } else {
        channelsData.channels.push({
          id: chat.id,
          name: chat.title || "Kanal",
          username: chat.username ? `@${chat.username}` : "",
          status: "active",
        });
      }

      await saveChannelsData(channelsData);
      ctx.session.admin = null;
      await ctx.reply(`✅ Kanal qo'shildi: ${chat.title || chat.id}`);
      await showAdminMenu(ctx);
      return true;
    } catch (err) {
      await ctx.reply("⚠️ Kanal topilmadi yoki botda ruxsat yo'q.");
      return true;
    }
  }

  return false;
}

bot.start(async (ctx) => {
  await ensureUser(ctx);
  const channels = await getActiveChannels();
  if (channels.length) {
    const joined = await checkAllChannels(ctx);
    if (!joined) {
      return showJoinPrompt(ctx);
    }
  }
  if (isAdmin(ctx.from.id)) {
    return showAdminMenu(ctx);
  }
  return showMainMenu(ctx);
});

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ Ruxsat yo'q.");
  }
  await showAdminMenu(ctx);
});

bot.command("cancel", async (ctx) => {
  if (ctx.session) {
    ctx.session.admin = null;
    ctx.session.test = null;
  }
  return ctx.reply("✅ Bekor qilindi.");
});

bot.action("check_channels", async (ctx) => {
  await ctx.answerCbQuery();
  const joined = await checkAllChannels(ctx);
  if (joined) {
    return showMainMenu(ctx);
  }
  const channels = await getActiveChannels();
  return ctx.reply(
    "⛔ Kirish cheklangan\n\nBotdan foydalanish uchun barcha kanallarga a'zo bo'lishingiz kerak.",
    buildChannelsKeyboard(channels),
  );
});

bot.hears("⬅️ Orqaga", async (ctx) => showMainMenu(ctx));

bot.hears("📝 Testlar", async (ctx) => {
  if (!(await ensureJoined(ctx))) return;
  const testsData = await getTestsData();
  const openTests = testsData.tests.filter((t) => t.status === "open");
  if (!openTests.length) {
    return ctx.reply("⏳ Hozir testlar yopiq.");
  }
  const attempted = await getAttemptedTestIds(ctx.from.id);
  const availableTests = openTests.filter((t) => !attempted.has(t.id));
  if (!availableTests.length) {
    return ctx.reply("✅ Siz barcha ochiq testlarni ishlab bo'lgansiz.");
  }
  if (availableTests.length === 1) {
    return startTest(ctx, availableTests[0]);
  }
  return sendTestChoices(ctx, availableTests);
});

bot.action(/^start_test:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!(await ensureJoined(ctx))) return;
  const testId = Number(ctx.match[1]);
  const attempted = await getAttemptedTestIds(ctx.from.id);
  if (attempted.has(testId)) {
    return ctx.reply("⚠️ Bu testni allaqachon ishlagansiz.");
  }
  const testsData = await getTestsData();
  const test = testsData.tests.find(
    (t) => t.id === testId && t.status === "open",
  );
  if (!test || test.status !== "open") {
    return ctx.reply("⏳ Hozir testlar yopiq.");
  }
  return startTest(ctx, test);
});

bot.action(/^ans:(\d+):(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const testId = Number(ctx.match[1]);
  const qIndex = Number(ctx.match[2]);
  const optIndex = Number(ctx.match[3]);

  const sessionTest = ctx.session.test;
  if (
    !sessionTest ||
    sessionTest.testId !== testId ||
    sessionTest.index !== qIndex
  ) {
    return;
  }

  const testsData = await getTestsData();
  const test = testsData.tests.find((t) => t.id === testId);
  if (!test) return;
  const question = test.questions[qIndex];
  if (!question) return;

  if (optIndex === question.correct_answer) {
    sessionTest.correct += 1;
  }

  sessionTest.index += 1;

  if (sessionTest.index >= test.questions.length) {
    const correct = sessionTest.correct;
    ctx.session.test = null;
    await finishTest(ctx, test, correct);
    return ctx.reply("✅ Test yakunlandi. Rahmat!");
  }

  return sendQuestion(ctx, test, sessionTest.index);
});

bot.hears("📊 Urinishlarim", async (ctx) => {
  if (!(await ensureJoined(ctx))) return;
  const resultsData = await getResultsData();
  const userResults = resultsData.results.filter(
    (r) => r.user_id === ctx.from.id,
  );
  if (!userResults.length) {
    return ctx.reply("ℹ️ Hali urinishlar yo'q.");
  }
  const testsData = await getTestsData();
  const testMap = new Map(testsData.tests.map((t) => [t.id, t.title]));
  const recent = userResults.slice(-5).reverse();
  const lines = recent.map((r, i) => {
    const title = testMap.get(r.test_id) || `Test #${r.test_id}`;
    return `${i + 1}. ${title} - ${r.percentage}% (${r.date})`;
  });
  return ctx.reply(
    `📊 Urinishlarim\n\nJami: ${userResults.length}\n${lines.join("\n")}`,
  );
});

bot.hears("ℹ️ Bot haqida", async (ctx) => {
  return ctx.reply(
    "💡 Ushbu bot STEAM yo‘nalishlari bo‘yicha bilimlarni mustahkamlash, intellektual raqobatni rivojlantirish va ishtirokchilarni doimiy o‘rganishga rag‘batlantirish uchun xizmat qiladi.\n\n🚀 Bilimingizni sinab ko‘ring, reytingda yuqoriga ko‘tariling va sovrinli g‘oliblardan biriga aylaning!",
  );
});

bot.hears("📣 Xabar yuborish", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.session.admin = { mode: "broadcast" };
  await ctx.reply(
    "📣 Xabar yuborish\n\nYuboriladigan xabarni jo'nating.\nBekor qilish: /cancel",
  );
});

bot.hears("🧩 Test yaratish", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.session.admin = {
    mode: "create_test_title",
    newTest: { title: "", totalQuestions: 0, questions: [] },
    currentQuestion: null,
  };
  await ctx.reply("🧩 Test yaratish (1/5)\n\nTest nomini kiriting.");
});

bot.hears("📚 Testlar", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await sendTestList(ctx);
});

bot.hears("📊 Natijalar", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await sendResultsSummary(ctx);
});

bot.hears("👥 Foydalanuvchilar", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await sendUsersList(ctx);
});

bot.hears("👑 Adminlar", async (ctx) => {
  if (!isSuperAdmin(ctx.from.id)) return;
  await ctx.reply(
    "👑 Adminlar\n\nKerakli amalni tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback("➕ Admin qo'shish", "admins_add")],
      [Markup.button.callback("➖ Admin o'chirish", "admins_remove")],
      [Markup.button.callback("📋 Adminlar ro'yxati", "admins_list")],
    ]),
  );
});

bot.hears("📡 Kanallar", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await sendChannelsList(ctx);
  await ctx.reply(
    "📡 Kanallar\n\nKerakli amalni tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback("➕ Kanal qo'shish", "channels_add")],
      [Markup.button.callback("➖ Kanal o'chirish", "channels_remove")],
    ]),
  );
});

bot.action("admins_add", async (ctx) => {
  await ctx.answerCbQuery();
  if (!isSuperAdmin(ctx.from.id)) return;
  ctx.session.admin = { mode: "add_admin" };
  await ctx.reply("👑 Admin qo'shish\n\nAdmin ID raqamini kiriting.");
});

bot.action("admins_remove", async (ctx) => {
  await ctx.answerCbQuery();
  if (!isSuperAdmin(ctx.from.id)) return;
  ctx.session.admin = { mode: "remove_admin" };
  await ctx.reply("👑 Admin o'chirish\n\nAdmin ID raqamini kiriting.");
});

bot.action("admins_list", async (ctx) => {
  await ctx.answerCbQuery();
  if (!isSuperAdmin(ctx.from.id)) return;
  await sendAdminList(ctx);
});

bot.action("channels_add", async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  ctx.session.admin = { mode: "add_channel" };
  await ctx.reply(
    "📡 Kanal qo'shish\n\nKanal username yoki ID kiriting (masalan: @kanal yoki -100123...).",
  );
});

bot.action("channels_remove", async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const channels = await getActiveChannels();
  if (!channels.length) {
    return ctx.reply("ℹ️ Faol kanallar yo'q.");
  }
  const rows = channels.map((c) => [
    Markup.button.callback(`${c.name}`, `remove_channel:${c.id}`),
  ]);
  await ctx.reply(
    "📡 Kanal o'chirish\n\nO'chiriladigan kanalni tanlang:",
    Markup.inlineKeyboard(rows),
  );
});

bot.action(/^remove_channel:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const channelId = Number(ctx.match[1]);
  const data = await getChannelsData();
  const channel = data.channels.find((c) => c.id === channelId);
  if (!channel) {
    return ctx.reply("⚠️ Kanal topilmadi.");
  }
  channel.status = "inactive";
  await saveChannelsData(data);
  await ctx.reply(`✅ Kanal o'chirildi: ${channel.name}`);
});

bot.action(/^test_toggle:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const testId = Number(ctx.match[1]);
  const testsData = await getTestsData();
  const test = testsData.tests.find((t) => t.id === testId);
  if (!test) {
    return ctx.reply("⚠️ Test topilmadi.");
  }
  test.status = test.status === "open" ? "closed" : "open";
  await saveTestsData(testsData);
  await ctx.reply(
    `✅ Test holati yangilandi: ${formatTestStatus(test.status)}`,
  );
});

bot.action(/^test_edit:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const testId = Number(ctx.match[1]);
  ctx.session.admin = { mode: "edit_test_title", testId };
  await ctx.reply("✏️ Test tahriri\n\nYangi test nomini kiriting.");
});

bot.action(/^test_answers:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isSuperAdmin(ctx.from.id)) return;
  const testId = Number(ctx.match[1]);
  const testsData = await getTestsData();
  const test = testsData.tests.find((t) => t.id === testId);
  if (!test) {
    return ctx.reply("⚠️ Test topilmadi.");
  }

  const lines = [];
  lines.push(`✅ Javoblar: ${test.title} #${test.id}`);
  lines.push(`Savollar: ${test.questions.length}`);
  lines.push("");

  test.questions.forEach((q, i) => {
    const correctIndex = Number(q.correct_answer);
    const label = Number.isInteger(correctIndex)
      ? optionLabel(correctIndex)
      : "?";
    const answerText =
      Number.isInteger(correctIndex) && q.options[correctIndex]
        ? q.options[correctIndex]
        : "—";

    lines.push(`${i + 1}. ${q.question}`);
    lines.push(`   ✅ ${label}. ${answerText}`);
    lines.push("");
  });

  await sendLongText(ctx, lines.join("\n"));
});

bot.action(/^test_delete:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const testId = Number(ctx.match[1]);
  await ctx.reply(
    `⚠️ Test #${testId} o'chirilsinmi?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "✅ Ha, o'chirish",
          `test_delete_confirm:${testId}`,
        ),
      ],
      [Markup.button.callback("❌ Bekor", "test_delete_cancel")],
    ]),
  );
});

bot.action(/^test_delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const testId = Number(ctx.match[1]);
  const testsData = await getTestsData();
  const before = testsData.tests.length;
  testsData.tests = testsData.tests.filter((t) => t.id !== testId);
  if (testsData.tests.length === before) {
    return ctx.reply("⚠️ Test topilmadi.");
  }
  await saveTestsData(testsData);
  await ctx.reply("✅ Test o'chirildi.");
});

bot.action("test_delete_cancel", async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  await ctx.reply("✅ Bekor qilindi.");
});

bot.action(/^test_status:(open|closed)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx.from.id)) return;
  const admin = ctx.session.admin;
  if (!admin || admin.mode !== "create_test_status") return;

  const testsData = await getTestsData();
  const nextId = testsData.tests.reduce((max, t) => Math.max(max, t.id), 0) + 1;

  const record = {
    id: nextId,
    title: admin.newTest.title,
    status: ctx.match[1],
    questions: admin.newTest.questions,
    created_at: formatDate(),
  };

  testsData.tests.push(record);
  await saveTestsData(testsData);

  ctx.session.admin = null;
  await ctx.reply(`✅ Test yaratildi: #${record.id} ${record.title}`);
  await showAdminMenu(ctx);
});

bot.on("message", async (ctx, next) => {
  if (ctx.from && isAdmin(ctx.from.id) && ctx.session && ctx.session.admin) {
    const handled = await handleAdminMessage(ctx);
    if (handled) return;
  }
  return next();
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

(async () => {
  await ensureDataFiles();
  await loadDynamicAdmins();
  await bot.launch();
  console.log("Feya Bot started");
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
