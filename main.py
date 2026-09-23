from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import requests
import os
import re
import json
import time
from dotenv import load_dotenv

from assessment import AssessmentValidationError, score_assessment, validate_assessment

load_dotenv()

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

RICH_CONTENT_INSTRUCTIONS = """ГЕОМЕТРИЧНИ ФИГУРИ: Само когато темата или въпросът реално изисква чертане на триъгълник (височина, медиана, ъглополовяща, вписана/описана окръжност), вмъкни ТОЧНО този елемент, попълнен с истински числени стойности (JSON вътре в единични кавички, без допълнителен текст вътре в елемента):
<div class="geo-figure" data-geo='{"type":"triangle","sides":{"a":5,"b":6,"c":7},"altitude":"A","median":null,"bisector":null,"incircle":false,"circumcircle":false,"caption":null}'></div>
Правила: sides.a е срещу връх A (страна BC), sides.b е срещу B (CA), sides.c е срещу C (AB); числата трябва да удовлетворяват триъгълното неравенство. altitude/median/bisector приемат "A", "B", "C" или null — задай ги само когато въпросът наистина се отнася до тях. incircle/circumcircle са true само ако се иска вписана/описана окръжност.

ГРАФИКИ НА ФУНКЦИИ: Само когато темата или въпросът изисква чертане на графика, вмъкни ТОЧНО този елемент:
<div class="fn-plot" data-plot='{"fns":["x^2-4*x+3"],"domain":[-2,6],"labels":["f(x)=x^2-4x+3"]}'></div>
Синтаксис на fns: само +, -, *, /, ^, sin, cos, tan, sqrt, abs, log, exp, pi; променливата е винаги x. Може да добавиш няколко функции в масива fns за сравнение."""

app.mount("/static", StaticFiles(directory=os.path.abspath(".")))

@app.get("/")
def home():
    return FileResponse("index.html")

