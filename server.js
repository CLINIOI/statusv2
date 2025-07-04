require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// === Пути ===
const publicDir  = path.join(__dirname, 'public');
const htmlDir    = path.join(publicDir, 'html');
const dataDir    = path.join(publicDir, 'data');
const imagesDir  = path.join(dataDir, 'images');
const jsonFile   = path.join(dataDir, 'properties.json');

// === Убеждаемся, что папки есть ===
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// === Telegram ===
const BOT_TOKEN  = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// === Multer ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${unique}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// === Middleware ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(publicDir));

// === Роуты HTML ===
app.get('/', (req, res) => res.sendFile(path.join(htmlDir, 'index.html')));
app.get('/realty.html', (req, res) => res.sendFile(path.join(htmlDir, 'realty.html')));
app.get('/test2.html', (req, res) => res.sendFile(path.join(htmlDir, 'test2.html')));

// === POST: Добавить объект недвижимости ===
app.post('/submit', upload.array('images'), (req, res) => {
  try {
    const { dealType, propertyType, title, currency, price, city, district, address, rooms, floor, totalFloors, areaTotal, areaLiving, areaKitchen, bathroomType, balcony, repair, description } = req.body;
    const images = req.files.map(f => path.posix.join('data', 'images', path.basename(f.path)));
    const property = {
      id: Date.now(),
      dealType,
      propertyType,
      title,
      currency,
      price: price ? Number(price) : null,
      location: { city, district, address },
      specs: {
        rooms: Number(rooms) || null,
        floor: Number(floor) || null,
        totalFloors: Number(totalFloors) || null,
        area: {
          total: Number(areaTotal) || null,
          living: Number(areaLiving) || null,
          kitchen: Number(areaKitchen) || null
        },
        bathroomType,
        balcony: balcony === 'true',
        repair
      },
      description: description || '',
      images,
      createdAt: new Date().toISOString()
    };
    const existing = fs.existsSync(jsonFile)
      ? JSON.parse(fs.readFileSync(jsonFile, 'utf-8'))
      : [];
    existing.push(property);
    fs.writeFileSync(jsonFile, JSON.stringify(existing, null, 2), 'utf-8');
    res.json({ success: true, property });
  } catch (err) {
    console.error('Ошибка при сохранении:', err);
    res.status(500).json({ error: 'Ошибка при сохранении данных' });
  }
});

// === POST: Отправка формы в Telegram ===
app.post('/api/sendTelegram', async (req, res) => {
  try {
    const { mode, data } = req.body;
    if (!mode || typeof data !== 'object') return res.status(400).json({ error: 'Неверный формат данных' });

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
      name: 'Имя', contact: 'Контакт', email: 'Email',
      question: 'Вопрос', review: 'Отзыв', comments: 'Комментарий',
      address: 'Адрес', property_type: 'Тип недвижимости',
      deal_type: 'Тип сделки', time: 'Время'
    };

    function escapeHtml(str = '') {
      return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function stars(rate) {
      const r = parseInt(rate, 10);
      return isNaN(r) ? '—' : '⭐'.repeat(Math.max(0, Math.min(r, 5)));
    }

    const title = MODE_TITLES[mode] || `ФОРМА ${mode}`;
    const tag1 = MODE_HASHTAGS[mode] || '';
    const tag2 = '#актуально';
    const tag3 = `#актуально_${title.replace(/ /g, '_').toLowerCase()}`;
    const now = new Date().toLocaleString('ru-RU', { hour12: false });

    let text = `🔴 <b>АКТИВНО</b>\n${tag1} ${tag2} ${tag3}\n\n✉️ <b>Новая заявка: ${escapeHtml(title)}</b>\n🕒 <i>${escapeHtml(now)}</i>\n`;

    for (const [key, value] of Object.entries(data)) {
      const label = FIELD_LABELS[key] || key;
      const val = key === 'rating' ? `${stars(value)} (${value})` : escapeHtml(value);
      text += `\n• <b>${label}</b>: ${val}`;
    }

    await bot.sendMessage(CHANNEL_ID, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Отреагировал', callback_data: `reacted_${mode}` }]]
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка Telegram:', err);
    res.status(500).json({ error: 'Ошибка Telegram' });
  }
});

// === Запуск сервера ===
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
