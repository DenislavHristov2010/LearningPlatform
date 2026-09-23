let lessonLoadTimer = null;
let currentGrade = '';
let currentSubject = '';
let currentUnit = '';
let currentTopic = '';
let currentLessonContent = '';
let savedLessons = JSON.parse(localStorage.getItem('luminary_saved') || '[]');

const subjectDataMapping = {
  'math': 'Математика',
  'bulgarian': 'български език и литература',
  'english': 'Английски език',
  'history': 'История',
  'biology': 'Биология и здравно образование',
  'physics': 'физика_и_астрономия',
  'chemistry': 'химия и опазване на околната среда',
  'cs': 'информатика',
  'geography': 'geography',
  'art': 'Изобразително изкуство',
  'chovek_prirodata': 'Човекът и природата',
  'chovek_obshtestvo': 'Човекът и обществото',
  'rodinoznanie': 'родинознание'
};

const subjects = [
  { id: 'math', letter: 'М', name: 'Математика',
    desc: 'Алгебра, геометрия, смятане и още',
    accentColor: '#f0c060', accentBorder: 'rgba(240,192,96,0.4)',
    letterBg: 'rgba(240,192,96,0.12)' },
  { id: 'bulgarian', letter: 'Б', name: 'Български език',
    desc: 'Граматика, писане, литература',
    accentColor: '#6eb5ff', accentBorder: 'rgba(110,181,255,0.4)',
    letterBg: 'rgba(110,181,255,0.12)' },
  { id: 'english', letter: 'А', name: 'Английски език',
    desc: 'Граматика, речник, разговорна практика',
    accentColor: '#6effa0', accentBorder: 'rgba(110,255,160,0.4)',
    letterBg: 'rgba(110,255,160,0.12)' },
  { id: 'history', letter: 'И', name: 'История и цивилизация',
    desc: 'Световна и българска история',
    accentColor: '#ff9f6b', accentBorder: 'rgba(255,159,107,0.4)',
    letterBg: 'rgba(255,159,107,0.12)' },
  { id: 'biology', letter: 'Б', name: 'Биология',
    desc: 'Животни, растения, човешко тяло',
    accentColor: '#5dde8f', accentBorder: 'rgba(93,222,143,0.4)',
    letterBg: 'rgba(93,222,143,0.12)' },
  { id: 'physics', letter: 'Ф', name: 'Физика',
    desc: 'Движение, енергия, светлина',
    accentColor: '#ff9f6b', accentBorder: 'rgba(255,159,107,0.4)',
    letterBg: 'rgba(255,159,107,0.12)' },
  { id: 'chemistry', letter: 'Х', name: 'Химия',
    desc: 'Вещества, реакции и опазване на околната среда',
    accentColor: '#ff8c00', accentBorder: 'rgba(255,140,0,0.4)',
    letterBg: 'rgba(255,140,0,0.12)' },
  { id: 'cs', letter: 'И', name: 'Информатика',
    desc: 'Програмиране, алгоритми, уеб',
    accentColor: '#b08fff', accentBorder: 'rgba(176,143,255,0.4)',
    letterBg: 'rgba(176,143,255,0.12)' },
  { id: 'geography', letter: 'Г', name: 'География и икономика',
    desc: 'Физическа и социална география',
    accentColor: '#5dd6de', accentBorder: 'rgba(93,214,222,0.4)',
    letterBg: 'rgba(93,214,222,0.12)' },
  { id: 'art', letter: 'И', name: 'Изобразително изкуство',
    desc: 'Теория, история и техники',
    accentColor: '#ff7eb3', accentBorder: 'rgba(255,126,179,0.4)',
    letterBg: 'rgba(255,126,179,0.12)' },
  { id: 'chovek_prirodata', letter: 'П', name: 'Човекът и природата',
    desc: 'Основи на природата и човешкото здраве',
    accentColor: '#8fd14f', accentBorder: 'rgba(143,209,79,0.4)',
    letterBg: 'rgba(143,209,79,0.12)' },
  { id: 'chovek_obshtestvo', letter: 'О', name: 'Човекът и обществото',
    desc: 'Социални умения, държава, гражданство',
    accentColor: '#ffb74d', accentBorder: 'rgba(255,183,77,0.4)',
    letterBg: 'rgba(255,183,77,0.12)' },
  { id: 'rodinoznanie', letter: 'Р', name: 'Родинознание',
    desc: 'Познай своя роден край и родина',
    accentColor: '#4da6ff', accentBorder: 'rgba(77,166,255,0.4)',
    letterBg: 'rgba(77,166,255,0.12)' }
];

