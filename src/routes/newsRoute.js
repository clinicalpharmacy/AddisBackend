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
router.get('/', async (req, res) => {
    try {
        const client = db();
        const { category, search, limit = 50, offset = 0 } = req.query;

        let query = client
            .from('news')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (category) query = query.eq('category', category);
        if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);

        const { data, error, count } = await query;
        if (error) throw error;

        // If published column exists, only show published; otherwise show all
        const visibleNews = (data || []).filter(
            item => item.published === undefined || item.published === null || item.published === true
        );

        res.json({ success: true, news: visibleNews, count: count || visibleNews.length });
    } catch (error) {
        console.error('❌ [News/List] error:', error.message || error);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch news' });
    }
});

// ==========================================
// 📊 ADMIN-ONLY LISTING (includes drafts)
// ⚠️ MUST be before /:id to avoid being caught by the wildcard
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
 * ⚠️ MUST be before generic /:id routes
 */
router.post('/:id/toggle-publish', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = db();
        const { id } = req.params;

        const { data: item, error: fetchErr } = await client
            .from('news')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr || !item) {
            return res.status(404).json({ success: false, error: 'News item not found' });
        }

        const newStatus = item.published !== undefined ? !item.published : false;

        let { data: updated, error } = await client
            .from('news')
            .update({ published: newStatus, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error && (error.code === 'PGRST204' || error.message?.includes('column') || error.code === '42703')) {
            return res.status(400).json({
                success: false,
                error: "The 'published' column does not exist in your database yet. Please run the ADD_NEWS_COLUMNS.sql script in your Supabase SQL editor to enable publishing toggle."
            });
        }

        if (error) throw error;

        res.json({
            success: true,
            message: newStatus ? 'News published' : 'News unpublished',
            published: newStatus,
            news: updated
        });
    } catch (error) {
        console.error('❌ [News/TogglePublish] error:', error.message || error);
        res.status(500).json({ success: false, error: error.message || 'Failed to toggle publish status' });
    }
});

// ==========================================
// 📖 SINGLE ITEM (wildcard /:id — must come AFTER specific routes)
// ==========================================

/**
 * GET /api/news/:id
 * Get a single news item by ID (increments view count).
 */
router.get('/:id', async (req, res) => {
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
        console.error('❌ [News/Get] error:', error.message || error);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch news item' });
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

        const baseRow = {
            title: title.trim(),
            content: content.trim(),
            reference: reference ? reference.trim() : '',
            category: category || 'general',
            image_url: image_url || null,
            author_name: req.user?.full_name || req.user?.email || 'Admin',
            views: 0
        };

        const fullRow = {
            ...baseRow,
            author_id: req.user?.userId || req.user?.id || null,
            published: published !== undefined ? !!published : true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        let { data: news, error } = await client
            .from('news')
            .insert(fullRow)
            .select()
            .single();

        // If optional columns (author_id, published, updated_at) are not in the table schema, fallback to base columns
        if (error && (error.code === 'PGRST204' || error.message?.includes('column') || error.code === '42703')) {
            console.warn('⚠️ [News/Create] Falling back to base columns:', error.message);
            const retry = await client
                .from('news')
                .insert(baseRow)
                .select()
                .single();
            news = retry.data;
            error = retry.error;
        }

        if (error) throw error;

        console.log(`📰 [News] Created "${news.title}" by ${req.user?.email || 'Admin'}`);
        res.status(201).json({ success: true, news });
    } catch (error) {
        console.error('❌ [News/Create] error:', error.message || error);
        res.status(500).json({ success: false, error: error.message || 'Failed to create news item' });
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
        const baseUpdates = {};
        ['title', 'content', 'reference', 'category', 'image_url'].forEach((key) => {
            if (req.body[key] !== undefined) baseUpdates[key] = req.body[key];
        });

        if (baseUpdates.title) baseUpdates.title = baseUpdates.title.trim();
        if (baseUpdates.content) baseUpdates.content = baseUpdates.content.trim();
        if (baseUpdates.reference !== undefined) baseUpdates.reference = baseUpdates.reference ? baseUpdates.reference.trim() : '';

        const fullUpdates = { ...baseUpdates };
        if (req.body.published !== undefined) fullUpdates.published = !!req.body.published;
        fullUpdates.updated_at = new Date().toISOString();

        if (Object.keys(fullUpdates).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        let { data: news, error } = await client
            .from('news')
            .update(fullUpdates)
            .eq('id', id)
            .select()
            .single();

        // If optional columns fail, fallback to base fields
        if (error && (error.code === 'PGRST204' || error.message?.includes('column') || error.code === '42703')) {
            console.warn('⚠️ [News/Update] Falling back to base update fields:', error.message);
            const retry = await client
                .from('news')
                .update(baseUpdates)
                .eq('id', id)
                .select()
                .single();
            news = retry.data;
            error = retry.error;
        }

        if (error || !news) {
            return res.status(404).json({ success: false, error: error?.message || 'News item not found' });
        }

        res.json({ success: true, message: 'News updated', news });
    } catch (error) {
        console.error('❌ [News/Update] error:', error.message || error);
        res.status(500).json({ success: false, error: error.message || 'Failed to update news item' });
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

export default router;
