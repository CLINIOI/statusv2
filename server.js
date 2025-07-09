// server.js

require('dotenv').config();
const express     = require('express');
const bodyParser  = require('body-parser');
const path        = require('path');
const fs          = require('fs');
const multer      = require('multer');
const TelegramBot = require('node-telegram-bot-api');

// === Конфиг ===
const PORT       = process.env.PORT     || 3000;
const BOT_TOKEN  = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const app = express();

// === Пути к папкам и файлам ===

const htmlDir   = path.join(__dirname, 'html');
const dataDir   = path.join(__dirname, 'data');
const imagesDir = path.join(dataDir, 'images');
const jsonFile  = path.join(dataDir, 'properties.json');

// === Убеждаемся, что папки существуют ===
if (!fs.existsSync(dataDir))   fs.mkdirSync(dataDir,   { recursive: true });
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// === Настройка multer для загрузки изображений ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesDir),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext    = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + unique + ext);
  }
});
const upload = multer({ storage });
// === СТАТИКА ===
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/telegram-form-sender', express.static(path.join(__dirname, 'telegram-form-sender')));
app.use(express.static(path.join(__dirname, 'public')));
const favicon = require('serve-favicon');
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

// === HTML ===
app.use('/', express.static(path.join(__dirname, 'html')));
// === Раздача статики ===
// 1) HTML/CSS/JS из папки html/
app.use(express.static(htmlDir));
// 2) Данные и картинки из папки data/
app.use('/data', express.static(dataDir));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// === Роуты HTML-страниц ===
app.get('/',            (req, res) => res.sendFile(path.join(htmlDir, 'index.html')));
app.get('/realty.html', (req, res) => res.sendFile(path.join(htmlDir, 'realty.html')));
app.get('/test2.html',  (req, res) => res.sendFile(path.join(htmlDir, 'test2.html')));

// === Обработка формы добавления недвижимости ===
app.post('/submit', upload.array('images'), (req, res) => {
  try {
    const {
      dealType, propertyType, title,
      currency, price,
      city, district, address,
      rooms, floor, totalFloors,
      areaTotal, areaLiving, areaKitchen,
      bathroomType, balcony, repair,
      description
    } = req.body;

    // Собираем пути картинок относительно корня проекта
    const images = req.files.map(f =>
      path.posix.join('data', 'images', path.basename(f.path))
    );

    const property = {
      id: Date.now(),
      dealType,
      propertyType,
      title,
      currency,
      price: price ? Number(price) : null,
      location: { city, district, address },
      specs: {
        rooms:      rooms     ? Number(rooms)     : null,
        floor:      floor     ? Number(floor)     : null,
        totalFloors: totalFloors ? Number(totalFloors) : null,
        area: {
          total:   areaTotal   ? Number(areaTotal)   : null,
          living:  areaLiving  ? Number(areaLiving)  : null,
          kitchen: areaKitchen ? Number(areaKitchen) : null
        },
        bathroomType: bathroomType || null,
        balcony:      balcony === 'true',
        repair:       repair || null
      },
      description: description || '',
      images,
      createdAt: new Date().toISOString()
    };

    // Читаем, дополняем и сохраняем JSON
    const props = fs.existsSync(jsonFile)
      ? JSON.parse(fs.readFileSync(jsonFile, 'utf-8'))
      : [];
    props.push(property);
    fs.writeFileSync(jsonFile, JSON.stringify(props, null, 2), 'utf-8');

    res.json({ success: true, property });
  } catch (err) {
    console.error('Ошибка сохранения объявления:', err);
    res.status(500).json({ error: 'Ошибка при сохранении данных' });
  }
});