@app.post("/generate-lesson")
async def generate_lesson(data: dict):
    topic = data.get("topic")
    subject = data.get("subject")
    grade = data.get("grade", "общообразователно ниво")

    if not topic or not subject:
        raise HTTPException(status_code=400, detail="Topic and subject are required")

    prompt = f"""Ти си опитен български учител. Създай ясен урок на ПЕРФЕКТЕН БЪЛГАРСКИ ЕЗИК за темата "{topic}" по предмет {subject} за ученик от {grade} клас.

ИНСТРУКЦИИ ЗА ТОНА И ЕЗИКА:
- Използвай академичен и професионален тон; избягвай детински метафори, олицетворяване на понятия и излишни приветствия.
- Пиши на богат и правилен български език, без русизми и без буквални преводи от английски.
- Фокусирай се върху логиката и точността на термините (напр. "ъгъл", а не "кути").
- Не използвай обръщения, хумор, емоции или поздрави към ученика.

ФОРМАТИРАНЕ (Върни САМО чист HTML):
- <h2> за заглавието
- <p> за параграфи
- <h3> за подтеми
- <ul><li> за списъци
- <div class="highlight-box"> за ключови понятия
- <div class="info-box"> за интересни факти

МАТЕМАТИЧЕСКИ ФОРМУЛИ: Ако темата изисква формули или уравнения, пиши ги в LaTeX синтаксис, като задължително ги обвиваш в разделители: \\( ... \\) за формула вътре в текста и \\[ ... \\] за формула на отделен ред. Никога не пиши LaTeX код без тези разделители.

{RICH_CONTENT_INSTRUCTIONS}

Завърши с "Основен извод" в <div class="highlight-box">. Без никакви обяснения извън кода."""

    try:
        response = requests.post(GROQ_URL, headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }, json={
            "model": "openai/gpt-oss-120b",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "top_p": 0.9
        })
        response.raise_for_status()
        result = response.json()
        html = result["choices"][0]["message"]["content"]
        if not html:
            raise HTTPException(status_code=500, detail="No content generated")
        return {"html": html.replace("```html", "").replace("```", "").strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(data: dict):
    user_msg = data.get("message")
    topic = data.get("topic")
    subject = data.get("subject")
    grade = data.get("grade", "общообразователно ниво")
    lesson_text = data.get("lesson_text", "")

    if not user_msg or not topic or not subject:
        raise HTTPException(status_code=400, detail="Message, topic, and subject are required")

    prompt = f"""Ти си опитен преподавател по {subject}, който отговаря на въпроси на ученик от {grade} клас. Твоята цел е да обясниш "{topic}" точно и професионално.

КОНТЕКСТ ОТ УРОКА:
{lesson_text[:500]}

ВЪПРОС НА УЧЕНИКА:
{user_msg}

ИНСТРУКЦИИ ЗА ОТГОВОРА (КРИТИЧНО ВАЖНО):
1. ЕЗИК: Пиши на ПЕРФЕКТЕН БЪЛГАРСКИ. Използвай само официална терминология (напр. "правоъгълен триъгълник", "хипотенуза", "катет", "ъгъл").
2. ТОН: Използвай академичен и сериозен тон. ЗАБРАНЕНО е използването на детински метафори, олицетворяване на понятия и фамилиарни обръщения като "малкият".
3. СТРУКТУРА: Максимум 3-4 изречения. Отговорът трябва да е директен и фактологичен.
4. ЗАБРАНИ: Не превеждай буквално от английски. Не измисляй несъществуващи термини. Без излишни поздрави.
5. ЗАВЪРШЕК: Завърши с един въпрос, който да провери дали ученикът е разбрал логиката.
6. МАТЕМАТИЧЕСКИ ФОРМУЛИ: Ако отговорът съдържа формула или уравнение, пиши я в LaTeX синтаксис, задължително обвита в разделители: \\( ... \\) за формула в текста или \\[ ... \\] за формула на отделен ред.
7. ГЕОМЕТРИЧНИ ФИГУРИ И ГРАФИКИ: Ако въпросът наистина изисква чертане на триъгълник или графика на функция, вмъкни съответния елемент по-долу — иначе отговори само с текст.

{RICH_CONTENT_INSTRUCTIONS}

Върни САМО текста на отговора (може да съдържа елементите по-горе), без никакви допълнителни обяснения."""

    try:
        response = requests.post(GROQ_URL, headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }, json={
            "model": "openai/gpt-oss-120b",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "top_p": 0.9,
        })
        response.raise_for_status()
        result = response.json()
        reply = result["choices"][0]["message"]["content"]
        if not reply:
            raise HTTPException(status_code=500, detail="No reply generated")
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def build_assessment_prompt(lesson_text: str, subject: str, topic: str, grade: str, num_questions: int) -> str:
    return f"""Ти си опитен български учител по {subject}. Въз основа на СЛЕДНИЯ урок за темата "{topic}" (клас: {grade}), създай тест, който проверява САМО материала, преподаден в този урок.

УРОК:
{lesson_text[:4000]}

ЗАДАЧА:
1. Определи 3 до 6 най-важни области за оценяване (теми/умения), изведени от съдържанието на урока — НЕ използвай фиксиран или предварително известен списък от теми.
2. Създай точно {num_questions} въпроса, разпределени балансирано между тези области — не съсредоточавай повечето въпроси върху една подробност.
3. Използвай смес от трудности: приблизително 40% лесни (difficulty=1), 40% средни (difficulty=2), 20% трудни (difficulty=3).
4. Избери типа на всеки въпрос според предмета и съдържанието:
   - "multiple_choice" — въпрос с точно 4 варианта в "options", един от които е верен.
   - "true_false" — options трябва да е ["Вярно", "Невярно"].
   - "short_answer" — кратък текстов отговор; correctAnswer може да е списък от приемливи формулировки.
   - "numeric" — числов отговор.
   - "expression" — математически отговор, който може да съдържа няколко стойности (напр. корени на уравнение); correctAnswer е списък от низове с всички приемливи стойности.
5. За математика и точни науки: предпочитай РЕШАВАНЕ на конкретна задача пред искане на определение (напр. "Реши x²-5x+6=0", а не "Какво е разлагане на множители?").
6. Никога не задавай въпрос за понятие, което НЕ е споменато в урока.
7. Избягвай дублирани или почти еднакви въпроси.
8. Всеки въпрос трябва да има ясно обяснение (explanation) защо посоченият отговор е верен — за математика с решение стъпка по стъпка, за други предмети — кратко затвърждаване на понятието.

Върни САМО валиден JSON обект (без markdown, без коментари извън JSON) с точно тази структура:
{{
  "topics": ["Тема 1", "Тема 2"],
  "questions": [
    {{
      "question": "текст на въпроса",
      "type": "multiple_choice",
      "options": ["...", "...", "...", "..."],
      "correctAnswer": "точен низ, съвпадащ с един от options",
      "explanation": "обяснение или решение стъпка по стъпка",
      "topic": "една от темите в topics",
      "difficulty": 1
    }}
  ]
}}"""


