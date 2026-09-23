import pytest

from assessment import (
    AssessmentValidationError,
    compare_math_answers,
    evaluate_answer,
    score_assessment,
    validate_assessment,
)


def make_mc(topic="Topic A", difficulty=1, **overrides):
    q = {
        "question": "What is 2+2?",
        "type": "multiple_choice",
        "options": ["3", "4", "5", "6"],
        "correctAnswer": "4",
        "explanation": "2+2 equals 4.",
        "topic": topic,
        "difficulty": difficulty,
    }
    q.update(overrides)
    return q


# ---------- schema / validation ----------

class TestValidateAssessment:
    def test_valid_assessment_passes(self):
        raw = {"topics": ["Topic A"], "questions": [make_mc(), make_mc(question="What is 3+3?", correctAnswer="6", options=["5", "6", "7", "8"])]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 2
        assert result["questions"][0]["id"] == 0
        assert result["questions"][1]["id"] == 1
        assert "Topic A" in result["topics"]

    def test_no_questions_rejected(self):
        with pytest.raises(AssessmentValidationError):
            validate_assessment({"topics": ["A"], "questions": []})

    def test_missing_required_field_rejected(self):
        with pytest.raises(AssessmentValidationError):
            validate_assessment({"topics": ["A"], "questions": [{"question": "x"}]})

    def test_invalid_type_rejected(self):
        with pytest.raises(AssessmentValidationError):
            validate_assessment({"topics": ["A"], "questions": [make_mc(type="essay")]})

    def test_duplicate_questions_deduped(self):
        raw = {"topics": ["A"], "questions": [make_mc(), make_mc(), make_mc(question="Different?", correctAnswer="4", options=["3", "4", "5", "6"])]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 2

    def test_duplicate_case_and_whitespace_insensitive(self):
        raw = {"topics": ["A"], "questions": [make_mc(question="What is 2+2?"), make_mc(question="  WHAT IS 2+2?  ")]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 1

    def test_question_with_no_topic_dropped(self):
        raw = {"topics": ["A"], "questions": [make_mc(topic=""), make_mc(question="q2", topic="B", correctAnswer="4", options=["3", "4", "5", "6"])]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 1
        assert result["questions"][0]["topic"] == "B"

    def test_mc_with_too_few_options_dropped(self):
        raw = {"topics": ["A"], "questions": [make_mc(options=["4"]), make_mc(question="q2", correctAnswer="4", options=["3", "4", "5", "6"])]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 1

    def test_mc_correct_answer_not_in_options_dropped(self):
        raw = {"topics": ["A"], "questions": [make_mc(correctAnswer="99"), make_mc(question="q2", correctAnswer="4", options=["3", "4", "5", "6"])]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 1

    def test_question_with_no_answer_dropped(self):
        raw = {"topics": ["A"], "questions": [
            {"question": "q1", "type": "short_answer", "correctAnswer": "", "explanation": "e", "topic": "A"},
            make_mc(question="q2"),
        ]}
        result = validate_assessment(raw, min_questions=1)
        assert len(result["questions"]) == 1

    def test_too_few_valid_questions_raises(self):
        raw = {"topics": ["A"], "questions": [make_mc(options=["4"])]}  # gets dropped -> 0 left
        with pytest.raises(AssessmentValidationError):
            validate_assessment(raw, min_questions=1)

    def test_unknown_topic_is_merged_not_rejected(self):
        raw = {"topics": ["Declared Topic"], "questions": [make_mc(topic="Undeclared Topic")]}
        result = validate_assessment(raw, min_questions=1)
        assert "Undeclared Topic" in result["topics"]

    def test_bare_json_number_correct_answer_is_coerced_to_string(self):
        # The model sometimes emits a raw JSON number (18) instead of "18"
        # for numeric-type questions.
        raw = {"topics": ["History"], "questions": [{
            "question": "In what year did X happen?",
            "type": "numeric",
            "options": None,
            "correctAnswer": 18,
            "explanation": "e",
            "topic": "History",
            "difficulty": 1,
        }]}
        result = validate_assessment(raw, min_questions=1)
        assert result["questions"][0]["correctAnswer"] == "18"

    def test_numeric_and_expression_types_accept_list_answers(self):
        raw = {"topics": ["Factoring"], "questions": [{
            "question": "Solve x^2-5x+6=0",
            "type": "expression",
            "options": None,
            "correctAnswer": ["2", "3"],
            "explanation": "(x-2)(x-3)=0",
            "topic": "Factoring",
            "difficulty": 2,
        }]}
        result = validate_assessment(raw, min_questions=1)
        assert result["questions"][0]["correctAnswer"] == ["2", "3"]


# ---------- answer evaluation ----------

class TestEvaluateAnswer:
    def test_multiple_choice_correct(self):
        q = make_mc()
        assert evaluate_answer(q, "4") is True

    def test_multiple_choice_case_insensitive(self):
        q = make_mc(correctAnswer="Paris", options=["Paris", "Rome", "Berlin", "Madrid"])
        assert evaluate_answer(q, "paris") is True

    def test_multiple_choice_incorrect(self):
        q = make_mc()
        assert evaluate_answer(q, "3") is False

    def test_true_false_correct(self):
        q = {"type": "true_false", "correctAnswer": "Вярно"}
        assert evaluate_answer(q, "Вярно") is True
        assert evaluate_answer(q, "Невярно") is False

    def test_short_answer_exact(self):
        q = {"type": "short_answer", "correctAnswer": "photosynthesis"}
        assert evaluate_answer(q, "Photosynthesis") is True

    def test_short_answer_fuzzy_overlap(self):
        q = {"type": "short_answer", "correctAnswer": "the process of converting light into energy"}
        assert evaluate_answer(q, "converting light into energy process") is True

    def test_short_answer_multiple_accepted_phrasings(self):
        q = {"type": "short_answer", "correctAnswer": ["WAN", "wide area network"]}
        assert evaluate_answer(q, "Wide Area Network") is True

    def test_short_answer_unrelated_rejected(self):
        q = {"type": "short_answer", "correctAnswer": "photosynthesis"}
        assert evaluate_answer(q, "mitochondria") is False

    def test_numeric_correct(self):
        q = {"type": "numeric", "correctAnswer": "42"}
        assert evaluate_answer(q, "42") is True
        assert evaluate_answer(q, "42.0") is True

    def test_numeric_incorrect(self):
        q = {"type": "numeric", "correctAnswer": "42"}
        assert evaluate_answer(q, "43") is False

    def test_numeric_expression_equals_decimal(self):
        q = {"type": "numeric", "correctAnswer": "0.5"}
        assert evaluate_answer(q, "1/2") is True

    def test_empty_answer_is_incorrect(self):
        q = make_mc()
        assert evaluate_answer(q, None) is False
        assert evaluate_answer(q, "") is False
        assert evaluate_answer(q, "   ") is False

    @pytest.mark.parametrize("user_answer", [
        "2, 3", "3, 2", "x=2 and x=3", "x = 3, x = 2", "x=3,x=2", "2 и 3",
    ])
    def test_expression_multi_value_equivalent_formats(self, user_answer):
        q = {"type": "expression", "correctAnswer": ["2", "3"]}
        assert evaluate_answer(q, user_answer) is True

    def test_expression_wrong_values_rejected(self):
        q = {"type": "expression", "correctAnswer": ["2", "3"]}
        assert evaluate_answer(q, "x = 2, x = 4") is False

    def test_expression_wrong_count_rejected(self):
        q = {"type": "expression", "correctAnswer": ["2", "3"]}
        assert evaluate_answer(q, "2") is False


class TestCompareMathAnswers:
    def test_order_independent(self):
        assert compare_math_answers(["2", "3"], "3, 2") is True

    def test_strips_variable_labels(self):
        assert compare_math_answers(["2", "3"], "x=2 and x=3") is True

    def test_string_correct_answer(self):
        assert compare_math_answers("2, 3", "x = 3, x = 2") is True

    def test_numeric_tolerance(self):
        assert compare_math_answers("0.3333333", "1/3") is True

    def test_no_match(self):
        assert compare_math_answers(["2", "3"], "4, 5") is False


# ---------- scoring ----------

class TestScoreAssessment:
    def _questions(self, n_per_topic):
        qs = []
        qid = 0
        for topic, n in n_per_topic.items():
            for i in range(n):
                qs.append({
                    "id": qid, "question": f"{topic} q{i}", "type": "multiple_choice",
                    "options": ["a", "b"], "correctAnswer": "a", "explanation": "e",
                    "topic": topic, "difficulty": 1,
                })
                qid += 1
        return qs

    def test_overall_score_and_percentage(self):
        qs = self._questions({"T": 4})
        answers = {"0": "a", "1": "a", "2": "b", "3": "a"}
        result = score_assessment(qs, answers)
        assert result["score"] == 3
        assert result["total"] == 4
        assert result["percentage"] == 75

    def test_100_percent(self):
        qs = self._questions({"T": 3})
        answers = {str(i): "a" for i in range(3)}
        result = score_assessment(qs, answers)
        assert result["percentage"] == 100

    def test_0_percent(self):
        qs = self._questions({"T": 3})
        answers = {str(i): "b" for i in range(3)}
        result = score_assessment(qs, answers)
        assert result["percentage"] == 0

    def test_missing_answers_counted_incorrect(self):
        qs = self._questions({"T": 2})
        result = score_assessment(qs, {})
        assert result["score"] == 0
        assert result["total"] == 2

    def test_per_topic_breakdown_uneven_counts(self):
        qs = self._questions({"Factoring": 4, "Discriminant": 2, "Quadratic Formula": 3})
        answers = {}
        # answer every question correctly except question ids 1 and 5
        for q in qs:
            answers[str(q["id"])] = "b" if q["id"] in (1, 5) else "a"
        result = score_assessment(qs, answers)
        assert result["byTopic"]["Factoring"] == {"correct": 3, "total": 4, "percentage": 75}
        assert result["byTopic"]["Discriminant"] == {"correct": 1, "total": 2, "percentage": 50}
        assert result["byTopic"]["Quadratic Formula"] == {"correct": 3, "total": 3, "percentage": 100}

    def test_results_list_marks_correct_and_incorrect(self):
        qs = self._questions({"T": 2})
        result = score_assessment(qs, {"0": "a", "1": "b"})
        assert result["results"][0]["isCorrect"] is True
        assert result["results"][1]["isCorrect"] is False
        assert result["results"][1]["userAnswer"] == "b"
        assert result["results"][1]["correctAnswer"] == "a"

    def test_answer_lookup_accepts_int_keys(self):
        qs = self._questions({"T": 1})
        result = score_assessment(qs, {0: "a"})
        assert result["score"] == 1
