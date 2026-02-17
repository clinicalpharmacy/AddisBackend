import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// User submit feedback (Public or Authenticated)
router.post('/', async (req, res) => {
    try {
        const { subject, message, category, user_email, user_name } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }

        const feedbackData = {
            subject: subject || '',
            message,
            category: category || 'general',
            user_email: user_email || 'Anonymous',
            user_name: user_name || 'Anonymous',
            status: 'new',
            created_at: new Date().toISOString()
        };

        const db = supabaseAdmin || supabase;
        const { data, error } = await db.from('feedbacks').insert([feedbackData]).select();

        if (error) {
            console.error('❌ Database error during feedback submission:', JSON.stringify(error, null, 2));
            throw error;
        }

        res.status(201).json({
            success: true,
            message: 'Thank you! Your feedback has been received.',
            feedback: data[0]
        });
    } catch (error) {
        console.error('Feedback submission error detail:', JSON.stringify(error, null, 2));
        res.status(500).json({
            success: false,
            error: 'Failed to submit feedback',
            details: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// Admin get all feedback
router.get('/admin/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { data, error } = await db
            .from('feedbacks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, feedback: data || [] });
    } catch (error) {
        console.error('Admin feedback fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
    }
});

// Admin update feedback status
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const { id } = req.params;
        const db = supabaseAdmin || supabase;

        const { error } = await db
            .from('feedbacks')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, message: 'Status updated' });
    } catch (error) {
        console.error('Feedback status update error:', error);
        res.status(500).json({ success: false, error: 'Failed to update status' });
    }
});

// Admin delete feedback
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const db = supabaseAdmin || supabase;

        const { error } = await db
            .from('feedbacks')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, message: 'Feedback deleted' });
    } catch (error) {
        console.error('Feedback deletion error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete feedback' });
    }
});

export default router;
