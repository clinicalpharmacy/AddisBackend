import express from 'express';
import crypto from 'crypto';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * -----------------------------------------------------------
 * PUBLIC (visitor) — no auth required
 * -----------------------------------------------------------
 */

// Start (or resume) a chat session from the landing-page widget
router.post('/start', async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { name, email, user_id } = req.body || {};

        const session_token = crypto.randomBytes(24).toString('hex');

        const { data, error } = await db
            .from('chat_sessions')
            .insert({
                session_token,
                visitor_name: (name || 'Visitor').toString().slice(0, 120),
                visitor_email: email ? String(email).slice(0, 200) : null,
                user_id: user_id || null,
                status: 'open'
            })
            .select('id, session_token, created_at')
            .single();

        if (error) throw error;

        res.json({
            success: true,
            session: { id: data.id, token: data.session_token }
        });
    } catch (err) {
        console.error('❌ [Chatbot/start]', err.message);
        res.status(500).json({ success: false, error: 'Failed to start chat' });
    }
});

// Visitor sends a message
router.post('/:token/messages', async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { token } = req.params;
        const message = (req.body?.message || '').toString().trim();

        if (!message) return res.status(400).json({ success: false, error: 'Message required' });
        if (message.length > 4000) return res.status(400).json({ success: false, error: 'Message too long' });

        const { data: session, error: sErr } = await db
            .from('chat_sessions')
            .select('id, status')
            .eq('session_token', token)
            .maybeSingle();

        if (sErr || !session) return res.status(404).json({ success: false, error: 'Session not found' });
        if (session.status === 'closed') {
            return res.status(400).json({ success: false, error: 'This conversation is closed' });
        }

        const { data, error } = await db
            .from('chat_messages')
            .insert({ session_id: session.id, sender_type: 'visitor', message })
            .select()
            .single();

        if (error) throw error;

        await db.from('chat_sessions')
            .update({ last_message_at: new Date().toISOString(), status: 'open' })
            .eq('id', session.id);

        res.json({ success: true, message: data });
    } catch (err) {
        console.error('❌ [Chatbot/send]', err.message);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});

// Visitor polls for messages (and admin replies)
router.get('/:token/messages', async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { token } = req.params;

        const { data: session, error: sErr } = await db
            .from('chat_sessions')
            .select('id, status')
            .eq('session_token', token)
            .maybeSingle();

        if (sErr || !session) return res.status(404).json({ success: false, error: 'Session not found' });

        const { data, error } = await db
            .from('chat_messages')
            .select('id, sender_type, sender_name, message, created_at')
            .eq('session_id', session.id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        res.json({ success: true, status: session.status, messages: data || [] });
    } catch (err) {
        console.error('❌ [Chatbot/list]', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
});

/**
 * -----------------------------------------------------------
 * ADMIN — full management of visitor conversations
 * -----------------------------------------------------------
 */

// List conversations (with unread counts)
router.get('/admin/conversations', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;

        const { data: sessions, error } = await db
            .from('chat_sessions')
            .select('*')
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(200);

        if (error) throw error;

        const ids = (sessions || []).map(s => s.id);
        const unreadMap = {};
        const lastMsgMap = {};

        if (ids.length) {
            const { data: msgs } = await db
                .from('chat_messages')
                .select('session_id, message, sender_type, read_at, created_at')
                .in('session_id', ids)
                .order('created_at', { ascending: false });

            (msgs || []).forEach(m => {
                if (!lastMsgMap[m.session_id]) lastMsgMap[m.session_id] = m;
                if (m.sender_type === 'visitor' && !m.read_at) {
                    unreadMap[m.session_id] = (unreadMap[m.session_id] || 0) + 1;
                }
            });
        }

        const conversations = (sessions || []).map(s => ({
            ...s,
            unread_count: unreadMap[s.id] || 0,
            last_message: lastMsgMap[s.id]?.message || null,
            last_message_at: lastMsgMap[s.id]?.created_at || s.last_message_at
        }));

        res.json({ success: true, conversations });
    } catch (err) {
        console.error('❌ [Chatbot/adminList]', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
    }
});

// Single conversation + messages (marks visitor msgs as read)
router.get('/admin/conversations/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { id } = req.params;

        const { data: session, error: sErr } = await db
            .from('chat_sessions').select('*').eq('id', id).maybeSingle();
        if (sErr || !session) return res.status(404).json({ success: false, error: 'Not found' });

        const { data: messages, error } = await db
            .from('chat_messages').select('*').eq('session_id', id).order('created_at', { ascending: true });
        if (error) throw error;

        await db.from('chat_messages')
            .update({ read_at: new Date().toISOString() })
            .eq('session_id', id)
            .eq('sender_type', 'visitor')
            .is('read_at', null);

        res.json({ success: true, session, messages: messages || [] });
    } catch (err) {
        console.error('❌ [Chatbot/adminGet]', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch conversation' });
    }
});

// Admin reply
router.post('/admin/conversations/:id/reply', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { id } = req.params;
        const message = (req.body?.message || '').toString().trim();
        if (!message) return res.status(400).json({ success: false, error: 'Message required' });

        const adminId = req.user.userId || req.user.id;
        const adminName = req.user.full_name || req.user.email || 'Support';

        const { data, error } = await db
            .from('chat_messages')
            .insert({
                session_id: id,
                sender_type: 'admin',
                sender_id: adminId,
                sender_name: adminName,
                message
            })
            .select()
            .single();

        if (error) throw error;

        await db.from('chat_sessions')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', id);

        res.json({ success: true, message: data });
    } catch (err) {
        console.error('❌ [Chatbot/adminReply]', err.message);
        res.status(500).json({ success: false, error: 'Failed to reply' });
    }
});

// Close conversation
router.post('/admin/conversations/:id/close', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { error } = await db.from('chat_sessions')
            .update({ status: 'closed' }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to close' });
    }
});

// Delete conversation
router.delete('/admin/conversations/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        await db.from('chat_messages').delete().eq('session_id', req.params.id);
        const { error } = await db.from('chat_sessions').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete' });
    }
});

export default router;
