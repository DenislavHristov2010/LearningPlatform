"""Assessment (end-of-lesson test) generation validation, and answer scoring.

Kept separate from main.py so the pure logic (schema validation, safe math
comparison, scoring) can be unit tested without spinning up FastAPI or
calling the Groq API.
"""
import math
import re
from typing import List, Optional, Union

from pydantic import BaseModel, ValidationError, field_validator

QUESTION_TYPES = {"multiple_choice", "true_false", "short_answer", "numeric", "expression", "matching"}
MATH_TYPES = {"numeric", "expression"}


class AssessmentValidationError(Exception):
    """Raised when an AI-generated assessment cannot be salvaged into a valid one."""


class AssessmentQuestion(BaseModel):
    question: str
    type: str
    options: Optional[List[str]] = None
    correctAnswer: Union[str, List[str]]
    explanation: str
    topic: str
    difficulty: int = 2

    @field_validator("type")
    @classmethod
    def _check_type(cls, v):
        if v not in QUESTION_TYPES:
            raise ValueError(f"invalid question type: {v}")
        return v

    @field_validator("correctAnswer", "options", mode="before")
    @classmethod
    def _stringify_scalars(cls, v):
        # The model sometimes emits bare JSON numbers for numeric answers
        # (e.g. 18 instead of "18") - normalize to strings before validation.
        if isinstance(v, list):
            return [str(x) for x in v]
        if v is None:
            return v
        return str(v)


class AssessmentData(BaseModel):
    topics: List[str]
    questions: List[AssessmentQuestion]


def _normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def validate_assessment(raw: dict, min_questions: int = 3) -> dict:
    """Validate and clean an AI-generated (or client-echoed) assessment.

    Drops individual malformed questions (missing topic/answer, invalid MC
    options, duplicates) rather than failing outright on a single bad
    question, but raises AssessmentValidationError if the whole payload is
    unusable or too few valid questions remain afterwards.
    """
    try:
        data = AssessmentData.model_validate(raw)
    except ValidationError as e:
        raise AssessmentValidationError(f"schema invalid: {e}")

    if not data.questions:
        raise AssessmentValidationError("no questions")

    topic_set = {t.strip() for t in data.topics if t.strip()}
    seen = set()
    cleaned = []

    for q in data.questions:
        qtext = q.question.strip()
        if not qtext:
            continue
        key = _normalize_text(qtext)
        if key in seen:
            continue

        topic = q.topic.strip()
        if not topic:
            continue

        correct = q.correctAnswer
        options = q.options

        if q.type == "multiple_choice":
            opts = [o.strip() for o in (options or []) if o.strip()]
            if len(opts) < 2:
                continue
            correct_str = correct if isinstance(correct, str) else (correct[0] if correct else "")
            correct_str = correct_str.strip()
            if not correct_str or not any(_normalize_text(correct_str) == _normalize_text(o) for o in opts):
                continue
            options = opts
            correct = correct_str
        else:
            if isinstance(correct, list):
                correct = [str(a).strip() for a in correct if str(a).strip()]
                if not correct:
                    continue
            else:
                correct = str(correct).strip()
                if not correct:
                    continue

        explanation = q.explanation.strip()
        if not explanation:
            continue

        seen.add(key)
        topic_set.add(topic)
        cleaned.append({
            "id": len(cleaned),
            "question": qtext,
            "type": q.type,
            "options": options,
            "correctAnswer": correct,
            "explanation": explanation,
            "topic": topic,
            "difficulty": q.difficulty if q.difficulty in (1, 2, 3) else 2,
        })

    if len(cleaned) < min_questions:
        raise AssessmentValidationError(f"too few valid questions after cleaning ({len(cleaned)})")

    return {"topics": sorted(topic_set), "questions": cleaned}


# ---------- safe numeric expression evaluator (no eval/exec) ----------

class _MathParseError(Exception):
    pass


def _tokenize_math(expr: str) -> List[str]:
    return re.findall(r"\d+\.?\d*|\.\d+|\*\*|[+\-*/^(),]|[A-Za-z_]+", expr)


def _parse_and_eval(expr: str) -> float:
    tokens = _tokenize_math(expr)
    if not tokens:
        raise _MathParseError("empty expression")
    pos = [0]

    def peek():
        return tokens[pos[0]] if pos[0] < len(tokens) else None

    def advance():
        tok = tokens[pos[0]]
        pos[0] += 1
        return tok

    def parse_expression():
        value = parse_term()
        while peek() in ("+", "-"):
            op = advance()
            rhs = parse_term()
            value = value + rhs if op == "+" else value - rhs
        return value

    def parse_term():
        value = parse_unary()
        while peek() in ("*", "/"):
            op = advance()
            rhs = parse_unary()
            value = value * rhs if op == "*" else value / rhs
        return value

    def parse_unary():
        if peek() == "-":
            advance()
            return -parse_unary()
        if peek() == "+":
            advance()
            return parse_unary()
        return parse_power()

    def parse_power():
        value = parse_atom()
        if peek() in ("^", "**"):
            advance()
            rhs = parse_unary()
            value = value ** rhs
        return value

    _FUNCS = {"sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "tan": math.tan,
              "abs": abs, "log": math.log, "exp": math.exp}

    def parse_atom():
        tok = peek()
        if tok is None:
            raise _MathParseError("unexpected end of expression")
        if tok == "(":
            advance()
            value = parse_expression()
            if peek() == ")":
                advance()
            return value
        if re.match(r"^(\d|\.)", tok):
            advance()
            return float(tok)
        if re.match(r"^[A-Za-z_]", tok):
            advance()
            name = tok.lower()
            if name == "pi":
                return math.pi
            if name == "e":
                return math.e
            if peek() == "(":
                advance()
                args = [parse_expression()]
                while peek() == ",":
                    advance()
                    args.append(parse_expression())
                if peek() == ")":
                    advance()
                fn = _FUNCS.get(name)
                if fn is None:
                    raise _MathParseError(f"unknown function {name}")
                return fn(*args)
            raise _MathParseError(f"unknown identifier {name}")
        raise _MathParseError(f"unexpected token {tok}")

    result = parse_expression()
    if pos[0] != len(tokens):
        raise _MathParseError("trailing tokens")
    return result