// === Утилиты и константы для Telegram ===
const MODE_TITLES = {
  1: 'ОСТАВИТЬ ОТЗЫВ',
  2: 'ПОЛУЧИТЬ КОНСУЛЬТАЦИЮ',
  4: 'РЕАЛИЗАЦИЯ НЕДВИЖИМОСТИ',
  5: 'ЗАПРОСИТЬ ЗВОНОК',
  6: 'ДРУГОЙ ВОПРОС'
};
const MODE_HASHTAGS = {
  1: '#ОТЗЫВ',
  2: '#КОНСУЛЬТАЦИЯ',
  4: '#НЕДВИЖИМОСТЬ',
  5: '#ЗВОНОК',
  6: '#ДРУГОЙ_ВОПРОС'
};
const FIELD_LABELS = {
  name:         'Имя',
  contact:      'Контакт',
  email:        'Электронная почта',
  question:     'Вопрос',
  review:       'Отзыв',
  comments:     'Комментарии',
  address:      'Адрес',
  property_type:'Тип недвижимости',
  deal_type:    'Тип сделки',
  time:         'Время'
};

function escapeHtml(str = '') {
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function stars(rating) {
  const n = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
  return n > 0 ? '⭐'.repeat(n) : '—';
}

// === Инициализация Telegram-бота ===
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// === Обработка отправки данных в Telegram ===
app.post('/api/sendTelegram', async (req, res) => {
  try {
    const { mode, data } = req.body;
    if (!mode || typeof data !== 'object') {
      return res.status(400).json({ error: 'Неправильный формат запроса' });
    }

    const title     = (MODE_TITLES[mode] || `ФОРМА ${mode}`).toUpperCase();
    const tagMain   = MODE_HASHTAGS[mode] || '';
    const tagActual = '#актуально';
    const tagCat    = `#актуально_${title.replace(/ /g, '_').toLowerCase()}`;
    const now       = new Date().toLocaleString('ru-RU', { hour12: false });

    let text = [
      `🔴 <b>АКТИВНО</b>`,
      `${escapeHtml(tagMain)} ${escapeHtml(tagActual)} ${escapeHtml(tagCat)}`,
      '',
      `✉️ <b>Новая заявка: ${escapeHtml(title)}</b>`,
      `🕒 <i>${escapeHtml(now)}</i>`,
      ''
    ].join('\n');

    for (const [key, value] of Object.entries(data)) {
      const v = value == null ? '' : value.toString();
      if (key === 'rating') {
        text += `\n• <b>Оценка</b>: ${stars(v)} (${escapeHtml(v)})`;
      } else {
        const label = FIELD_LABELS[key] || key;
        text += `\n• <b>${escapeHtml(label)}</b>: ${escapeHtml(v)}`;
      }
    }

    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Отреагировал', callback_data: `reacted_${mode}` }]
        ]
      }
    };

    await bot.sendMessage(CHANNEL_ID, text, opts);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отправки в Telegram:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// === Обработка inline-кнопок в Telegram ===
bot.on('callback_query', async (query) => {
  try {
    const { id, data, message } = query;
    if (!data.startsWith('reacted_')) {
      return bot.answerCallbackQuery(id);
    }

    const mode       = data.split('_')[1];
    const title      = (MODE_TITLES[mode] || `ФОРМА ${mode}`).toUpperCase();
    const tagMain    = MODE_HASHTAGS[mode] || '';
    const reactedTag = '#отреагирована';
    const catTag     = `#отреагирована_${title.replace(/ /g, '_').toLowerCase()}`;

    const parts = message.text.split('\n\n');
    const body  = parts.slice(2).join('\n\n').trim();

    const newText = [
      '🟢 <b>ОТРЕАГИРОВАНА</b>',
      escapeHtml(tagMain),
      escapeHtml(reactedTag),
      escapeHtml(catTag),
      '',
      body
    ].join('\n');

    await bot.editMessageText(newText, {
      chat_id:    message.chat.id,
      message_id: message.message_id,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    });
    await bot.answerCallbackQuery(id);
  } catch (err) {
    console.error('Ошибка callback:', err);
    await bot.answerCallbackQuery(query.id, { text: 'Ошибка реакции' });
  }
});

// === Запуск сервера ===
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
