const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = 3000;
const SECRET = 'super_secret_key_for_coping_2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.sqlite');

// ─── ИНИЦИАЛИЗАЦИЯ БАЗЫ ───
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, password TEXT,
        fio TEXT, org TEXT, dep TEXT, pos TEXT, birth_year INTEGER, role TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Добавлены поля для научной обработки: protocol (сырые данные), total_score, retest_of (для отсроченного контроля)
    db.run(`CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, answers TEXT,
        protocol TEXT, total_score INTEGER, top_strategy TEXT, top_adapt TEXT, recommendation TEXT,
        retest_of INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        q_id TEXT, block TEXT, text TEXT, strategy TEXT, adapt TEXT, sort_order INTEGER
    )`);

    // Заполняем вопросами при первом запуске
    db.get(`SELECT COUNT(*) as count FROM questions`, (err, row) => {
        if (row.count === 0) {
            const defaultQuestions = [
                ['A1', 'A', 'Говорю себе: «В данный момент есть что-то важнее, чем трудности».', 'Игнорирование', 'Относительно адаптивная', 1],
                ['A2', 'A', 'Говорю себе: «Это судьба, нужно с этим смириться».', 'Смирение', 'Неадаптивная', 2],
                ['A3', 'A', 'Это несущественные трудности, их просто не замечаю.', 'Диссимуляция', 'Относительно адаптивная', 3],
                ['A4', 'A', 'Стараюсь сохранять самообладание и не терять головы.', 'Сохранение самообладания', 'Адаптивная', 4],
                ['A5', 'A', 'Анализирую проблему и ищу возможные пути её решения.', 'Проблемный анализ', 'Адаптивная', 5],
                ['A6', 'A', 'Сравниваю свои трудности с трудностями других людей.', 'Относительность', 'Относительно адаптивная', 6],
                ['A7', 'A', 'Верю, что всё случилось по воле Бога.', 'Религиозность', 'Относительно адаптивная', 7],
                ['A8', 'A', 'Не знаю, что делать, теряюсь и впадаю в растерянность.', 'Растерянность', 'Неадаптивная', 8],
                ['A9', 'A', 'Придаю происходящему особый смысл.', 'Придача смысла', 'Относительно адаптивная', 9],
                ['A10', 'A', 'Вспоминаю, что я сильная личность.', 'Установка собственной ценности', 'Адаптивная', 10],
                ['B1', 'B', 'Возмущаюсь, протестую против происходящего.', 'Протест', 'Адаптивная', 11],
                ['B2', 'B', 'Даю волю эмоциям, плачу, кричу.', 'Эмоциональная разрядка', 'Неадаптивная', 12],
                ['B3', 'B', 'Подавляю эмоции, стараюсь не показывать своих чувств.', 'Подавление эмоций', 'Неадаптивная', 13],
                ['B4', 'B', 'Верю, что всё образуется, сохраняю оптимизм.', 'Оптимизм', 'Адаптивная', 14],
                ['B5', 'B', 'Пассивно жду, что кто-то поможет.', 'Пассивная кооперация', 'Относительно адаптивная', 15],
                ['B6', 'B', 'Смиряюсь, покоряюсь судьбе.', 'Покорность', 'Неадаптивная', 16],
                ['B7', 'B', 'Обвиняю себя во всём.', 'Самообвинение', 'Неадаптивная', 17],
                ['B8', 'B', 'Злюсь на всех, проявляю агрессию.', 'Агрессивность', 'Неадаптивная', 18],
                ['V1', 'V', 'Отвлекаюсь на что-то другое.', 'Отвлечение', 'Относительно адаптивная', 19],
                ['V2', 'V', 'Помогаю другим — от этого легче и мне.', 'Альтруизм', 'Адаптивная', 20],
                ['V3', 'V', 'Избегаю общения, стараюсь не думать о проблеме.', 'Активное избегание', 'Неадаптивная', 21],
                ['V4', 'V', 'Компенсирую проблему чем-то приятным: едой, покупками.', 'Компенсация', 'Относительно адаптивная', 22],
                ['V5', 'V', 'Ищу конструктивный выход: планирую, действую.', 'Конструктивная активность', 'Относительно адаптивная', 23],
                ['V6', 'V', 'Отступаю, замыкаюсь.', 'Отступление', 'Неадаптивная', 24],
                ['V7', 'V', 'Сотрудничаю с другими, ищу поддержку.', 'Сотрудничество', 'Адаптивная', 25],
                ['V8', 'V', 'Обращаюсь к специалистам, прошу совета.', 'Обращение', 'Адаптивная', 26]
            ];
            const stmt = db.prepare(`INSERT INTO questions (q_id, block, text, strategy, adapt, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
            defaultQuestions.forEach(q => stmt.run(q));
            stmt.finalize();
        }
    });
});

// ─── ФУНКЦИЯ РЕКОМЕНДАЦИЙ (3-этапная модель) ───
function buildRecommendation(topAdapt, topStrategy) {
    if (topAdapt === 'Адаптивная') {
        return `Сотрудник демонстрирует адаптивные копинг-стратегии (ведущая: ${topStrategy}).\n` +
               `Этап 1. Оценка ресурсов: анализ сильных сторон, поддержка.\n` +
               `Этап 2. Закрепление: профилактические беседы, тренинги.\n` +
               `Этап 3. Мониторинг: отсроченный контроль через 6 месяцев.`;
    } else if (topAdapt === 'Относительно адаптивная') {
        return `Сотрудник использует относительно адаптивные стратегии (ведущая: ${topStrategy}).\n` +
               `Этап 1. Анализ ситуаций: выявление триггеров и привычных реакций.\n` +
               `Этап 2. Обучение альтернативам: развитие гибкости копинга.\n` +
               `Этап 3. Отработка: ролевые игры, кейсы.`;
    } else {
        return `ВНИМАНИЕ: Сотрудник склонен к неадаптивным стратегиям (ведущая: ${topStrategy}).\n` +
               `Этап 1. Кризисная поддержка: эмоциональная разгрузка, безопасность.\n` +
               `Этап 2. Коррекция: замена деструктивных стратегий.\n` +
               `Этап 3. Сопровождение: регулярные встречи с психологом.`;
    }
}

// ─── API АВТОРИЗАЦИИ ───
app.post('/api/register', async (req, res) => {
    const { fio, org, dep, pos, birthYear, login, password } = req.body;
    if (!fio || !login || !password) return res.status(400).json({ error: 'Заполните обязательные поля' });
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (login, password, fio, org, dep, pos, birth_year) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [login, hash, fio, org, dep, pos, birthYear || null],
        function(err) {
            if (err) return res.status(400).json({ error: 'Логин уже занят' });
            res.json({ ok: true });
        });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    db.get(`SELECT * FROM users WHERE login = ?`, [login], async (err, user) => {
        if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Неверный пароль' });
        const token = jwt.sign({ id: user.id, login: user.login, role: user.role }, SECRET);
        res.json({ token, user: { fio: user.fio, org: user.org, dep: user.dep, pos: user.pos, birthYear: user.birth_year } });
    });
});

// ─── API ВОПРОСОВ ───
app.get('/api/questions', (req, res) => {
    db.all(`SELECT * FROM questions ORDER BY sort_order ASC`, [], (err, rows) => res.json(rows));
});

app.post('/api/questions/save', (req, res) => {
    const { questions } = req.body; 
    db.run(`DELETE FROM questions`, [], (err) => {
        const stmt = db.prepare(`INSERT INTO questions (q_id, block, text, strategy, adapt, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
        questions.forEach((q, index) => stmt.run([q.q_id, q.block, q.text, q.strategy, q.adapt, index + 1]));
        stmt.finalize();
        res.json({ ok: true });
    });
});

// ─── СОХРАНЕНИЕ РЕЗУЛЬТАТОВ И ПРОТОКОЛА ───
app.post('/api/results', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, SECRET);
        const { answers, topStrategy, topAdapt } = req.body;
        
        db.all(`SELECT * FROM questions`, [], (err, questions) => {
            const protocol = questions.map(q => ({
                q_id: q.q_id, block: q.block, text: q.text, strategy: q.strategy, adapt: q.adapt,
                answer: answers[q.q_id] || null, score: answers[q.q_id] || 0
            }));
            
            const totalScore = Object.values(answers).reduce((a,b)=>a+b, 0);
            const rec = buildRecommendation(topAdapt, topStrategy);
            
            db.run(`INSERT INTO results (user_id, answers, protocol, total_score, top_strategy, top_adapt, recommendation) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [decoded.id, JSON.stringify(answers), JSON.stringify(protocol), totalScore, topStrategy, topAdapt, rec],
                function(err) { 
                    if(err) return res.status(500).json({error: err.message});
                    res.json({ ok: true, id: this.lastID, recommendation: rec }); 
                });
        });
    } catch (e) { res.status(401).json({ error: 'Неверный токен' }); }
});

// ─── АДМИНКА: АНАЛИТИКА ───
app.get('/api/admin/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as total_users FROM users`, (err, uRow) => {
        db.get(`SELECT COUNT(*) as total_results FROM results`, (err, rRow) => {
            db.all(`SELECT top_adapt, COUNT(*) as count FROM results GROUP BY top_adapt`, (err, adaptRows) => {
                db.all(`SELECT u.fio, u.dep, r.top_adapt, r.created_at FROM results r JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC LIMIT 10`, (err, recentRows) => {
                    res.json({ totalUsers: uRow.total_users, totalResults: rRow.total_results, adaptStats: adaptRows, recent: recentRows });
                });
            });
        });
    });
});

// ─── АДМИНКА: ПСИХОМЕТРИЯ ───
app.get('/api/admin/psychometrics', (req, res) => {
    db.all(`SELECT protocol FROM results WHERE protocol IS NOT NULL`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const protocols = rows.map(r => JSON.parse(r.protocol));
        if (protocols.length === 0) return res.json({ message: 'Нет данных' });
        
        const strategyStats = {};
        protocols.forEach(p => {
            p.forEach(item => {
                if (!strategyStats[item.strategy]) strategyStats[item.strategy] = { sum: 0, count: 0, values: [] };
                strategyStats[item.strategy].sum += item.score;
                strategyStats[item.strategy].count++;
                strategyStats[item.strategy].values.push(item.score);
            });
        });
        
        const result = Object.entries(strategyStats).map(([name, s]) => {
            const mean = s.sum / s.count;
            const variance = s.values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / s.count;
            const sd = Math.sqrt(variance);
            return { strategy: name, mean: mean.toFixed(2), sd: sd.toFixed(2), n: s.count };
        });
        
        res.json({ totalProtocols: protocols.length, strategies: result });
    });
});

