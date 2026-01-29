import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Get all medication reconciliations for a patient
 */
router.get('/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;

        const { data, error } = await supabase
            .from('medication_reconciliation')
            .select('*')
            .eq('patient_code', patientCode)
            .order('reconciliation_date', { ascending: false });

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            reconciliations: data || [],
            count: data?.length || 0
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch reconciliations'
        });
    }
});

/**
 * Get reconciliation statistics for a patient
 */
router.get('/stats/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;

        const { data, error } = await supabase
            .from('medication_reconciliation')
            .select('reconciliation_status, action_taken, discrepancy_type, reconciliation_type')
            .eq('patient_code', patientCode);

        if (error) throw error;

        const stats = {
            total: data?.length || 0,
            by_status: {
                pending: data?.filter(r => r.reconciliation_status === 'Pending').length || 0,
                verified: data?.filter(r => r.reconciliation_status === 'Verified').length || 0,
                discrepancy_found: data?.filter(r => r.reconciliation_status === 'Discrepancy Found').length || 0,
                resolved: data?.filter(r => r.reconciliation_status === 'Resolved').length || 0
            },
            by_action: {
                continue: data?.filter(r => r.action_taken === 'Continue').length || 0,
                discontinue: data?.filter(r => r.action_taken === 'Discontinue').length || 0,
                modify: data?.filter(r => r.action_taken === 'Modify').length || 0,
                add: data?.filter(r => r.action_taken === 'Add').length || 0,
                hold: data?.filter(r => r.action_taken === 'Hold').length || 0
            },
            by_type: {
                admission: data?.filter(r => r.reconciliation_type === 'Admission').length || 0,
                transfer: data?.filter(r => r.reconciliation_type === 'Transfer').length || 0,
                discharge: data?.filter(r => r.reconciliation_type === 'Discharge').length || 0,
                routine: data?.filter(r => r.reconciliation_type === 'Routine').length || 0
            },
            discrepancies: data?.filter(r => r.discrepancy_type).length || 0
        };

        res.json({ success: true, stats });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get statistics'
        });
    }
});

/**
 * Create new medication reconciliation
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const reconciliationData = {
            ...req.body,
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // Validate required fields
        if (!reconciliationData.patient_code) {
            return res.status(400).json({
                success: false,
                error: 'Patient code is required'
            });
        }

        if (!reconciliationData.medication_name) {
            return res.status(400).json({
                success: false,
                error: 'Medication name is required'
            });
        }

        if (!reconciliationData.reconciliation_type) {
            return res.status(400).json({
                success: false,
                error: 'Reconciliation type is required'
            });
        }

        const { data, error } = await supabase
            .from('medication_reconciliation')
            .insert([reconciliationData])
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({
            success: true,
            reconciliation: data,
            message: 'Medication reconciliation created successfully'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create reconciliation'
        });
    }
});

/**
 * Update medication reconciliation
 */
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = {
            ...req.body,
            updated_at: new Date().toISOString()
        };

        // Remove fields that shouldn't be updated
        delete updateData.id;
        delete updateData.created_at;
        delete updateData.created_by;
        delete updateData.patient_code; // Don't allow changing patient

        const { data, error } = await supabase
            .from('medication_reconciliation')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'Reconciliation not found'
            });
        }

        res.json({
            success: true,
            reconciliation: data,
            message: 'Medication reconciliation updated successfully'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update reconciliation'
        });
    }
});

/**
 * Delete medication reconciliation
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('medication_reconciliation')
            .delete()
            .eq('id', id);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            message: 'Medication reconciliation deleted successfully'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete reconciliation'
        });
    }
});

/**
 * Get reconciliation by ID
 */
router.get('/detail/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('medication_reconciliation')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'Reconciliation not found'
            });
        }

        res.json({ success: true, reconciliation: data });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch reconciliation'
        });
    }
});

export default router;
