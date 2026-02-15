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

        if (error) throw error;

        // Hide poster name for non-admins
        const posts = data.map(post => {
            if (req.user.role !== 'admin') {
                return { ...post, user: { ...post.user, full_name: 'Anonymous' } };
            }
            return post;
        });

        res.json({ success: true, posts });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed to fetch posts' });
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
        if (!isValidUUID(userId)) return res.status(401).json({ error: 'Session error: Invalid user ID. Please re-login.' });

        const { data: post, error: postError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (postError || !post) return res.status(404).json({ error: 'Post not found' });
        const ownerId = post.user_id;

        if (!isValidUUID(ownerId)) return res.status(500).json({ error: `System error: Medication post has no valid owner.` });

        let query;

        if (req.user.role === 'admin') {
            // Admin sees all comments
            query = supabase
                .from('medication_availability_comments')
                .select(`*, user:user_id ( full_name, institution )`)
                .eq('post_id', id);
        } else if (userId === ownerId) {
            // Poster sees conversation with specific user
            if (!chat_with || !isValidUUID(chat_with)) {
                return res.json({ success: true, comments: [], message: 'Valid chat_with required' });
            }
            query = supabase
                .from('medication_availability_comments')
                .select(`*, user:user_id ( full_name, institution )`)
                .or(`and(user_id.eq.${userId},recipient_id.eq.${chat_with}),and(user_id.eq.${chat_with},recipient_id.eq.${userId})`);
        } else {
            // Inquirer sees only conversation with poster
            query = supabase
                .from('medication_availability_comments')
                .select(`*, user:user_id ( full_name, institution )`)
                .or(`and(user_id.eq.${userId},recipient_id.eq.${ownerId}),and(user_id.eq.${ownerId},recipient_id.eq.${userId})`);
        }

        const { data, error } = await query.order('created_at', { ascending: true });
        if (error) throw error;

        // Hide comment authors for non-admins if they are the poster
        const comments = data.map(c => {
            if (req.user.role !== 'admin' && c.user_id === post.user_id) {
                return { ...c, user: { ...c.user, full_name: 'Anonymous' } };
            }
            return c;
        });

        res.json({ success: true, comments });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * @route GET /api/medication-availability/:id/conversations
 * @desc Get list of users who have messaged about this post (for the poster or admin)
 */
router.get('/medication-availability/:id/conversations', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid ID format' });
        const myId = getUserId(req.user);

        const { data: post, error: postError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (postError || !post) return res.status(404).json({ error: 'Post not found' });

        if (post.user_id !== myId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only the poster or admin can see the conversation list' });
        }

        let query = supabase
            .from('medication_availability_comments')
            .select(`
                user_id,
                user:user_id (
                    id,
                    full_name,
                    institution
                )
            `)
            .eq('post_id', id);

        // Exclude poster themselves only if requester is not admin
        if (req.user.role !== 'admin') {
            query = query.neq('user_id', post.user_id);
        }

        const { data, error } = await query;
        if (error) throw error;

        const usersMap = new Map();
        data.forEach(item => {
            if (item.user) {
                let userCopy = { ...item.user };
                if (req.user.role !== 'admin' && item.user.id === post.user_id) {
                    userCopy.full_name = 'Anonymous';
                }
                usersMap.set(item.user_id, userCopy);
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

        const { data: post, error: postError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (postError || !post) return res.status(404).json({ error: 'Post not found' });

        let finalRecipient = recipient_id;
        if (myId === post.user_id) {
            if (!finalRecipient || !isValidUUID(finalRecipient)) return res.status(400).json({ error: 'As the poster, you must provide a valid user ID to reply to.' });
        } else {
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
                user:user_id ( full_name, institution )
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
        const { medication_needed, search_date, notes } = req.body;
        const myId = getUserId(req.user);

        if (!isValidUUID(myId)) return res.status(401).json({ error: 'Session expired or invalid. Please re-login.' });
        if (!medication_needed) return res.status(400).json({ success: false, error: 'Medication name is required' });

        const newPost = {
            user_id: myId,
            medication_needed,
            search_date: search_date === '' ? null : search_date,
            notes,
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
        const { medication_needed, search_date, notes } = req.body;
        const myId = getUserId(req.user);

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
            medication_needed,
            search_date: search_date === '' ? null : search_date,
            notes,
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
 * @route GET /api/admin/medication-availability/comments
 * @desc Admin: Get recent comments/chats across all posts
 */
router.get('/admin/medication-availability/comments', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { data, error } = await supabase
            .from('medication_availability_comments')
            .select(`
                *,
                user:user_id ( full_name, email, role ),
                recipient:recipient_id ( full_name, email ),
                post:post_id ( medication_needed, status )
            `)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        res.json({ success: true, comments: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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

        const { data: post, error: fetchError } = await supabase
            .from('medication_availability')
            .select('user_id')
            .eq('id', id)
            .single();

        if (fetchError || !post) return res.status(404).json({ error: 'Post not found' });
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