const quickTopics = [
  { letter: 'П', name: 'Питагорова теорема',  sub: 'math',    topic: 'Геометрия' },
  { letter: 'Д', name: 'ДНК и генетика',       sub: 'science', topic: 'Генетика' },
  { letter: 'В', name: 'Българско Възраждане', sub: 'history', topic: 'Българско Възраждане' },
  { letter: 'Ц', name: 'Цикли в Python',        sub: 'cs',      topic: 'Python основи' },
];

const gradeLabels = {
  '1': '1. клас',  '2': '2. клас',  '3': '3. клас',  '4': '4. клас',
  '5': '5. клас',  '6': '6. клас',  '7': '7. клас',  '8': '8. клас',
  '9': '9. клас',  '10': '10. клас', '11': '11. клас', '12': '12. клас',
};

function getDataSubjectNames(subjectId) {
  const val = subjectDataMapping[subjectId];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function isSubjectAvailableForGrade(subjectId, grade) {
  if (!grade) return true;
  const names = getDataSubjectNames(subjectId);
  for (const name of names) {
    const dataSubject = topicsBySubject[name];
    if (dataSubject && dataSubject[grade]) return true;
  }
  return false;
}

function renderHome() {
  const grid = document.getElementById('subject-grid');
  let displaySubjects = subjects;
  if (currentGrade) {
    displaySubjects = subjects.filter(s => isSubjectAvailableForGrade(s.id, currentGrade));
  }

  grid.innerHTML = displaySubjects.map(s => `
    <div class="subject-card" onclick="openSubject('${s.id}')"
      style="--card-accent: linear-gradient(135deg, transparent 60%, ${s.accentColor}08);
             --card-accent-border: ${s.accentBorder}">
      <div class="subject-letter" style="background:${s.letterBg}; color:${s.accentColor}">
        ${s.letter}
      </div>
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
    </div>
  `).join('');

  const qGrid = document.getElementById('quick-grid');
  qGrid.innerHTML = quickTopics.map(q => `
    <div class="subject-card" onclick="openSubjectTopic('${q.sub}', '${q.topic}')">
      <div class="subject-letter" style="background:rgba(240,192,96,0.1); color:var(--accent)">
        ${q.letter}
      </div>
      <h3>${q.name}</h3>
      <p>Бърз урок — кликни за начало</p>
    </div>
  `).join('');
}

function navigate(screen) {
  ['home', 'lesson', 'saved'].forEach(s => {
    document.getElementById(`${s}-screen`).style.display = 'none';
    const tab = document.getElementById(`tab-${s}`);
    if (tab) tab.classList.remove('active');
  });
  document.getElementById(`${screen}-screen`).style.display = 'block';
  const tab = document.getElementById(`tab-${screen}`);
  if (tab) tab.classList.add('active');
  if (screen === 'saved') renderSaved();
}

function onGradeChange() {
  currentGrade = document.getElementById('grade-select').value;
  const indicator = document.getElementById('grade-indicator');
  const label     = document.getElementById('grade-label');

  if (currentGrade) {
    label.textContent = gradeLabels[currentGrade] || currentGrade;
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }

  renderHome();
}

function openSubject(subjectId) {
  currentSubject = subjectId;
  const subj = subjects.find(s => s.id === subjectId);
  navigate('lesson');
  
  const gradeLabel = currentGrade ? ` · ${gradeLabels[currentGrade]}` : '';
  document.getElementById('lesson-breadcrumb').textContent = `${subj.name}${gradeLabel}`;
  document.getElementById('lesson-title').textContent = 'Избери раздел';

  document.getElementById('step-unit')?.classList.add('active');
  document.getElementById('step-topic')?.classList.remove('active');

  const gradeKey = currentGrade || '1';
  let units = [];
  const names = getDataSubjectNames(subjectId);
  for (const name of names) {
    const dataSubj = topicsBySubject[name];
    if (dataSubj && dataSubj[gradeKey]) {
      units = dataSubj[gradeKey];
      break;
    }
  }

  const pills = document.getElementById('topic-pills');
  if (units.length > 0) {
    pills.innerHTML = units.map((u, idx) => `
      <div class="topic-pill" onclick="selectUnit('${u.unit}', ${idx}, this)">
        <span class="pill-label">${u.unit}</span>
        <span class="pill-count">${(u.topics?.length || 0)} теми</span>
      </div>
    `).join('');
  } else {
    pills.innerHTML = '<div class="topic-pill disabled">Няма налични раздели за този клас</div>';
  }

  document.getElementById('lesson-content').innerHTML = '';
  document.getElementById('ai-chat').innerHTML = `
    <div class="chat-msg ai">
      Здравей! Аз съм твоят AI учител по <strong>${subj.name}</strong>. Избери раздел отгоре и после тема. Попитай ме да обясня нещо по-просто, да дам пример или да те изпитам!
    </div>`;
}

function selectUnit(unitName, unitIndex, el) {
  currentUnit = unitName;
  document.querySelectorAll('.topic-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  
  document.getElementById('lesson-title').textContent = unitName;
  document.getElementById('step-unit')?.classList.remove('active');
  document.getElementById('step-topic')?.classList.add('active');

  const dataSubjectName = subjectDataMapping[currentSubject];
  const dataSubject = topicsBySubject[dataSubjectName];
  const gradeKey = currentGrade || '1';
  const units = dataSubject && dataSubject[gradeKey] ? dataSubject[gradeKey] : [];
  const currentUnitData = units[unitIndex];
  
  if (currentUnitData && currentUnitData.topics) {
    const topicsHtml = `
      <h3>Теми в раздела:</h3>
      <div class="topic-grid">
        ${currentUnitData.topics.map(t => `
          <div class="topic-card" onclick="selectTopic('${t.replace(/'/g, "\\'")}', this)">
            <div class="topic-card-title">${t}</div>
            <div class="topic-card-meta">Кликни, за да започнеш урока</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('lesson-content').innerHTML = topicsHtml;
  }
}

function openSubjectTopic(subjectId, topic) {
  openSubject(subjectId);

  const gradeKey = currentGrade || '1';
  const names = getDataSubjectNames(subjectId);
  let units = [];
  for (const name of names) {
    const dataSubj = topicsBySubject[name];
    if (dataSubj && dataSubj[gradeKey]) {
      units = dataSubj[gradeKey];
      break;
    }
  }

  const unitIndex = units.findIndex(u => u.topics && u.topics.includes(topic));
  if (unitIndex >= 0) {
    const pillEls = document.querySelectorAll('#topic-pills .topic-pill');
    const pillEl = pillEls[unitIndex];
    if (pillEl) {
      selectUnit(units[unitIndex].unit, unitIndex, pillEl);
      setTimeout(() => {
        const topicCards = document.querySelectorAll('.topic-card');
        const matched = Array.from(topicCards).find(c => c.textContent.trim().startsWith(topic));
        if (matched) selectTopic(topic, matched);
      }, 30);
    }
  }
}

function selectTopic(topic, el) {
  currentTopic = topic;
  if (el) {
    document.querySelectorAll('.topic-card').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
  }
  
  clearTimeout(lessonLoadTimer);
  lessonLoadTimer = setTimeout(() => loadLessonContent(topic), 600);
}

async function loadLessonContent(topic) {
  const contentEl = document.getElementById('lesson-content');
  const progress  = document.getElementById('lesson-progress');

  contentEl.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  progress.style.width = '0%';

  const grade = currentGrade ? gradeLabels[currentGrade] : 'общообразователно ниво';
  const subj  = subjects.find(s => s.id === currentSubject);

  const prompt = `Създай ясен и увлекателен урок на БЪЛГАРСКИ ЕЗИК за темата "${topic}" в предмет ${subj?.name} за ученик от ${grade}.

Форматирай отговора като HTML използвайки само тези елементи (без html/body тагове):
- <h2> за заглавието
- <p> за параграфи
- <h3> за подтеми
- <ul><li> за списъци
- <div class="highlight-box"> за ключови понятия
- <div class="info-box"> за интересни факти

Изисквания: подходящо за класа, ясно с реални примери, около 350 думи, завърши с "Основен извод" в highlight-box. Върни САМО HTML, без обяснения.`;

  try {
    progress.style.width = '40%';
    const response = await fetch('http://localhost:8000/generate-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: topic,
        subject: subj?.name,
        grade: grade
      })
    });
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const html = data.html;
    progress.style.width = '100%';

    if (!html) throw new Error('empty');

    const clean = html.replace(/```html|```/g, '').trim();
    currentLessonContent = clean;
    contentEl.innerHTML  = clean;

    setTimeout(() => { progress.style.width = '0%'; }, 900);
  } catch (err) {
    progress.style.width = '0%';
    contentEl.innerHTML = `
      <div class="highlight-box">
        <h2>${topic}</h2>
        <p>Грешка при зареждане. Провери дали FastAPI сървърът работи.</p>
      </div>`;
  }
}