def try_eval_numeric(s: str) -> Optional[float]:
    try:
        return _parse_and_eval(s)
    except Exception:
        return None


_LABEL_PREFIX_RE = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*\s*[=:]\s*")
_SPLIT_RE = re.compile(r",|;|\band\b|\bи\b", re.IGNORECASE)


def _extract_value_tokens(answer: Union[str, List[str]]) -> List[str]:
    """Turn a math answer (string or list) into normalized value tokens,
    stripping 'x=' style labels and splitting on commas/'and'/'и'."""
    raw_parts = [str(a) for a in answer] if isinstance(answer, list) else _SPLIT_RE.split(str(answer))
    tokens = []
    for part in raw_parts:
        part = part.strip()
        if not part:
            continue
        part = _LABEL_PREFIX_RE.sub("", part).strip()
        if part:
            tokens.append(part)
    return tokens


def _tokens_equal(a: str, b: str) -> bool:
    a_num, b_num = try_eval_numeric(a), try_eval_numeric(b)
    if a_num is not None and b_num is not None:
        return math.isclose(a_num, b_num, rel_tol=1e-6, abs_tol=1e-9)
    return _normalize_text(a).replace(" ", "") == _normalize_text(b).replace(" ", "")


def compare_math_answers(correct: Union[str, List[str]], user: Union[str, List[str]]) -> bool:
    """Order-independent comparison of (possibly multi-value) math answers.

    Tolerant of 'x=' prefixes, spacing, value order, and numeric formatting
    (e.g. '2,3' == 'x=3, x=2' == '3 and 2'). No eval/exec is used.
    """
    correct_tokens = _extract_value_tokens(correct)
    user_tokens = _extract_value_tokens(user) if user is not None else []
    if not correct_tokens or not user_tokens or len(correct_tokens) != len(user_tokens):
        return False
    remaining = list(user_tokens)
    for ct in correct_tokens:
        idx = next((i for i, ut in enumerate(remaining) if _tokens_equal(ct, ut)), None)
        if idx is None:
            return False
        remaining.pop(idx)
    return True


def evaluate_answer(question: dict, user_answer) -> bool:
    if user_answer is None or (isinstance(user_answer, str) and not user_answer.strip()):
        return False

    qtype = question["type"]
    correct = question["correctAnswer"]

    if qtype in ("multiple_choice", "true_false"):
        return _normalize_text(str(user_answer)) == _normalize_text(str(correct))

    if qtype in MATH_TYPES:
        return compare_math_answers(correct, user_answer)

    # short_answer / matching: exact match or fuzzy word-overlap against any accepted phrasing
    candidates = correct if isinstance(correct, list) else [correct]
    user_norm = _normalize_text(str(user_answer))
    if not user_norm:
        return False
    for c in candidates:
        c_norm = _normalize_text(str(c))
        if not c_norm:
            continue
        if user_norm == c_norm:
            return True
        c_words, u_words = set(c_norm.split()), set(user_norm.split())
        if c_words and u_words:
            overlap = len(c_words & u_words) / len(c_words | u_words)
            if overlap >= 0.6:
                return True
    return False


def score_assessment(questions: List[dict], answers: dict) -> dict:
    """answers maps question id (str or int) -> the user's submitted answer."""
    results = []
    topic_stats: dict = {}

    for q in questions:
        qid = q["id"]
        user_answer = answers.get(str(qid), answers.get(qid))
        is_correct = evaluate_answer(q, user_answer)

        stats = topic_stats.setdefault(q["topic"], {"correct": 0, "total": 0})
        stats["total"] += 1
        if is_correct:
            stats["correct"] += 1

        results.append({
            "id": qid,
            "question": q["question"],
            "type": q["type"],
            "options": q.get("options"),
            "topic": q["topic"],
            "difficulty": q.get("difficulty", 2),
            "userAnswer": user_answer,
            "correctAnswer": q["correctAnswer"],
            "isCorrect": is_correct,
            "explanation": q["explanation"],
        })

    total = len(questions)
    correct_count = sum(1 for r in results if r["isCorrect"])
    percentage = round((correct_count / total) * 100) if total else 0

    by_topic = {
        topic: {
            "correct": stats["correct"],
            "total": stats["total"],
            "percentage": round((stats["correct"] / stats["total"]) * 100) if stats["total"] else 0,
        }
        for topic, stats in topic_stats.items()
    }

    return {
        "score": correct_count,
        "total": total,
        "percentage": percentage,
        "byTopic": by_topic,
        "results": results,
    }
