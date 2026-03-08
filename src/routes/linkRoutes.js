import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Helper function to check if user is Healthcare Client
const isHealthcareClient = (user) => {
    return user?.userRole === 'healthcare_client';
};

// GET all useful links - Accessible by all authenticated users except Healthcare Clients
router.get('/useful-links', authenticateToken, async (req, res) => {
    try {
        // Check if user is Healthcare Client
        if (isHealthcareClient(req.user)) {
            return res.json({ 
                success: true, 
                links: [], 
                message: 'Useful links not available for Healthcare Client users' 
            });
        }

        const { data, error } = await supabase
            .from('useful_links')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, links: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to fetch links' });
    }
});

// GET single useful link - Accessible by all authenticated users except Healthcare Clients
router.get('/useful-links/:id', authenticateToken, async (req, res) => {
    try {
        // Check if user is Healthcare Client
        if (isHealthcareClient(req.user)) {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Useful links not available for Healthcare Client users.' 
            });
        }

        const { id } = req.params;
        const { data, error } = await supabase
            .from('useful_links')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        
        if (!data) {
            return res.status(404).json({ success: false, error: 'Link not found' });
        }

        res.json({ success: true, link: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to fetch link' });
    }
});

// POST new useful link - Admin only
router.post('/useful-links', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { title, url, icon, category, description } = req.body;

        if (!title) {
            return res.status(400).json({ success: false, error: 'Title is required' });
        }

        const newLink = {
            title,
            url,
            description,
            icon: icon || 'FaExternalLinkAlt',
            category: category || 'General',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await (supabaseAdmin || supabase)
            .from('useful_links')
            .insert([newLink])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, link: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to create link' });
    }
});

// PUT update useful link - Admin only
router.put('/useful-links/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;

        const { data, error } = await (supabaseAdmin || supabase)
            .from('useful_links')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, link: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update link' });
    }
});

// DELETE useful link - Admin only
router.delete('/useful-links/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase)
            .from('useful_links')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Link deleted successfully' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to delete link' });
    }
});

export default router;