function saveLesson() {
  if (!currentTopic) {
    showToast('Няма урок за запазване!', true);
    return;
  }

  const subj  = subjects.find(s => s.id === currentSubject);
  const grade = currentGrade ? gradeLabels[currentGrade] : 'Общо';

  const lesson = {
    id: Date.now(),
    unit: currentUnit,
    topic: currentTopic,
    subject: subj?.name || '',
    subjectId: currentSubject,
    grade,
    content: currentLessonContent,
    savedAt: new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }),
  };

  savedLessons = savedLessons.filter(l => !(l.topic === lesson.topic && l.grade === lesson.grade && l.unit === lesson.unit));
  savedLessons.unshift(lesson);
  localStorage.setItem('luminary_saved', JSON.stringify(savedLessons));
  showToast(`"${currentTopic}" е запазен!`);
}

function renderSaved() {
  const container = document.getElementById('saved-container');

  if (!savedLessons.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">С</div>
        <h3>Все още няма запазени уроци</h3>
        <p>Когато запазиш урок, той ще се появи тук.</p>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="saved-grid">' +
    savedLessons.map(l => `
      <div class="saved-card" onclick="loadSavedLesson(${l.id})">
        <div class="saved-card-meta">
          <span class="badge">${l.subject}</span>
          <span class="badge">${l.grade}</span>
          <span style="margin-left:auto">${l.savedAt}</span>
        </div>
        <div class="saved-card-title">${l.topic}</div>
        <div class="saved-card-preview">${l.content.replace(/<[^>]+>/g, '').substring(0, 130)}…</div>
      </div>
    `).join('') + '</div>';
}

function loadSavedLesson(id) {
  const lesson = savedLessons.find(l => l.id === id);
  if (!lesson) return;

  currentSubject       = lesson.subjectId;
  currentUnit          = lesson.unit;
  currentTopic         = lesson.topic;
  currentLessonContent = lesson.content;

  navigate('lesson');
  document.getElementById('lesson-breadcrumb').textContent = `${lesson.subject} · ${lesson.grade}`;
  document.getElementById('lesson-title').textContent      = lesson.unit;

  document.getElementById('step-unit')?.classList.add('active');
  document.getElementById('step-topic')?.classList.add('active');

  const gradeKey = lesson.grade;
  let units = [];
  const names = getDataSubjectNames(lesson.subjectId);
  for (const name of names) {
    const dataSubj = topicsBySubject[name];
    if (dataSubj && dataSubj[gradeKey]) {
      units = dataSubj[gradeKey];
      break;
    }
  }
  
  const pills  = document.getElementById('topic-pills');
  pills.innerHTML = units.map((u, idx) => `
    <div class="topic-pill ${u.unit === lesson.unit ? 'active' : ''}" onclick="selectUnit('${u.unit}', ${idx}, this)">
      <span class="pill-label">${u.unit}</span>
      <span class="pill-count">${(u.topics?.length || 0)} теми</span>
    </div>
  `).join('');

  const currentUnitData = units.find(u => u.unit === lesson.unit);
  if (currentUnitData && currentUnitData.topics) {
    const topicsHtml = `
      <h3>Теми в раздела:</h3>
      <div class="topic-grid">
        ${currentUnitData.topics.map(t => `
          <div class="topic-card ${t === lesson.topic ? 'active' : ''}" onclick="selectTopic('${t.replace(/'/g, "\\'")}', this)">
            <div class="topic-card-title">${t}</div>
            <div class="topic-card-meta">Кликни, за да започнеш урока</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('lesson-content').innerHTML = topicsHtml + '<br>' + lesson.content;
  } else {
    document.getElementById('lesson-content').innerHTML  = lesson.content;
  }
  
  document.getElementById('lesson-progress').style.width = '0%';
  document.getElementById('ai-chat').innerHTML = `
    <div class="chat-msg ai">
      Добре дошъл обратно! Преглеждаш урока за <strong>${lesson.topic}</strong>. Попитай ме каквото искаш!
    </div>`;
}

