from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import requests
import os
from dotenv import load_dotenv

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

Върни САМО текста на отговора, без никакви допълнителни обяснения."""

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)