@app.post("/generate-test")
async def generate_test(data: dict):
    lesson_text = data.get("lesson_text")
    topic = data.get("topic")
    subject = data.get("subject")
    grade = data.get("grade", "общообразователно ниво")

    if not lesson_text or not topic or not subject:
        raise HTTPException(status_code=400, detail="lesson_text, topic, and subject are required")

    try:
        num_questions = int(data.get("num_questions", 8))
    except (TypeError, ValueError):
        num_questions = 8
    num_questions = max(3, min(num_questions, 15))

    plain_lesson = re.sub(r"<[^>]+>", " ", lesson_text)
    plain_lesson = re.sub(r"\s+", " ", plain_lesson).strip()

    base_prompt = build_assessment_prompt(plain_lesson, subject, topic, grade, num_questions)
    retry_note = "\n\nВАЖНО: Предишният ти отговор не беше валиден според изисквания формат. Върни САМО валиден JSON обект точно по описаната по-горе структура, без никакъв друг текст."

    last_error = "unknown error"
    for attempt in range(2):
        try:
            response = requests.post(GROQ_URL, headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            }, json={
                "model": "openai/gpt-oss-120b",
                "messages": [{"role": "user", "content": base_prompt + (retry_note if attempt else "")}],
                "temperature": 0.3,
                "top_p": 0.9,
                "response_format": {"type": "json_object"},
            })
            response.raise_for_status()
            result = response.json()
            raw_content = result["choices"][0]["message"]["content"]
            parsed = json.loads(raw_content)
            validated = validate_assessment(parsed, min_questions=max(3, num_questions // 2))
            return validated
        except (AssessmentValidationError, json.JSONDecodeError, KeyError) as e:
            last_error = str(e)
            continue
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 429 and attempt == 0:
                wait_s = min(float(e.response.headers.get("retry-after", 3)), 10)
                time.sleep(wait_s)
                last_error = "rate limited, retried"
                continue
            raise HTTPException(status_code=502, detail=f"Groq request failed: {e}")
        except requests.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Groq request failed: {e}")

    raise HTTPException(status_code=502, detail=f"Неуспешно генериране на валиден тест: {last_error}")


@app.post("/evaluate-test")
async def evaluate_test(data: dict):
    questions = data.get("questions")
    answers = data.get("answers")

    if not isinstance(questions, list) or not questions:
        raise HTTPException(status_code=400, detail="questions must be a non-empty list")
    if not isinstance(answers, dict):
        raise HTTPException(status_code=400, detail="answers must be an object")

    # Never trust the client's questions/answers blindly - re-validate the
    # echoed-back assessment before scoring against it.
    declared_topics = sorted({q.get("topic", "") for q in questions if isinstance(q, dict) and q.get("topic")})
    try:
        validated = validate_assessment({"topics": declared_topics, "questions": questions}, min_questions=1)
    except AssessmentValidationError as e:
        raise HTTPException(status_code=400, detail=f"Invalid questions payload: {e}")

    return score_assessment(validated["questions"], answers)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)