async function sendAIMessage() {
  const input = document.getElementById('ai-input');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.style.height = 'auto';
  sendAIChat(msg);
}

function sendPromptChip(el) {
  const text  = el.textContent.trim();
  const grade = currentGrade ? gradeLabels[currentGrade] : 'общо ниво';
  const map   = {
    'Обясни по-просто': `Обясни "${currentTopic}" по най-простия начин за ученик от ${grade}.`,
    'Дай ми пример':   `Дай ми реален пример от живота за "${currentTopic}".`,
    'Изпитай ме':      `Изпитай ме по "${currentTopic}" с един въпрос.`,
    'Защо е важно?':   `Защо е важна темата "${currentTopic}" в реалния живот?`,
  };
  sendAIChat(map[text] || text);
}

async function sendAIChat(userMsg) {
  const chat = document.getElementById('ai-chat');
  const btn  = document.getElementById('ai-send-btn');
  btn.disabled = true;

  const userEl = document.createElement('div');
  userEl.className   = 'chat-msg user';
  userEl.textContent = userMsg;
  chat.appendChild(userEl);

  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-msg ai';
  loadingEl.innerHTML = '<div class="loading-dots" style="padding:4px 0;justify-content:flex-start"><span></span><span></span><span></span></div>';
  chat.appendChild(loadingEl);
  chat.scrollTop = chat.scrollHeight;

  const grade      = currentGrade ? gradeLabels[currentGrade] : 'общообразователно ниво';
  const subj       = subjects.find(s => s.id === currentSubject);
  const lessonText = currentLessonContent.replace(/<[^>]+>/g, '').substring(0, 500);

  const prompt = `Ти си учител, който помага на ученик от ${grade} да разбере "${currentTopic}" в предмет ${subj?.name}.

Контекст от урока: ${lessonText}

Въпрос: ${userMsg}

Отговори на БЪЛГАРСКИ с прост и топъл тон. Максимум 3-4 изречения. Без markdown форматиране. Завърши с насърчение или следващ въпрос.`;

  try {
    const response = await fetch('http://localhost:8000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMsg,
        topic: currentTopic,
        subject: subj?.name,
        grade: grade,
        lesson_text: lessonText
      })
    });
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const reply = data.reply;
    loadingEl.textContent = reply || 'Неуспешен отговор. Опитай пак.';
  } catch (err) {
    loadingEl.textContent = 'Грешка при свързване. Провери дали FastAPI сървърът работи.';
  }

  btn.disabled = false;
  chat.scrollTop = chat.scrollHeight;
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
  t.style.color       = isError ? 'var(--danger)' : 'var(--success)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

renderHome();
navigate('home');