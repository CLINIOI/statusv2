require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

// === Конфиг ===
const BOT_TOKEN  = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PORT       = process.env.PORT || 3000;

// === Настройка статики ===
// Главный: делаем корень — корнем
app.use(express.static(__dirname)); // <-- теперь работает /assets, /css, /html и т.д.
app.use(bodyParser.json());

// === Главная страница ===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "index.html"));
});

// === Константы ===
const MODE_TITLES = {
  1: "ОСТАВИТЬ ОТЗЫВ",
  2: "ПОЛУЧИТЬ КОНСУЛЬТАЦИЮ",
  4: "РЕАЛИЗАЦИЯ НЕДВИЖИМОСТИ",
  5: "ЗАПРОСИТЬ ЗВОНОК",
  6: "ДРУГОЙ ВОПРОС",
};
const MODE_HASHTAGS = {
  1: "#ОТЗЫВ",
  2: "#КОНСУЛЬТАЦИЯ",
  4: "#НЕДВИЖИМОСТЬ",
  5: "#ЗВОНОК",
  6: "#ДРУГОЙ_ВОПРОС",
};
const FIELD_LABELS = {
  name: "Имя",
  contact: "Контакт",
  email: "Электронная почта",
  question: "Вопрос",
  review: "Отзыв",
  comments: "Комментарии",
  address: "Адрес",
  property_type: "Тип недвижимости",
  deal_type: "Тип сделки",
  time: "Время",
};

function escapeHtml(str = "") {
  return str
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function stars(rating) {
  const n = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
  return n > 0 ? "⭐".repeat(n) : "—";
}

// === Инициализация Telegram-бота ===
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// === Обработка форм ===
app.post("/api/sendTelegram", async (req, res) => {
  try {
    const { mode, data } = req.body;
    if (!mode || typeof data !== "object") {
      return res.status(400).json({ error: "Неправильный формат запроса" });
    }

    const title        = (MODE_TITLES[mode] || `ФОРМА ${mode}`).toUpperCase();
    const tagMain      = MODE_HASHTAGS[mode] || "";
    const tagActual    = "#актуально";
    const tagActualCat = `#актуально_${title.replace(/ /g, "_").toLowerCase()}`;
    const statusLine   = "🔴 <b>АКТИВНО</b>";
    const now          = new Date().toLocaleString("ru-RU", { hour12: false });

    let text = [
      statusLine,
      `${escapeHtml(tagMain)} ${escapeHtml(tagActual)} ${escapeHtml(tagActualCat)}`,
      "",
      `✉️ <b>Новая заявка: ${escapeHtml(title)}</b>`,
      `🕒 <i>${escapeHtml(now)}</i>`,
      ""
    ].join("\n");

    for (let [key, value] of Object.entries(data)) {
      const v = value == null ? "" : value.toString();
      if (key === "rating") {
        text += `\n• <b>Оценка</b>: ${stars(v)} (${escapeHtml(v)})`;
      } else {
        const label = FIELD_LABELS[key] || key;
        text += `\n• <b>${escapeHtml(label)}</b>: ${escapeHtml(v)}`;
      }
    }

    const opts = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Отреагировал", callback_data: `reacted_${mode}` }]
        ]
      }
    };

    await bot.sendMessage(CHANNEL_ID, text, opts);
    res.json({ success: true });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// === Обработка нажатий по кнопке "Отреагировал" ===
bot.on("callback_query", async (query) => {
  try {
    const { id, data, message } = query;
    if (!data.startsWith("reacted_")) return bot.answerCallbackQuery(id);

    const mode       = data.split("_")[1];
    const title      = (MODE_TITLES[mode] || `ФОРМА ${mode}`).toUpperCase();
    const tagMain    = MODE_HASHTAGS[mode] || "";
    const reactedTag = "#отреагирована";
    const reactedCat = `#отреагирована_${title.replace(/ /g, "_").toLowerCase()}`;

    const parts = message.text.split("\n\n");
    const body  = parts.slice(2).join("\n\n").trim();

    const newText = [
      "🟢 <b>ОТРЕАГИРОВАНА</b>",
      escapeHtml(tagMain),
      escapeHtml(reactedTag),
      escapeHtml(reactedCat),
      "",
      body
    ].join("\n");

    await bot.editMessageText(newText, {
      chat_id:    message.chat.id,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] }
    });

    await bot.answerCallbackQuery(id);
  } catch (err) {
    console.error("Callback error:", err);
    await bot.answerCallbackQuery(query.id, { text: "Ошибка реакции", show_alert: false });
  }
});

// === Запуск сервера ===
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
