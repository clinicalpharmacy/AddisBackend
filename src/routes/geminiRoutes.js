import express from "express";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { analyzePatientCDSS } from "../services/geminiService.js";

const router = express.Router();

/**
 * Endpoint for AI-powered patient analysis (CDSS).
 * De-identifies patient data manually if necessary, or expects de-identified data from frontend.
 */
router.post("/cdss-analysis", authenticateToken, async (req, res) => {
    try {
        const {
            age,
            sex,
            pregnancy,
            conditions,
            labs,
            medications,
            vitals
        } = req.body;

        // Restriction: Individual subscribers cannot access CDSS (optional, following system pattern)
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // De-identification (Ensure no patient names, identifiers are included)
        const patientData = {
            age,
            sex,
            pregnancy: pregnancy || false,
            conditions: conditions || [],
            labs: labs || {},
            medications: medications || [],
            vitals: vitals || {}
        };

        const analysis = await analyzePatientCDSS(patientData);

        res.json({
            success: true,
            analysis,
            disclaimer: "AI-generated - clinical pharmacist verification required. For advisory purposes only."
        });

    } catch (error) {
        console.error("CDSS Route Error [CRITICAL]:", {
            message: error.message,
            stack: error.stack,
            data: req.body
        });
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error during AI analysis"
        });
    }
});

export default router;
