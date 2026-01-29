import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// --- HELPERS ---
const isValidUUID = (uuid) => {
    if (!uuid || typeof uuid !== 'string' || uuid === 'undefined' || uuid === 'null') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
};

const getUserId = (user) => {
    if (!user) return null;
    const id = user.userId || user.id || user.user_id;
    return id ? String(id) : null;
};

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
        const { chat_with } = req.query;
        const userId = getUserId(req.user);

        if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid post ID' });

        if (!isValidUUID(userId)) {
            return res.status(401).json({ error: 'Session error: Invalid user ID. Please re-login.' });
        }

        // First, get the post to know who the owner is
        const { data: post, error: postError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (postError || !post) return res.status(404).json({ error: 'Post not found' });

        const ownerId = post.user_id;

        if (!isValidUUID(ownerId)) {
            return res.status(500).json({ error: `System error: Medication post has no valid owner.` });
        }

        let query = supabase
            .from('medication_availability_comments')
            .select(`
                *,
                user:user_id (
                    full_name,
                    institution
                )
            `)
            .eq('post_id', id);

        // Security: Filter messages to be "secrete" (private between two users)
        if (userId === post.user_id) {
            // I am the poster. I must specify who I'm chatting with.
            if (!chat_with || !isValidUUID(chat_with)) {
                return res.json({ success: true, comments: [], message: 'Valid chat_with required' });
            }
            query = query.or(`and(user_id.eq.${userId},recipient_id.eq.${chat_with}),and(user_id.eq.${chat_with},recipient_id.eq.${userId})`);
        } else {
            // I am an inquirer. I only see my conversation with the poster.
            query = query.or(`and(user_id.eq.${userId},recipient_id.eq.${ownerId}),and(user_id.eq.${ownerId},recipient_id.eq.${userId})`);
        }

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, comments: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * @route GET /api/medication-availability/:id/conversations
 * @desc Get list of users who have messaged about this post (for the poster)
 */
router.get('/medication-availability/:id/conversations', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid ID format' });
        const myId = getUserId(req.user);

        // Check if I am the owner
        const { data: post, error: postError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (postError || !post) return res.status(404).json({ error: 'Post not found' });
        if (post.user_id !== myId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only the poster can see the conversation list' });
        }

        // Find all unique users who messaged about this post (excluding the owner)
        const { data, error } = await supabase
            .from('medication_availability_comments')
            .select(`
                user_id,
                user:user_id (
                    id,
                    full_name,
                    institution
                )
            `)
            .eq('post_id', id)
            .neq('user_id', post.user_id);

        if (error) throw error;

        // Unique the list of users
        const usersMap = new Map();
        data.forEach(item => {
            if (item.user) {
                usersMap.set(item.user_id, item.user);
            }
        });

        res.json({ success: true, conversations: Array.from(usersMap.values()) });
    } catch (e) {
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
        const { content, recipient_id } = req.body;
        const myId = getUserId(req.user);

        if (!isValidUUID(myId)) return res.status(401).json({ error: 'Auth error: Invalid user identity.' });

        if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid ID format' });

        if (!content) return res.status(400).json({ error: 'Content is required' });

        // Get post to determine recipient
        const { data: post, error: postError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (postError || !post) return res.status(404).json({ error: 'Post not found' });

        let finalRecipient = recipient_id;

        if (myId === post.user_id) {
            // I am the poster, I must provide a recipient
            if (!finalRecipient || !isValidUUID(finalRecipient)) return res.status(400).json({ error: 'As the poster, you must provide a valid user ID to reply to.' });
        } else {
            // I am an inquirer, recipient is automatically the poster
            finalRecipient = post.user_id;
        }

        if (!isValidUUID(finalRecipient)) return res.status(400).json({ error: `Post has no valid owner to receive messages.` });

        const { data, error } = await (supabaseAdmin || supabase)
            .from('medication_availability_comments')
            .insert([{
                post_id: id,
                user_id: myId,
                recipient_id: finalRecipient,
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
        const myId = getUserId(req.user);

        if (!isValidUUID(myId)) return res.status(401).json({ error: 'Session expired or invalid. Please re-login.' });

        if (!medication_name) {
            return res.status(400).json({ success: false, error: 'Medication name is required' });
        }

        const newPost = {
            user_id: myId,
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

        if (error) {
            throw error;
        }
        res.status(201).json({ success: true, post: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed to create post' });
    }
});

/**
 * @route PUT /api/medication-availability/:id
 * @desc Update your own availability post
 */
router.put('/medication-availability/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { medication_name, quantity, condition, notes, expiry_date, status, contact_phone } = req.body;
        const myId = getUserId(req.user);

        // Find post and check ownership
        const { data: post, error: fetchError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (fetchError || !post) return res.status(404).json({ error: 'Post not found' });

        if (post.user_id !== myId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized to edit this post' });
        }

        const updateData = {
            medication_name,
            quantity: quantity || null,
            condition: condition || 'New/Sealed',
            notes,
            contact_phone: contact_phone || null,
            expiry_date: expiry_date === '' ? null : expiry_date,
            status: status || 'available',
            updated_at: new Date().toISOString()
        };

        const { data, error: updateError } = await (supabaseAdmin || supabase)
            .from('medication_availability')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;
        res.json({ success: true, post: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update post' });
    }
});

/**
 * @route DELETE /api/medication-availability/:id
 * @desc Delete your own availability post
 */
router.delete('/medication-availability/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const myId = getUserId(req.user);

        // Find post and check ownership
        const { data: post, error: fetchError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (fetchError || !post) return res.status(404).json({ error: 'Post not found' });

        // Admins can delete anything, others only their own
        if (post.user_id !== myId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { error: deleteError } = await (supabaseAdmin || supabase)
            .from('medication_availability')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;
        res.json({ success: true, message: 'Post deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

export default router;