// ─── АДМИНКА: ЭКСПОРТ CSV ───
app.get('/api/admin/export', (req, res) => {
    if (req.query.key !== 'admin123') return res.status(403).send('Доступ запрещён');
    db.all(`SELECT u.fio, u.org, u.dep, u.pos, u.birth_year, u.login, r.top_strategy, r.top_adapt, r.total_score, r.recommendation, r.answers, r.created_at 
            FROM users u LEFT JOIN results r ON u.id = r.user_id ORDER BY r.created_at DESC`, [], (err, rows) => {
        let csv = 'ФИО;Организация;Подразделение;Должность;Год рождения;Логин;Ведущая стратегия;Адаптивность;Балл;Рекомендация;Ответы;Дата\n';
        rows.forEach(row => {
            const rec = (row.recommendation || '').replace(/\n/g, ' ');
            csv += `"${row.fio || ''}";"${row.org || ''}";"${row.dep || ''}";"${row.pos || ''}";"${row.birth_year || ''}";"${row.login}";"${row.top_strategy || ''}";"${row.top_adapt || ''}";"${row.total_score || 0}";"${rec}";"${row.answers || ''}";"${row.created_at || ''}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8-sig');
        res.setHeader('Content-Disposition', 'attachment; filename="coping_results.csv"');
        res.send('\uFEFF' + csv);
    });
});

app.listen(PORT, () => { console.log(`Сервер запущен: http://localhost:${PORT}`); });