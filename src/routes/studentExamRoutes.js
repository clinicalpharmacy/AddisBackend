import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Use admin client if available, fallback to regular
const db = () => supabaseAdmin || supabase;

/**
 * 📝 GET PUBLISHED EXAMS
 * Returns all published exams (for the student Education Center)
 */
router.get('/published', authenticateToken, async (req, res) => {
    try {
        const { data: exams, error } = await db()
            .from('exams')
            .select('*')
            .eq('status', 'published')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            exams: exams || [],
            count: exams?.length || 0
        });
    } catch (error) {
        console.error('❌ [StudentExams/List] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch published exams', details: error.message });
    }
});

/**
 * 📝 GET QUESTIONS FOR EXAM
 * Fetch questions to take the exam.
 *
 * Route: GET /exams/:id/questions
 * Also exposed as GET /exams/:id/take for backward compatibility.
 *
 * Query params:
 *   - limit (optional): max number of questions to return.
 *                       Frontend uses this to request a random subset.
 *   - shuffle (optional): "true" to randomize question order server-side.
 *
 * Response shape:
 *   { success: true, exam, questions: [{ id, questionText, options, explanation, correctAnswer }] }
 */
const getExamQuestions = async (req, res) => {
    try {
        const { id } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
        const shouldShuffle = req.query.shuffle === 'true';

        // Verify the exam is published
        const { data: exam, error: examError } = await db()
            .from('exams')
            .select('*')
            .eq('id', id)
            .eq('status', 'published')
            .single();

        if (examError || !exam) {
            return res.status(404).json({
                success: false,
                error: 'Exam not found or not published'
            });
        }

        const { data: questions, error: qError } = await db()
            .from('exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true });

        if (qError) throw qError;

        // Map DB schema -> frontend expected format
        let formattedQuestions = (questions || []).map(q => ({
            id: q.id,
            questionText: q.question_text,
            options: q.options,
            explanation: q.explanation,
            // IMPORTANT: include the correct answer so the frontend
            // can score answers. Remove this field if scoring is
            // moved to a dedicated server-side submit endpoint.
            correctAnswer:
                q.correct_answer ??
                q.correctAnswer ??
                q.answer ??
                null
        }));

        // Optional shuffle
        if (shouldShuffle) {
            for (let i = formattedQuestions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [formattedQuestions[i], formattedQuestions[j]] =
                    [formattedQuestions[j], formattedQuestions[i]];
            }
        }

        // Optional limit (e.g. ?limit=40)
        if (limit && limit > 0) {
            formattedQuestions = formattedQuestions.slice(0, limit);
        }

        res.json({
            success: true,
            exam,
            questions: formattedQuestions
        });
    } catch (error) {
        console.error('❌ [StudentExams/Questions] error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch exam questions',
            details: error.message
        });
    }
};

// Primary route (matches frontend)
router.get('/:id/questions', authenticateToken, getExamQuestions);

// Backward-compatible alias
router.get('/:id/take', authenticateToken, getExamQuestions);

export default router;
