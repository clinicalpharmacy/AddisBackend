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
 * Fetch questions to take the exam. We do not return 'isCorrect' or 'explanation' 
 * here if we want to prevent cheating, but since the frontend expects them for 
 * immediate feedback, we will return the full JSONB options and explanations.
 */
router.get('/:id/take', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // First verify the exam is published
        const { data: exam, error: examError } = await db()
            .from('exams')
            .select('*')
            .eq('id', id)
            .eq('status', 'published')
            .single();

        if (examError || !exam) {
            return res.status(404).json({ success: false, error: 'Exam not found or not published' });
        }

        const { data: questions, error: qError } = await db()
            .from('exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true });

        if (qError) throw qError;

        // Map database schema to frontend expected format
        const formattedQuestions = (questions || []).map(q => ({
            id: q.id,
            questionText: q.question_text,
            options: q.options,
            explanation: q.explanation
        }));

        res.json({
            success: true,
            exam,
            questions: formattedQuestions
        });
    } catch (error) {
        console.error('❌ [StudentExams/Take] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch exam questions', details: error.message });
    }
});

export default router;
