import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Use admin client if available, fallback to regular
const db = () => supabaseAdmin || supabase;

/**
 * 📝 GET ALL EXAMS
 * Returns all exams with question counts
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: exams, error } = await db()
            .from('exams')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            exams: exams || [],
            count: exams?.length || 0
        });
    } catch (error) {
        console.error('❌ [Exams/List] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch exams', details: error.message });
    }
});

/**
 * 📝 GET ALL SUBJECTS
 */
router.get('/subjects', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: subjects, error } = await db()
            .from('exam_subjects')
            .select('*')
            .order('name', { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            subjects: subjects || []
        });
    } catch (error) {
        console.error('❌ [Subjects/List] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch subjects', details: error.message });
    }
});

/**
 * 📝 CREATE A SUBJECT
 */
router.post('/subjects', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Subject name is required' });

        const { data: subject, error } = await db()
            .from('exam_subjects')
            .insert({ name: name.trim() })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation
                return res.status(400).json({ success: false, error: 'Subject already exists' });
            }
            throw error;
        }

        res.status(201).json({
            success: true,
            message: 'Subject created successfully',
            subject
        });
    } catch (error) {
        console.error('❌ [Subjects/Create] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to create subject', details: error.message });
    }
});

/**
 * 📝 DELETE A SUBJECT
 */
router.delete('/subjects/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await db()
            .from('exam_subjects')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Subject deleted successfully'
        });
    } catch (error) {
        console.error('❌ [Subjects/Delete] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete subject', details: error.message });
    }
});

/**
 * 📝 GET SINGLE EXAM WITH QUESTIONS
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { data: exam, error: examError } = await db()
            .from('exams')
            .select('*')
            .eq('id', id)
            .single();

        if (examError || !exam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        const { data: questions, error: qError } = await db()
            .from('exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true });

        if (qError) throw qError;

        res.json({
            success: true,
            exam,
            questions: questions || []
        });
    } catch (error) {
        console.error('❌ [Exams/Get] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch exam', details: error.message });
    }
});

/**
 * 📝 CREATE EXAM WITH QUESTIONS
 * Body: { subject, title?, source_file_name?, questions: [{ questionText, options, explanation }] }
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { subject, title, source_file_name, questions } = req.body;

        if (!subject) {
            return res.status(400).json({ success: false, error: 'Subject is required' });
        }

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one question is required' });
        }

        // 1. Create the exam record
        const examData = {
            subject,
            title: title || `${subject} Exam`,
            source_file_name: source_file_name || null,
            question_count: questions.length,
            status: 'published',
            created_by: req.user.userId
        };

        const { data: exam, error: examError } = await db()
            .from('exams')
            .insert(examData)
            .select()
            .single();

        if (examError) throw examError;

        // 2. Insert all questions
        const questionsToInsert = questions.map((q, index) => ({
            exam_id: exam.id,
            question_text: q.questionText || q.question_text,
            options: q.options || [],
            explanation: q.explanation || '',
            order_index: index
        }));

        const { error: qError } = await db()
            .from('exam_questions')
            .insert(questionsToInsert);

        if (qError) {
            // Rollback: delete the exam if questions failed
            await db().from('exams').delete().eq('id', exam.id);
            throw qError;
        }

        res.status(201).json({
            success: true,
            message: 'Exam created successfully',
            exam,
            question_count: questions.length
        });
    } catch (error) {
        console.error('❌ [Exams/Create] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to create exam', details: error.message });
    }
});

/**
 * 📝 UPDATE EXAM
 * Body: { subject?, title?, status?, questions?: [...] }
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, title, status, questions } = req.body;

        // Check exam exists
        const { data: existingExam, error: findError } = await db()
            .from('exams')
            .select('id')
            .eq('id', id)
            .single();

        if (findError || !existingExam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        // Build update payload
        const updates = { updated_at: new Date().toISOString() };
        if (subject) updates.subject = subject;
        if (title) updates.title = title;
        if (status) updates.status = status;

        // If questions are provided, replace them
        if (questions && Array.isArray(questions)) {
            updates.question_count = questions.length;

            // Delete old questions
            await db().from('exam_questions').delete().eq('exam_id', id);

            // Insert new questions
            const questionsToInsert = questions.map((q, index) => ({
                exam_id: id,
                question_text: q.questionText || q.question_text,
                options: q.options || [],
                explanation: q.explanation || '',
                order_index: index
            }));

            const { error: qError } = await db()
                .from('exam_questions')
                .insert(questionsToInsert);

            if (qError) throw qError;
        }

        const { data: updatedExam, error: updateError } = await db()
            .from('exams')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        res.json({
            success: true,
            message: 'Exam updated successfully',
            exam: updatedExam
        });
    } catch (error) {
        console.error('❌ [Exams/Update] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update exam', details: error.message });
    }
});

/**
 * 📝 DELETE EXAM
 * Cascade deletes questions via FK constraint
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { data: exam, error: findError } = await db()
            .from('exams')
            .select('id, subject')
            .eq('id', id)
            .single();

        if (findError || !exam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        // Delete exam (questions cascade via FK)
        const { error: deleteError } = await db()
            .from('exams')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        res.json({
            success: true,
            message: `Exam "${exam.subject}" deleted successfully`
        });
    } catch (error) {
        console.error('❌ [Exams/Delete] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete exam', details: error.message });
    }
});

/**
 * 📝 PUBLISH EXAM
 */
router.post('/:id/publish', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { data: exam, error } = await db()
            .from('exams')
            .update({ status: 'published', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        res.json({
            success: true,
            message: 'Exam published successfully',
            exam
        });
    } catch (error) {
        console.error('❌ [Exams/Publish] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to publish exam', details: error.message });
    }
});

export default router;
