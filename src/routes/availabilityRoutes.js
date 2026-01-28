import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { debug } from '../utils/logger.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route GET /api/medication-availability
 * @desc Get all medication availability posts
 */
router.get('/medication-availability', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('medication_availability')
            .select(`
                *,
                user:user_id (
                    full_name,
                    institution,
                    location,
                    contact_number,
                    email
                )
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Join error, trying simple fetch:', error);
            const { data: simpleData, error: simpleError } = await supabase
                .from('medication_availability')
                .select('*')
                .order('created_at', { ascending: false });

            if (simpleError) throw simpleError;
            return res.json({ success: true, posts: simpleData || [] });
        }
        res.json({ success: true, posts: data || [] });
    } catch (e) {
        debug.error('Error fetching availability:', e);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

/**
 * @route GET /api/medication-availability/:id/comments
 * @desc Get comments for a post
 */
router.get('/medication-availability/:id/comments', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('medication_availability_comments')
            .select(`
                *,
                user:user_id (
                    full_name,
                    institution
                )
            `)
            .eq('post_id', id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, comments: data || [] });
    } catch (e) {
        debug.error('Error fetching comments:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * @route POST /api/medication-availability/:id/comments
 * @desc Add a comment to a post
 */
router.post('/medication-availability/:id/comments', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { content } = req.body;

        if (!content) return res.status(400).json({ error: 'Content is required' });

        const { data, error } = await (supabaseAdmin || supabase)
            .from('medication_availability_comments')
            .insert([{
                post_id: id,
                user_id: req.user.id,
                content
            }])
            .select(`
                *,
                user:user_id (
                    full_name,
                    institution
                )
            `)
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, comment: data });
    } catch (e) {
        debug.error('Error posting comment:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * @route POST /api/medication-availability
 * @desc Create a new availability post
 */
router.post('/medication-availability', authenticateToken, async (req, res) => {
    try {
        const { medication_name, quantity, condition, notes, expiry_date, status, contact_phone } = req.body;

        if (!medication_name) {
            return res.status(400).json({ success: false, error: 'Medication name is required' });
        }

        const newPost = {
            user_id: req.user.id,
            medication_name,
            quantity: quantity || null,
            condition: condition || 'New/Sealed',
            notes,
            contact_phone: contact_phone || null,
            expiry_date: expiry_date === '' ? null : expiry_date,
            status: status || 'available',
            created_at: new Date().toISOString()
        };

        const { data, error } = await (supabaseAdmin || supabase)
            .from('medication_availability')
            .insert([newPost])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, post: data });
    } catch (e) {
        debug.error('Error creating availability post:', e);
        res.status(500).json({ success: false, error: 'Failed to create post' });
    }
});

/**
 * @route DELETE /api/medication-availability/:id
 * @desc Delete your own availability post
 */
router.delete('/medication-availability/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Find post and check ownership
        const { data: post, error: fetchError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (fetchError || !post) return res.status(404).json({ error: 'Post not found' });

        // Admins can delete anything, others only their own
        if (post.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { error: deleteError } = await (supabaseAdmin || supabase)
            .from('medication_availability')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;
        res.json({ success: true, message: 'Post deleted' });
    } catch (e) {
        debug.error('Error deleting post:', e);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

export default router;
