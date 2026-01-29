import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/admin/medications', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'No DB' });
        const { data, error } = await supabase.from('medications').select('*').order('name');
        if (error) throw error;
        res.json({ success: true, medications: data || [], count: data?.length || 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/medications/search/:query', authenticateToken, async (req, res) => {
    try {
        const query = req.params.query;
        if (!query || query.length < 2) return res.status(400).json({ error: 'Query too short' });

        const { data, error } = await supabase.from('medications').select('*')
            .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,brand_names.ilike.%${query}%`)
            .order('name').limit(50);

        if (error) throw error;
        res.json({ success: true, medications: data || [], query });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/medications/:id', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('medications').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, medication: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/admin/medications', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const item = { ...req.body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        if (!item.name || !item.generic_name) return res.status(400).json({ error: 'Name required' });

        const { data, error } = await supabase.from('medications').insert([item]).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, message: 'Created', medication: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/admin/medications/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id; delete updates.created_at;

        const { data, error } = await supabase.from('medications').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Updated', medication: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/admin/medications/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { error } = await supabase.from('medications').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/admin/check-interaction', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { med1, med2 } = req.body;
        if (!med1 || !med2) return res.status(400).json({ error: 'Both meds required' });

        const { data: m1 } = await supabase.from('medications').select('*').or(`name.ilike.%${med1}%,generic_name.ilike.%${med1}%`).maybeSingle();
        const { data: m2 } = await supabase.from('medications').select('*').or(`name.ilike.%${med2}%,generic_name.ilike.%${med2}%`).maybeSingle();

        if (!m1 || !m2) return res.json({ success: true, result: { interaction: 'Unknown', description: 'One or both not found' } });

        const interaction = m1.interactions?.toLowerCase().includes(m2.name.toLowerCase()) ||
            m1.interactions?.toLowerCase().includes(m2.generic_name.toLowerCase()) ||
            m2.interactions?.toLowerCase().includes(m1.name.toLowerCase()) ||
            m2.interactions?.toLowerCase().includes(m1.generic_name.toLowerCase()) ||
            m1.class === m2.class;

        res.json({
            success: true, result: {
                interaction: interaction ? 'Potential' : 'None',
                risk_level: interaction ? 'moderate' : 'low',
                description: interaction ? `Interaction between ${m1.name} and ${m2.name}` : 'No known interaction'
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
