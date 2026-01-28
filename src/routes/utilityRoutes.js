import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

router.get('/institutions', async (req, res) => {
    try {
        if (!supabase) return res.json({ success: true, institutions: [] });
        const { data } = await supabase.from('users').select('institution').not('institution', 'is', null);
        const unique = [...new Set(data?.map(i => i.institution) || [])].sort();
        res.json({ success: true, institutions: unique });
    } catch (e) {
        res.json({ success: true, institutions: [] });
    }
});

router.get('/regions', (req, res) => {
    const regions = ['Addis Ababa', 'Oromia', 'Amhara', 'SNNPR', 'Tigray', 'Afar', 'Somali', 'Benishangul-Gumuz', 'Gambella', 'Harari', 'Dire Dawa', 'Other'];
    res.json({ success: true, regions });
});

router.get('/company-types', (req, res) => {
    const types = [
        { value: 'pharmacy', label: 'Pharmacy' },
        { value: 'hospital', label: 'Hospital' },
        { value: 'clinic', label: 'Clinic' },
        { value: 'health_center', label: 'Health Center' },
        { value: 'diagnostic', label: 'Diagnostic Center' },
        { value: 'pharmaceutical', label: 'Pharmaceutical Company' },
        { value: 'other', label: 'Other' }
    ];
    res.json({ success: true, company_types: types });
});

router.get('/patient-types', (req, res) => {
    res.json({ success: true, patient_types: [{ value: 'adult', label: 'Adult' }, { value: 'pediatric', label: 'Pediatric' }, { value: 'neonatal', label: 'Neonatal' }, { value: 'geriatric', label: 'Geriatric' }] });
});

router.get('/genders', (req, res) => {
    res.json({ success: true, genders: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] });
});

router.get('/statistics', async (req, res) => {
    try {
        if (!supabase) return res.json({ success: true, total_users: 0 });
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: patients } = await supabase.from('patients').select('*', { count: 'exact', head: true });
        const { count: subs } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
        res.json({ success: true, total_users: users || 0, total_patients: patients || 0, active_subscriptions: subs || 0 });
    } catch (e) {
        res.json({ success: true, error: 'Failed' });
    }
});

router.get('/lab-definitions', async (req, res) => {
    try {
        const { supabaseAdmin, supabase: sb } = await import('../config/supabase.js');
        const client = supabaseAdmin || sb;

        if (!client) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data, error } = await client
            .from('lab_tests')
            .select('*')
            .eq('is_active', true)
            .order('name', { ascending: true });

        if (error) throw error;
        res.json({ success: true, labs: data || [] });
    } catch (error) {
        console.error('Lab Definitions error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch lab definitions' });
    }
});

export default router;
