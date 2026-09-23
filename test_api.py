import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def _groq_response(content: str, status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"choices": [{"message": {"content": content}}]}
    return resp


VALID_ASSESSMENT_JSON = json.dumps({
    "topics": ["Factoring", "Quadratic Formula"],
    "questions": [
        {
            "question": "Solve x^2-5x+6=0",
            "type": "expression",
            "options": None,
            "correctAnswer": ["2", "3"],
            "explanation": "(x-2)(x-3)=0 so x=2 or x=3.",
            "topic": "Factoring",
            "difficulty": 2,
        },
        {
            "question": "What is the discriminant formula?",
            "type": "multiple_choice",
            "options": ["b^2-4ac", "b^2+4ac", "-b/2a", "a+b+c"],
            "correctAnswer": "b^2-4ac",
            "explanation": "The discriminant is b^2-4ac.",
            "topic": "Quadratic Formula",
            "difficulty": 1,
        },
        {
            "question": "x^2+2x+1=0 has a double root.",
            "type": "true_false",
            "options": ["Вярно", "Невярно"],
            "correctAnswer": "Вярно",
            "explanation": "Discriminant is 0, giving one repeated root.",
            "topic": "Discriminant",
            "difficulty": 2,
        },
    ],
})


class TestGenerateTestEndpoint:
    def test_missing_fields_returns_400(self):
        r = client.post("/generate-test", json={"topic": "X"})
        assert r.status_code == 400

    @patch("main.requests.post")
    def test_valid_generation_returns_validated_schema(self, mock_post):
        mock_post.return_value = _groq_response(VALID_ASSESSMENT_JSON)
        r = client.post("/generate-test", json={
            "lesson_text": "<h2>Quadratic Equations</h2><p>...</p>",
            "topic": "Quadratic Equations",
            "subject": "Математика",
            "grade": "9",
            "num_questions": 3,
        })
        assert r.status_code == 200
        data = r.json()
        assert len(data["questions"]) == 3
        assert data["questions"][0]["id"] == 0
        assert "Factoring" in data["topics"]

    @patch("main.requests.post")
    def test_invalid_json_triggers_retry_then_fails(self, mock_post):
        mock_post.return_value = _groq_response("not json at all")
        r = client.post("/generate-test", json={
            "lesson_text": "lesson",
            "topic": "T",
            "subject": "S",
            "grade": "9",
        })
        assert r.status_code == 502
        assert mock_post.call_count == 2  # one retry attempt

    @patch("main.requests.post")
    def test_retry_succeeds_after_first_bad_response(self, mock_post):
        mock_post.side_effect = [
            _groq_response("garbage"),
            _groq_response(VALID_ASSESSMENT_JSON),
        ]
        r = client.post("/generate-test", json={
            "lesson_text": "lesson",
            "topic": "T",
            "subject": "S",
            "grade": "9",
            "num_questions": 3,
        })
        assert r.status_code == 200
        assert mock_post.call_count == 2

    @patch("main.requests.post")
    def test_missing_required_field_in_ai_output_fails(self, mock_post):
        bad = json.dumps({"topics": ["A"], "questions": [{"question": "q"}]})
        mock_post.return_value = _groq_response(bad)
        r = client.post("/generate-test", json={
            "lesson_text": "lesson", "topic": "T", "subject": "S", "grade": "9",
        })
        assert r.status_code == 502

    @patch("main.requests.post")
    def test_num_questions_clamped(self, mock_post):
        big_assessment = json.dumps({
            "topics": ["T"],
            "questions": [
                {"question": f"Question {i}?", "type": "multiple_choice", "options": ["a", "b", "c", "d"],
                 "correctAnswer": "a", "explanation": "e", "topic": "T", "difficulty": 1}
                for i in range(15)
            ],
        })
        mock_post.return_value = _groq_response(big_assessment)
        r = client.post("/generate-test", json={
            "lesson_text": "lesson", "topic": "T", "subject": "S", "grade": "9",
            "num_questions": 999,
        })
        assert r.status_code == 200
        assert len(r.json()["questions"]) == 15
        sent_prompt = mock_post.call_args[1]["json"]["messages"][0]["content"]
        assert "точно 15 въпроса" in sent_prompt


class TestEvaluateTestEndpoint:
    def _valid_questions(self):
        return [
            {"id": 0, "question": "2+2?", "type": "multiple_choice", "options": ["3", "4"],
             "correctAnswer": "4", "explanation": "e", "topic": "Arithmetic", "difficulty": 1},
            {"id": 1, "question": "3+3?", "type": "multiple_choice", "options": ["5", "6"],
             "correctAnswer": "6", "explanation": "e", "topic": "Arithmetic", "difficulty": 1},
        ]

    def test_missing_questions_returns_400(self):
        r = client.post("/evaluate-test", json={"answers": {}})
        assert r.status_code == 400

    def test_missing_answers_returns_400(self):
        r = client.post("/evaluate-test", json={"questions": self._valid_questions()})
        assert r.status_code == 400

    def test_empty_questions_list_returns_400(self):
        r = client.post("/evaluate-test", json={"questions": [], "answers": {}})
        assert r.status_code == 400

    def test_malformed_question_payload_returns_400(self):
        r = client.post("/evaluate-test", json={
            "questions": [{"question": "no type or answer"}],
            "answers": {},
        })
        assert r.status_code == 400

    def test_valid_submission_scored_correctly(self):
        r = client.post("/evaluate-test", json={
            "questions": self._valid_questions(),
            "answers": {"0": "4", "1": "5"},
        })
        assert r.status_code == 200
        data = r.json()
        assert data["score"] == 1
        assert data["total"] == 2
        assert data["percentage"] == 50
        assert data["byTopic"]["Arithmetic"]["total"] == 2

    def test_math_equivalent_answer_formats_accepted(self):
        questions = [{
            "id": 0, "question": "Solve x^2-5x+6=0", "type": "expression", "options": None,
            "correctAnswer": ["2", "3"], "explanation": "(x-2)(x-3)=0", "topic": "Factoring", "difficulty": 2,
        }]
        r = client.post("/evaluate-test", json={
            "questions": questions,
            "answers": {"0": "x = 3, x = 2"},
        })
        assert r.status_code == 200
        assert r.json()["score"] == 1
