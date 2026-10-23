// routes/newsRoute.js
import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Helper: pick DB client (admin service role if available, else anon)
 */
const db = () => supabaseAdmin || supabase;

/**
 * Helper: validate news payload
 */
function validateNewsPayload(body, { partial = false } = {}) {
    const errors = [];
    const { title, content, reference } = body || {};

    if (!partial || title !== undefined) {
        if (!title || typeof title !== 'string' || !title.trim()) {
            errors.push('title is required and must be a non-empty string');
        } else if (title.trim().length > 200) {
            errors.push('title must be 200 characters or fewer');
        }
    }

    if (!partial || content !== undefined) {
        if (!content || typeof content !== 'string' || !content.trim()) {
            errors.push('content is required and must be a non-empty string');
        }
    }

    if (!partial || reference !== undefined) {
        if (reference === undefined || reference === null) {
            errors.push('reference is required (text, can be a citation or URL)');
        } else if (typeof reference !== 'string') {
            errors.push('reference must be a string');
        }
    }

    return errors;
}

// ==========================================
// 📰 PUBLIC / AUTHENTICATED READ ENDPOINTS
// ==========================================

/**
 * GET /api/news
 * List all published news (public to authenticated users).
 * Query params:
 *   ?category=...    filter by category
 *   ?search=...      search in title/content
 *   ?limit=50        max rows
 *   ?offset=0        pagination offset
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const client = db();
        const { category, search, limit = 50, offset = 0 } = req.query;

        let query = client
            .from('news')
            .select('id, title, content, reference, category, image_url, author_name, published, views, created_at, updated_at', { count: 'exact' })
            .eq('published', true)
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (category) query = query.eq('category', category);
        if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);

        const { data, error, count } = await query;
        if (error) throw error;

        res.json({ success: true, news: data || [], count: count || 0 });
    } catch (error) {
        console.error('❌ [News/List] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch news' });
    }
});

/**
 * GET /api/news/:id
 * Get a single news item by ID (increments view count).
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const client = db();
        const { id } = req.params;

        const { data: item, error } = await client
            .from('news')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !item) {
            return res.status(404).json({ success: false, error: 'News item not found' });
        }

        // Best-effort view counter increment (non-blocking)
        client
            .from('news')
            .update({ views: (item.views || 0) + 1 })
            .eq('id', id)
            .then(() => {})
            .catch(() => {});

        res.json({ success: true, news: item });
    } catch (error) {
        console.error('❌ [News/Get] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch news item' });
    }
});

// ==========================================
// ✍️ ADMIN WRITE ENDPOINTS
// ==========================================

/**
 * POST /api/news
 * Create a news item. Body: { title, content, reference, category?, image_url?, published? }
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = db();
        const errors = validateNewsPayload(req.body);
        if (errors.length) {
            return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
        }

        const { title, content, reference, category, image_url, published } = req.body;

        const { data: news, error } = await client
            .from('news')
            .insert({
                title: title.trim(),
                content: content.trim(),
                reference: reference.trim(),
                category: category || 'general',
                image_url: image_url || null,
                published: published !== undefined ? !!published : true,
                author_id: req.user.userId || req.user.id,
                author_name: req.user.full_name || req.user.email,
                views: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        console.log(`📰 [News] Created "${news.title}" by ${req.user.email}`);
        res.status(201).json({ success: true, news });
    } catch (error) {
        console.error('❌ [News/Create] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to create news item' });
    }
});

/**
 * PUT /api/news/:id
 * Update a news item (partial update allowed).
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = db();
        const { id } = req.params;

        const errors = validateNewsPayload(req.body, { partial: true });
        if (errors.length) {
            return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
        }

        // Whitelist updatable fields
        const updates = {};
        ['title', 'content', 'reference', 'category', 'image_url', 'published'].forEach((key) => {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        });

        if (updates.title) updates.title = updates.title.trim();
        if (updates.content) updates.content = updates.content.trim();
        if (updates.reference) updates.reference = updates.reference.trim();
        if (updates.published !== undefined) updates.published = !!updates.published;
        updates.updated_at = new Date().toISOString();

        if (Object.keys(updates).length === 1) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const { data: news, error } = await client
            .from('news')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error || !news) {
            return res.status(404).json({ success: false, error: 'News item not found' });
        }

        res.json({ success: true, message: 'News updated', news });
    } catch (error) {
        console.error('❌ [News/Update] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update news item' });
    }
});

/**
 * DELETE /api/news/:id
 * Delete a news item.
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = db();
        const { id } = req.params;

        const { data: existing } = await client
            .from('news')
            .select('id, title')
            .eq('id', id)
            .maybeSingle();

        if (!existing) {
            return res.status(404).json({ success: false, error: 'News item not found' });
        }

        const { error } = await client.from('news').delete().eq('id', id);
        if (error) throw error;

        console.log(`🗑️ [News] Deleted "${existing.title}" by ${req.user.email}`);
        res.json({ success: true, message: 'News deleted', id });
    } catch (error) {
        console.error('❌ [News/Delete] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete news item' });
    }
});

// ==========================================
// 📊 ADMIN-ONLY LISTING (includes drafts)
// ==========================================

/**
 * GET /api/news/admin/all
 * Admin list — includes unpublished/draft items.
 */
router.get('/admin/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = db();
        const { limit = 100, offset = 0 } = req.query;

        const { data, error, count } = await client
            .from('news')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (error) throw error;
        res.json({ success: true, news: data || [], count: count || 0 });
    } catch (error) {
        console.error('❌ [News/AdminList] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch news' });
    }
});

/**
 * POST /api/news/:id/toggle-publish
 * Publish / unpublish a news item.
 */
router.post('/:id/toggle-publish', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = db();
        const { id } = req.params;

        const { data: item, error: fetchErr } = await client
            .from('news')
            .select('published')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr || !item) {
            return res.status(404).json({ success: false, error: 'News item not found' });
        }

        const newStatus = !item.published;

        const { data: updated, error } = await client
            .from('news')
            .update({ published: newStatus, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: newStatus ? 'News published' : 'News unpublished',
            published: newStatus,
            news: updated
        });
    } catch (error) {
        console.error('❌ [News/TogglePublish] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to toggle publish status' });
    }
});

export default router;
