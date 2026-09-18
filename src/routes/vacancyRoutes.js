import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET all active health vacancies - Publicly accessible
router.get('/vacancies', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('health_vacancies')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, vacancies: data || [] });
    } catch (e) {
        console.error('Error fetching vacancies:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch vacancies' });
    }
});

// GET all health vacancies (including inactive) - Admin only
router.get('/vacancies/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data, error } = await (supabaseAdmin || supabase)
            .from('health_vacancies')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, vacancies: data || [] });
    } catch (e) {
        console.error('Error fetching all vacancies:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch all vacancies' });
    }
});

// POST new vacancy - Admin only
router.post('/vacancies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { title, company, location, description, url, deadline, is_active } = req.body;

        if (!title || !company || !location || !description) {
            return res.status(400).json({ success: false, error: 'Title, company, location, and description are required' });
        }

        const newVacancy = {
            title,
            company,
            location,
            description,
            url: url || null,
            deadline: deadline || null,
            is_active: is_active !== undefined ? is_active : true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await (supabaseAdmin || supabase)
            .from('health_vacancies')
            .insert([newVacancy])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, vacancy: data });
    } catch (e) {
        console.error('Error creating vacancy:', e);
        res.status(500).json({ success: false, error: 'Failed to create vacancy', details: e.message || e });
    }
});

// PUT update vacancy - Admin only
router.put('/vacancies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;

        const { data, error } = await (supabaseAdmin || supabase)
            .from('health_vacancies')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, vacancy: data });
    } catch (e) {
        console.error('Error updating vacancy:', e);
        res.status(500).json({ success: false, error: 'Failed to update vacancy', details: e.message || e });
    }
});

// DELETE vacancy - Admin only
router.delete('/vacancies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase)
            .from('health_vacancies')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Vacancy deleted successfully' });
    } catch (e) {
        console.error('Error deleting vacancy:', e);
        res.status(500).json({ success: false, error: 'Failed to delete vacancy' });
    }
});

export default router;
